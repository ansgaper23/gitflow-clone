// Un pg_dump real de Supabase trae políticas RLS y funciones que llaman a "auth.uid()",
// "auth.email()", etc. — funciones propias del esquema "auth" de Supabase, que Flow Cloud (un
// Postgres crudo en la VPS, sin ese esquema) no tiene. Sin esto, ese SQL se rompe apenas se
// corre contra Flow Cloud ("function auth.uid() does not exist").
//
// Solo se traducen los 2 casos mecánicos y sin ambigüedad (mismo significado exacto de un lado
// y del otro, ver vpsPostgres.js): "auth.uid()" -> "current_user_id()" y "auth.email()" ->
// "current_user_email()". Cualquier OTRA referencia a "auth.*" (auth.role(), auth.jwt(),
// auth.jwt()->>'algo', etc.) NO se toca ni se adivina — son casos donde reescribir mal podría
// dejar una política de seguridad rota de formas no obvias (todo abierto, o todo cerrado), así
// que se listan como advertencia para que alguien las revise a mano en vez de aplicarlas ciegas.
const SAFE_REPLACEMENTS = [
  { pattern: /\bauth\.uid\s*\(\s*\)/gi, replacement: 'current_user_id()' },
  { pattern: /\bauth\.email\s*\(\s*\)/gi, replacement: 'current_user_email()' },
  // "auth.jwt() ->> 'email'" (con o sin "::text", con o sin paréntesis alrededor) es un modismo
  // real y frecuente en políticas escritas a mano — extrae el email del JWT, mismo significado
  // exacto que "auth.email()". Visto en producción (proyecto real migrado desde Lovable).
  { pattern: /\(?\s*auth\.jwt\s*\(\s*\)\s*->>\s*'email'\s*(::text)?\s*\)?/gi, replacement: 'current_user_email()' },
  // "auth.role() = 'authenticated'/'anon'" — en Supabase indica con qué rol de Postgres corre la
  // query (según si PostgREST recibió un JWT); acá TODA consulta corre con el mismo rol, la
  // única diferencia real es si hay una sesión válida — mismo significado que estas dos formas.
  { pattern: /\bauth\.role\s*\(\s*\)\s*=\s*'authenticated'\s*(::text)?/gi, replacement: 'current_user_id() IS NOT NULL' },
  { pattern: /\bauth\.role\s*\(\s*\)\s*=\s*'anon'\s*(::text)?/gi, replacement: 'current_user_id() IS NULL' },
]

// Cualquier "auth.<algo>(" que no sea uno de los 2 de arriba — se detecta DESPUÉS de aplicar los
// reemplazos seguros, así "auth.uid()"/"auth.email()" ya traducidos no aparecen en la lista.
const REMAINING_AUTH_CALL_RE = /\bauth\.\w+\s*\(/gi

// Roles de Postgres que Supabase crea de fábrica en TODO proyecto — usados en "CREATE POLICY ...
// TO authenticated" (o GRANT/REVOKE) para decir "esta política/permiso aplica a pedidos con
// sesión válida vs. anónimos". Flow Cloud es un Postgres común: ninguno de estos roles existe
// ahí, así que un DDL con "TO authenticated" sin traducir rompe con "role X does not exist" apenas
// se intenta crear la política — confirmado en un caso real (44 políticas, todas con este patrón).
// Reemplazarlo por "PUBLIC" (válido en los 3 casos: CREATE POLICY, GRANT, REVOKE) es correcto acá
// porque Flow Cloud igual filtra el acceso real por USING/WITH CHECK (ya traducido a
// current_user_id()) — a diferencia de Supabase, no hay una segunda capa de roles de Postgres
// distinguiendo "autenticado" de "anónimo" en la conexión en sí (ver vpsPostgres.js: cada
// proyecto conecta siempre con SU MISMO rol, nunca como "authenticated"/"anon").
const SUPABASE_BUILTIN_ROLES = [
  'authenticated',
  'anon',
  'service_role',
  'supabase_auth_admin',
  'supabase_storage_admin',
  'supabase_admin',
  'dashboard_user',
  'authenticator',
]
const ROLE_LIST_RE = new RegExp(
  `\\b(TO|FROM)\\s+(?:(?:${SUPABASE_BUILTIN_ROLES.join('|')})\\s*,\\s*)*(?:${SUPABASE_BUILTIN_ROLES.join('|')})\\b`,
  'gi',
)

export function translateSupabaseAuthSql(sql) {
  let translated = sql
  let replacedCount = 0
  for (const { pattern, replacement } of SAFE_REPLACEMENTS) {
    translated = translated.replace(pattern, () => {
      replacedCount++
      return replacement
    })
  }

  let roleReplacedCount = 0
  translated = translated.replace(ROLE_LIST_RE, (full, keyword) => {
    roleReplacedCount++
    return `${keyword} PUBLIC`
  })

  const warnings = [...new Set((translated.match(REMAINING_AUTH_CALL_RE) || []).map((m) => m.replace(/\s*\($/, '()')))]

  return { sql: translated, replacedCount, roleReplacedCount, warnings }
}

// Un export "DDL completo" de Supabase (funciones/políticas/triggers) trae mezclada la
// infraestructura INTERNA de Supabase (las funciones propias de "storage.*", la implementación
// real de "auth.uid()"/"auth.jwt()", etc.) junto con el código del usuario — el introspector que
// arma ese export lee TODO lo que hay en la base, sin filtrar por esquema. Recrear esa
// infraestructura en Flow Cloud no tiene sentido (no existen los esquemas "storage"/"auth" ahí)
// y further, algunas cosas (ver "on_auth_user_created" más abajo) parecen traducibles pero no lo
// son de forma segura.
const EXCLUDED_SCHEMAS = ['auth', 'storage', 'realtime', 'vault', 'extensions', 'graphql', 'graphql_public', 'net', 'pgsodium', 'supabase_functions', 'pgbouncer']

// Divide el SQL en sentencias completas respetando cuerpos con dollar-quoting ($$...$$ o
// $tag$...$tag$) — un "function$...$function$" puede contener ";" sin que eso termine la
// sentencia real, así que no alcanza con partir por ";" a secas.
function splitStatements(sql) {
  const statements = []
  let current = ''
  let i = 0
  let dollarTag = null

  while (i < sql.length) {
    if (dollarTag === null) {
      const dollarMatch = /^\$(\w*)\$/.exec(sql.slice(i, i + 40))
      if (dollarMatch) {
        dollarTag = dollarMatch[0]
        current += dollarTag
        i += dollarTag.length
        continue
      }
      current += sql[i]
      if (sql[i] === ';') {
        statements.push(current)
        current = ''
      }
      i++
    } else {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag
        i += dollarTag.length
        dollarTag = null
        continue
      }
      current += sql[i]
      i++
    }
  }
  if (current.trim()) statements.push(current)
  return statements
}

// Busca el esquema del OBJETO QUE SE DEFINE (después de CREATE FUNCTION/ALTER TABLE/ON), no
// cualquier "esquema.algo" que aparezca en el cuerpo — una función real del usuario puede LLAMAR
// a "auth.jwt()" adentro (eso lo traduce translateSupabaseAuthSql) sin que la función en sí sea
// de Supabase. Mezclar ambos chequeos excluiría por error funciones reales del usuario.
const DEFINITION_TARGET_RE = /(?:CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?(\w+)"?\.|ALTER\s+TABLE\s+"?(\w+)"?\.|\bON\s+"?(\w+)"?\.)/i

function definitionSchema(statement) {
  const match = DEFINITION_TARGET_RE.exec(statement)
  if (!match) return null
  return (match[1] || match[2] || match[3] || '').toLowerCase()
}

// "ON auth.users ... EXECUTE FUNCTION <fname>()" es el patrón estándar de Supabase para crear
// algo automáticamente en cada alta de usuario (típicamente un perfil) — casi todo proyecto
// Supabase/Lovable con cuentas de usuario lo tiene. Si la función que dispara está definida en
// el mismo SQL (lo normal: es código del usuario, no de Supabase), SÍ se puede migrar de forma
// segura: se apunta el trigger a "_flowpro_users" (la tabla de login real de Flow Cloud) y se
// reemplaza, DENTRO de esa función nada más, cualquier "NEW.<columna>" que no sea "id"/"email"
// por NULL — "_flowpro_users" nunca tiene otras columnas (ver vpsPostgres.js), y dejar que la
// función use NULL ahí deja que su propio fallback (COALESCE, DEFAULT, etc.) se haga cargo, en
// vez de que este traductor adivine un valor.
const TRIGGER_TARGET_FN_RE = /\bON\s+"?auth"?\.users\b[\s\S]*?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:"?\w+"?\.)?"?(\w+)"?\s*\(/i
const FUNCTION_NAME_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?\w+"?\.)?"?(\w+)"?\s*\(/i
const SANITIZE_NEW_RE = /\bNEW\.(?!id\b|email\b)\w+(\s*->>?\s*'[^']*')?/gi

// "isVps" distingue el destino: Flow Cloud (Postgres crudo en la VPS, sin esquema "auth" propio)
// vs. un proyecto Supabase real conectado por oauth (SÍ tiene su "auth.users" real). El
// carve-out de "ON auth.users ... EXECUTE FUNCTION" de abajo (redirigir a "_flowpro_users" +
// anular "NEW.<columna>") solo tiene sentido para Flow Cloud — confirmado en un caso real: yendo
// a un proyecto oauth, ese redirect dejaba "CREATE TRIGGER ... ON _flowpro_users" (una tabla que
// ni existe ahí), la sentencia fallaba, y como el resto del DDL corre en un solo lote vía la
// Management API, arrastraba consigo al resto — el proyecto quedaba SIN el trigger que crea la
// fila de perfil/rol/créditos de cada usuario nuevo, silenciosamente, sin ningún aviso claro de
// la causa. Para oauid destino real, este trigger es código de negocio del usuario apuntando a
// SU auth.users real — hay que dejarlo tal cual, sin redirigir ni tocar sus "NEW.*".
export function stripSupabaseInternalDDL(sql, isVps = true) {
  const statements = splitStatements(sql).filter((s) => s.trim())

  // 1° pasada: qué función(es) dispara un trigger de auth.users, y si esa función está definida
  // en este mismo SQL (si no lo está, no hay nada seguro que traducir — se deja como antes).
  const targetFnNames = new Set()
  for (const statement of statements) {
    const m = TRIGGER_TARGET_FN_RE.exec(statement)
    if (m) targetFnNames.add(m[1].toLowerCase())
  }
  const locallyDefinedFns = new Set()
  for (const statement of statements) {
    const m = FUNCTION_NAME_RE.exec(statement)
    if (m && targetFnNames.has(m[1].toLowerCase())) locallyDefinedFns.add(m[1].toLowerCase())
  }

  const kept = []
  const skipped = []
  const translatedAuthTriggerFns = []
  let sawUnresolvedAuthUsersTrigger = false

  for (const statement of statements) {
    const isAuthUsersTrigger = /\bon\s+"?auth"?\.users\b/i.test(statement) && /CREATE\s+TRIGGER/i.test(statement)
    if (isAuthUsersTrigger) {
      if (!isVps) {
        // Destino oauid (Supabase real): "auth.users" existe de verdad ahí — se deja el trigger
        // tal cual lo escribió el usuario, sin redirigir a "_flowpro_users" (que es exclusivo de
        // Flow Cloud) ni anular ningún "NEW.*".
        kept.push(statement)
        continue
      }
      const m = TRIGGER_TARGET_FN_RE.exec(statement)
      const fnName = m?.[1]?.toLowerCase()
      if (fnName && locallyDefinedFns.has(fnName)) {
        kept.push(statement.replace(/\bON\s+"?auth"?\.users\b/gi, 'ON _flowpro_users'))
        translatedAuthTriggerFns.push(m[1])
      } else {
        sawUnresolvedAuthUsersTrigger = true
        skipped.push(statement.split('\n').find((l) => l.trim()) || statement.slice(0, 120))
      }
      continue
    }

    const schema = definitionSchema(statement)
    if (schema && EXCLUDED_SCHEMAS.includes(schema)) {
      // Preferí una línea informativa (el comentario "-- Función:/Trigger:/Tabla: ..." que este
      // export siempre antepone, o si no la hay, la sentencia real) — las líneas separadoras
      // ("-- ----") que también preceden cada bloque no dicen nada útil en el resumen.
      const lines = statement.split('\n').map((l) => l.trim()).filter(Boolean)
      const label =
        lines.find((l) => /^--\s*(Función|Trigger|Tabla):/i.test(l)) ||
        lines.find((l) => /^(CREATE|ALTER|DROP)\b/i.test(l)) ||
        lines[0] ||
        statement.slice(0, 120)
      skipped.push(label.slice(0, 160))
      continue
    }

    const fnMatch = FUNCTION_NAME_RE.exec(statement)
    if (isVps && fnMatch && locallyDefinedFns.has(fnMatch[1].toLowerCase())) {
      // Anular "NEW.<columna>" solo tiene sentido yendo a Flow Cloud (ver comentario grande más
      // arriba): "_flowpro_users" no tiene esas columnas. Yendo a un proyecto oauth real, "NEW"
      // dentro de esta función es la fila real de "auth.users" — sus columnas SÍ existen, tocarla
      // rompería lógica de negocio real (ej. leer NEW.raw_user_meta_data).
      kept.push(statement.replace(SANITIZE_NEW_RE, 'NULL'))
      continue
    }

    kept.push(statement)
  }

  return {
    sql: kept.join('\n\n'),
    skippedCount: skipped.length,
    skippedSamples: skipped.slice(0, 15).map((s) => s.trim().slice(0, 160)),
    translatedAuthTriggerFns,
    sawUnresolvedAuthUsersTrigger,
  }
}
