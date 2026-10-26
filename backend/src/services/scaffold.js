import { UI_COMPONENTS_SEED } from './uiComponentsSeed.js'
// Archivos base de un proyecto nuevo (Vite + React + Tailwind), listos para que el
// agente de IA construya encima según el prompt del usuario. Mismo stack que usa
// FlowPro mismo, para que el orquestador de preview (que detecta vite.config.*) lo
// levante sin configuración extra.

// Cliente casero para la "base de datos automática": misma forma de uso que supabase-js
// (`db.from('tabla').select()`, siempre `{ data, error }`, más `auth.signUp/signIn/signOut/
// getUser`) para que la IA escriba el mismo patrón de código que ya conoce de sobra, solo que
// hablando con nuestro proxy REST (routes/dbProxy.js) en vez de la API de Supabase. Soporta RLS
// real: una vez logueado, el JWT de sesión viaja solo en cada consulta y las políticas RLS que
// la IA cree con propose_db_change pueden filtrar filas por usuario con current_user_id() (ver
// vpsPostgres.js) — una tabla sin RLS habilitado sigue abierta para cualquiera con el token.
export const DB_PROXY_CLIENT = `const BASE_URL = import.meta.env.VITE_DB_PROXY_URL
const TOKEN = import.meta.env.VITE_DB_PROXY_TOKEN
const SESSION_KEY = 'flowpro_db_session'

function getSessionToken() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function setSessionToken(token) {
  try {
    if (token) localStorage.setItem(SESSION_KEY, token)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // Almacenamiento no disponible (ventana privada, etc.) — la sesión no persiste, no rompe la app.
  }
}

// Suscriptores de "onAuthStateChange" — ver más abajo. Aparte del objeto "auth" a propósito
// (no "this.subscribers"): signUp/signIn/signOut necesitan notificarlos sin depender de cómo
// los llame el código de afuera (con o sin "auth." adelante, desestructurado, etc.).
const authSubscribers = []
function notifyAuthSubscribers(event, session) {
  for (const cb of authSubscribers) {
    try {
      cb(event, session)
    } catch {
      // un listener roto no debe tirar abajo a los demás
    }
  }
}

// Autenticación de usuarios finales de esta app (signup/login) — equivalente casero de
// supabase.auth. El JWT que devuelve se guarda solo y se manda automático en cada consulta de
// "db.from(...)", para que las políticas RLS que gestiona la IA por chat vean quién sos.
// Incluye "getSession"/"onAuthStateChange" (no solo "getUser") porque el código migrado desde
// Supabase casi siempre asume esa forma exacta (todo hook "useAuth" real la usa) — sin esto, la
// IA terminaba escribiendo un "useAuth.tsx" que llamaba a métodos que este cliente nunca tuvo.
export const auth = {
  async signUp(email, password) {
    const res = await fetch(\`\${BASE_URL}/\${TOKEN}/auth/signup\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = await res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
    if (json.data?.token) {
      setSessionToken(json.data.token)
      notifyAuthSubscribers('SIGNED_IN', { access_token: json.data.token, user: json.data.user })
    }
    return json
  },
  async signIn(email, password) {
    const res = await fetch(\`\${BASE_URL}/\${TOKEN}/auth/login\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = await res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
    if (json.data?.token) {
      setSessionToken(json.data.token)
      notifyAuthSubscribers('SIGNED_IN', { access_token: json.data.token, user: json.data.user })
    }
    return json
  },
  signOut() {
    setSessionToken(null)
    notifyAuthSubscribers('SIGNED_OUT', null)
    return { error: null }
  },
  // Para el link que genera un admin server-side (ver adminGenerateLink en dbProxy.js — sin flujo
  // de verificación de email propio, el "link" es directo un JWT de sesión válido en un query
  // param). La página que recibe ese link llama esto para guardarlo como sesión igual que un
  // login normal, en vez de tener que reescribir el flujo de "magic link" de Supabase.
  setSessionFromToken(token) {
    if (!token) return
    setSessionToken(token)
    notifyAuthSubscribers('SIGNED_IN', { access_token: token })
  },
  async getUser() {
    const token = getSessionToken()
    if (!token) return { data: { user: null }, error: null }
    const res = await fetch(\`\${BASE_URL}/\${TOKEN}/auth/me\`, {
      headers: { Authorization: \`Bearer \${token}\` },
    })
    if (res.status === 401) {
      setSessionToken(null)
      return { data: { user: null }, error: null }
    }
    return res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
  },
  // Mismo dato que "getUser" pero envuelto como "session" (con el token adentro) — así de
  // vuelta, es lo que el código migrado espera.
  async getSession() {
    const token = getSessionToken()
    if (!token) return { data: { session: null }, error: null }
    const { data, error } = await auth.getUser()
    if (error || !data?.user) return { data: { session: null }, error }
    return { data: { session: { access_token: token, user: data.user } }, error: null }
  },
  // No hay un canal en tiempo real como el de Supabase (no hay WebSocket acá) — lo que SÍ hace
  // falta y cubre la gran mayoría de los casos reales es que dispare un evento inicial apenas
  // te suscribís (con la sesión actual) y otro cada vez que ESTE MISMO cliente haga signIn/
  // signUp/signOut. Eso alcanza para que un "useAuth" migrado funcione tal cual, sin reescribirlo.
  onAuthStateChange(callback) {
    authSubscribers.push(callback)
    auth.getSession().then(({ data }) => callback('INITIAL_SESSION', data.session))
    return {
      data: {
        subscription: {
          unsubscribe() {
            const i = authSubscribers.indexOf(callback)
            if (i !== -1) authSubscribers.splice(i, 1)
          },
        },
      },
    }
  },
}

function buildUrl(table, params) {
  const url = new URL(\`\${BASE_URL}/\${TOKEN}/\${table}\`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value)
  }
  return url.toString()
}

// Query builder encadenable, igual de uso que supabase-js: se puede hacer
// "await db.from('tabla').select('*').eq('id', 5)" directo, sin llamar ningún método final.
class Query {
  constructor(table) {
    this.table = table
    this.filters = {}
    this.method = 'GET'
    this.body = undefined
    this.selectCols = '*'
    this.orderClause = null
    this.limitN = null
    this.offsetN = null
    this.wantsSingle = false
  }

  select(cols = '*') {
    this.selectCols = cols
    return this
  }

  eq(col, val) { this.filters[col] = \`eq.\${val}\`; return this }
  neq(col, val) { this.filters[col] = \`neq.\${val}\`; return this }
  gt(col, val) { this.filters[col] = \`gt.\${val}\`; return this }
  gte(col, val) { this.filters[col] = \`gte.\${val}\`; return this }
  lt(col, val) { this.filters[col] = \`lt.\${val}\`; return this }
  lte(col, val) { this.filters[col] = \`lte.\${val}\`; return this }
  like(col, val) { this.filters[col] = \`like.\${val}\`; return this }
  ilike(col, val) { this.filters[col] = \`ilike.\${val}\`; return this }
  is(col, val) { this.filters[col] = \`is.\${val === null ? 'null' : 'not.null'}\`; return this }
  in(col, vals) { this.filters[col] = \`in.\${JSON.stringify(vals || [])}\`; return this }

  // Igual que supabase-js: negación de otro operador. "in" recibe la lista ya formateada
  // "(a,b,c)" (como la manda supabase-js), el resto usa el mismo valor que ese operador.
  not(col, op, val) {
    if (op === 'is') this.filters[col] = \`not.is.\${val === null ? 'null' : 'not.null'}\`
    else this.filters[col] = \`not.\${op}.\${val}\`
    return this
  }

  // Un solo string con condiciones "col.op.valor" separadas por coma, unidas con OR — mismo
  // formato que supabase-js (ej. "nombre.ilike.%ana%,email.ilike.%ana%").
  or(filterString) {
    this.orFilter = filterString
    return this
  }

  order(col, { ascending = true } = {}) {
    this.orderClause = \`\${col}.\${ascending ? 'asc' : 'desc'}\`
    return this
  }

  limit(n) {
    this.limitN = n
    return this
  }

  // Igual que en supabase-js: "from" y "to" son índices inclusive (0-based).
  range(from, to) {
    this.limitN = to - from + 1
    this.offsetN = from
    return this
  }

  single() {
    this.wantsSingle = true
    return this
  }

  // A diferencia de single() en supabase-js, "single()" acá YA se comporta como "maybeSingle()"
  // (devuelve null en vez de tirar error si no hay filas) — este alias existe solo para el
  // código que llama ".maybeSingle()" explícitamente, mismo resultado que ".single()".
  maybeSingle() {
    this.wantsSingle = true
    return this
  }

  insert(values) {
    this.method = 'POST'
    this.body = values
    return this
  }

  // "onConflict" (mismo nombre de opción que supabase-js) es opcional: sin él, el servidor usa
  // la primary key real de la tabla.
  upsert(values, { onConflict } = {}) {
    this.method = 'POST'
    this.body = values
    this.onConflict = onConflict || null
    return this
  }

  update(values) {
    this.method = 'PATCH'
    this.body = values
    return this
  }

  delete() {
    this.method = 'DELETE'
    return this
  }

  async _run() {
    const params = { ...this.filters }
    if (this.method === 'GET') {
      params.select = this.selectCols
      if (this.orderClause) params.order = this.orderClause
      if (this.limitN) params.limit = this.limitN
      if (this.offsetN) params.offset = this.offsetN
      if (this.orFilter) params.or = this.orFilter
    }
    if (this.method === 'POST' && this.onConflict) params.on_conflict = this.onConflict
    const sessionToken = getSessionToken()
    const headers = {}
    if (this.body) headers['Content-Type'] = 'application/json'
    if (sessionToken) headers.Authorization = \`Bearer \${sessionToken}\`

    const res = await fetch(buildUrl(this.table, params), {
      method: this.method,
      headers,
      body: this.body ? JSON.stringify(this.body) : undefined,
    })
    const json = await res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
    if (this.wantsSingle && Array.isArray(json.data)) {
      return { data: json.data[0] || null, error: json.error }
    }
    return json
  }

  // Hace que "await db.from(...).select()..." funcione sin un método final explícito.
  then(resolve, reject) {
    return this._run().then(resolve, reject)
  }
}

export const db = {
  from(table) {
    return new Query(table)
  },
  // Igual forma de uso que "supabase.rpc(fnName, params)" — llama una función SQL real (creada
  // con propose_db_change) por nombre, con parámetros nombrados. A diferencia de "from()", no es
  // encadenable (no hay ".select()"/".eq()" después) — devuelve directo "{ data, error }", que
  // cubre el uso real de la enorme mayoría del código migrado desde Supabase.
  async rpc(fnName, params) {
    const sessionToken = getSessionToken()
    const res = await fetch(\`\${BASE_URL}/\${TOKEN}/rpc/\${fnName}\`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: \`Bearer \${sessionToken}\` } : {}),
      },
      body: JSON.stringify(params || {}),
    })
    return res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
  },
}

// Storage: misma forma de uso que "supabase.storage.from(bucket)" — subir/leer/listar/borrar
// archivos. Todo bucket es público de lectura (sin URLs firmadas todavía); subir/borrar sí
// necesita sesión iniciada (el JWT de auth.signIn/signUp viaja solo, igual que en "db").
const STORAGE_BASE_URL = import.meta.env.VITE_STORAGE_PROXY_URL
const STORAGE_TOKEN = import.meta.env.VITE_STORAGE_PROXY_TOKEN

export const storage = {
  from(bucket) {
    return {
      // "file" es un File/Blob del navegador (ej. de un <input type="file">). El 3er parámetro
      // (cacheControl/upsert/contentType de supabase-js) se ignora a propósito: el servidor
      // siempre sobreescribe (upsert real de por sí) y content-type lo infiere del nombre del
      // archivo — nada de eso hace falta configurar acá, pero se acepta el argumento para no
      // romper una llamada que ya lo manda.
      async upload(path, file, _options) {
        const sessionToken = getSessionToken()
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(\`\${STORAGE_BASE_URL}/\${STORAGE_TOKEN}/\${bucket}/\${path}\`, {
          method: 'POST',
          headers: sessionToken ? { Authorization: \`Bearer \${sessionToken}\` } : {},
          body: form,
        })
        return res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
      },
      getPublicUrl(path) {
        return { data: { publicUrl: \`\${STORAGE_BASE_URL}/\${STORAGE_TOKEN}/\${bucket}/\${path}\` } }
      },
      // Todo bucket ya es público de lectura (ver flowStorage.js) — no hay nada que firmar, así
      // que devuelve directo la URL pública. "expiresIn"/"download" (nombre de descarga forzada)
      // se aceptan pero no tienen efecto: el link no vence, y no fuerza descarga vs. mostrar
      // inline — cubre el caso real (compartir/descargar un archivo) igual.
      async createSignedUrl(path, _expiresIn, _options) {
        return { data: { signedUrl: \`\${STORAGE_BASE_URL}/\${STORAGE_TOKEN}/\${bucket}/\${path}\` }, error: null }
      },
      async download(path) {
        const res = await fetch(\`\${STORAGE_BASE_URL}/\${STORAGE_TOKEN}/\${bucket}/\${path}\`)
        if (!res.ok) return { data: null, error: 'Archivo no encontrado' }
        return { data: await res.blob(), error: null }
      },
      async remove(paths) {
        const sessionToken = getSessionToken()
        const results = await Promise.all(
          (Array.isArray(paths) ? paths : [paths]).map((p) =>
            fetch(\`\${STORAGE_BASE_URL}/\${STORAGE_TOKEN}/\${bucket}/\${p}\`, {
              method: 'DELETE',
              headers: sessionToken ? { Authorization: \`Bearer \${sessionToken}\` } : {},
            }).then((r) => r.json()),
          ),
        )
        const error = results.find((r) => r.error)?.error || null
        return { data: error ? null : results.map((r) => r.data), error }
      },
      // El servidor siempre devuelve TODO el bucket (recursivo, ver listStorageFiles) — "prefix"
      // y las opciones de orden/límite de supabase-js (sortBy/limit) se aplican acá del lado del
      // cliente para no tener que tocar el proxy.
      async list(prefix = '', { limit, sortBy } = {}) {
        const res = await fetch(\`\${STORAGE_BASE_URL}/\${STORAGE_TOKEN}/\${bucket}\`)
        const json = await res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
        if (!Array.isArray(json.data)) return json
        let files = json.data
        if (prefix) files = files.filter((f) => f.path.startsWith(prefix))
        // supabase-js devuelve "name" (solo el segmento final), no el path completo — el código
        // migrado casi siempre lee ".name", no ".path".
        files = files.map((f) => ({ ...f, name: f.path.split('/').pop(), updated_at: f.updatedAt }))
        if (sortBy?.column) {
          const dir = sortBy.order === 'asc' ? 1 : -1
          files = [...files].sort((a, b) => (a[sortBy.column] > b[sortBy.column] ? dir : -dir))
        }
        if (limit) files = files.slice(0, limit)
        return { data: files, error: null }
      },
    }
  },
}
`

// Equivalente casero de "supabaseAdmin" (el cliente service_role de Supabase, que salta RLS) —
// SOLO para código server-only (.server.ts/.functions.ts de TanStack Start, nunca bundleado al
// navegador). Habla con routes/dbAdminProxy.js, gateado por DB_ADMIN_PROXY_SECRET — una env var
// SIN prefijo VITE_ (ver previewEnv.js), así que Vite jamás la inyecta en el bundle del cliente
// aunque este archivo se importe por error desde código de navegador: sin la variable, cada
// llamada falla en vez de filtrar el secreto o funcionar con un secreto vacío.
export const DB_ADMIN_CLIENT = `if (typeof window !== 'undefined') {
  throw new Error('src/lib/db-admin.js es server-only — nunca lo importes desde código que corre en el navegador.')
}

const BASE_URL = process.env.DB_ADMIN_PROXY_URL
const SECRET = process.env.DB_ADMIN_PROXY_SECRET

function headers(extra) {
  return { 'X-Admin-Secret': SECRET, ...extra }
}

async function parseJson(res) {
  return res.json().catch(() => ({ data: null, error: 'Respuesta inválida del servidor' }))
}

function buildUrl(table, params) {
  const url = new URL(\`\${BASE_URL}/\${table}\`)
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value)
  }
  return url.toString()
}

// Mismo query builder encadenable que db.js (ver DB_PROXY_CLIENT), pero SIN el JWT de sesión de
// usuario final — este cliente ya bypasea RLS por completo, no hace falta ni tiene sentido.
class AdminQuery {
  constructor(table) {
    this.table = table
    this.filters = {}
    this.method = 'GET'
    this.body = undefined
    this.selectCols = '*'
    this.orderClause = null
    this.limitN = null
    this.wantsSingle = false
  }
  select(cols = '*') { this.selectCols = cols; return this }
  eq(col, val) { this.filters[col] = \`eq.\${val}\`; return this }
  neq(col, val) { this.filters[col] = \`neq.\${val}\`; return this }
  gt(col, val) { this.filters[col] = \`gt.\${val}\`; return this }
  gte(col, val) { this.filters[col] = \`gte.\${val}\`; return this }
  lt(col, val) { this.filters[col] = \`lt.\${val}\`; return this }
  lte(col, val) { this.filters[col] = \`lte.\${val}\`; return this }
  in(col, vals) { this.filters[col] = \`in.\${JSON.stringify(vals || [])}\`; return this }
  order(col, { ascending = true } = {}) { this.orderClause = \`\${col}.\${ascending ? 'asc' : 'desc'}\`; return this }
  limit(n) { this.limitN = n; return this }
  single() { this.wantsSingle = true; return this }
  maybeSingle() { this.wantsSingle = true; return this }
  insert(values) { this.method = 'POST'; this.body = values; return this }
  upsert(values, { onConflict } = {}) { this.method = 'POST'; this.body = values; this.onConflict = onConflict || null; return this }
  update(values) { this.method = 'PATCH'; this.body = values; return this }
  delete() { this.method = 'DELETE'; return this }

  async _run() {
    const params = { ...this.filters }
    if (this.method === 'GET') {
      params.select = this.selectCols
      if (this.orderClause) params.order = this.orderClause
      if (this.limitN) params.limit = this.limitN
    }
    if (this.method === 'POST' && this.onConflict) params.on_conflict = this.onConflict
    const res = await fetch(buildUrl(this.table, params), {
      method: this.method,
      headers: headers(this.body ? { 'Content-Type': 'application/json' } : {}),
      body: this.body ? JSON.stringify(this.body) : undefined,
    })
    const json = await parseJson(res)
    if (this.wantsSingle && Array.isArray(json.data)) return { data: json.data[0] || null, error: json.error }
    return json
  }
  then(resolve, reject) { return this._run().then(resolve, reject) }
}

export const supabaseAdmin = {
  from(table) {
    return new AdminQuery(table)
  },
  async rpc(fnName, params) {
    const res = await fetch(\`\${BASE_URL}/rpc/\${fnName}\`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(params || {}),
    })
    return parseJson(res)
  },
  auth: {
    admin: {
      async listUsers() {
        const res = await fetch(\`\${BASE_URL}/auth/users\`, { headers: headers() })
        const json = await parseJson(res)
        return { data: { users: json.data || [] }, error: json.error }
      },
      async createUser({ email, password }) {
        const res = await fetch(\`\${BASE_URL}/auth/users\`, {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ email, password }),
        })
        const json = await parseJson(res)
        return { data: { user: json.data || null }, error: json.error }
      },
      async deleteUser(userId) {
        const res = await fetch(\`\${BASE_URL}/auth/users/\${userId}\`, { method: 'DELETE', headers: headers() })
        return parseJson(res)
      },
      async generateLink({ email, options } = {}) {
        const res = await fetch(\`\${BASE_URL}/auth/generate-link\`, {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ email, redirectTo: options?.redirectTo }),
        })
        const json = await parseJson(res)
        return { data: json.data || null, error: json.error }
      },
    },
  },
}
`

// Cliente para un proyecto Supabase real (destino oauth) — supabase-js de verdad, no un casero
// como DB_PROXY_CLIENT. Exportado con nombre (antes vivía como string suelto ACÁ ADENTRO, sin
// forma de reusarlo desde otro lado) para poder escribirlo determinísticamente durante una
// migración también, igual que DB_PROXY_CLIENT — ver dbImport.js#ensureDbClientFile.
export const SUPABASE_CLIENT = `import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(url, anonKey)
`

// Shim para un proyecto conectado a Supabase real (oauth) donde el código migrado (o la IA, al
// escribirlo) terminó usando la forma casera "db.js"/"auth" de la base de datos automática (ver
// DB_PROXY_CLIENT) en vez de "supabase" real — pasó de verdad en una migración: partes del
// código quedaron escritas como "db.from(tabla)"/"auth.signIn(email, password)" importando de
// "@/lib/db", que en un proyecto oauth ni siquiera existe (o queda vacío), rompiendo la app
// entera con "does not provide an export named 'auth'". Esto traduce esa forma a llamadas reales
// de supabase-js (ver src/lib/supabase.js) — más simple y seguro que reescribir cada archivo
// grande que ya la usa. ".from()"/".storage" son pass-through directo: ya usan la forma real de
// supabase-js del lado que llama, solo "auth.*" necesita adaptar la firma (posicional acá, objeto
// en supabase-js real).
export const DB_JS_SUPABASE_ADAPTER = `import { supabase } from './supabase.js'

export const db = {
  from(table) {
    return supabase.from(table)
  },
  rpc(fnName, params) {
    return supabase.rpc(fnName, params)
  },
  storage: supabase.storage,
}

export const auth = {
  signUp(email, password) {
    return supabase.auth.signUp({ email, password })
  },
  signIn(email, password) {
    return supabase.auth.signInWithPassword({ email, password })
  },
  signOut() {
    return supabase.auth.signOut()
  },
  getUser() {
    return supabase.auth.getUser()
  },
  getSession() {
    return supabase.auth.getSession()
  },
  onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback)
  },
}
`

// dbKind: 'none' | 'supabase' | 'vps' — determina qué cliente de datos (si alguno) trae el
// scaffold. 'vps' es la base de datos automática de FlowPro (Postgres crudo en la VPS, sin API
// REST propia): usa src/lib/db.js, un cliente casero que habla con nuestro proxy
// (routes/dbProxy.js) en vez de supabase-js — ver ese archivo para el porqué.
export function buildScaffoldFiles({ projectName, dbKind = 'none' }) {
  const withSupabase = dbKind === 'supabase'
  const withVps = dbKind === 'vps'
  const files = {
    '.gitignore': `node_modules\ndist\n.env\n.env.local\n`,

    'package.json': JSON.stringify(
      {
        name: projectName,
        private: true,
        version: '0.0.1',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
          'lucide-react': '^0.441.0',
          'clsx': '^2.1.1',
          'tailwind-merge': '^2.5.2',
          'sonner': '^1.5.0',
          ...(withSupabase ? { '@supabase/supabase-js': '^2.45.0' } : {}),
        },
        devDependencies: {
          '@vitejs/plugin-react': '^4.3.0',
          tailwindcss: '^3.4.17',
          postcss: '^8.4.49',
          autoprefixer: '^10.4.20',
          vite: '^5.4.2',
        },
      },
      null,
      2,
    ),

    'vite.config.js': `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nimport path from 'path'\n\nexport default defineConfig({\n  plugins: [react()],\n  resolve: {\n    alias: {\n      '@': path.resolve(__dirname, './src'),\n    },\n  },\n})\n`,

    'postcss.config.js': `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n`,

    'tailwind.config.js': `/** @type {import('tailwindcss').Config} */\nexport default {\n  darkMode: ["class"],\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {\n      colors: {\n        border: "hsl(var(--border))",\n        input: "hsl(var(--input))",\n        ring: "hsl(var(--ring))",\n        background: "hsl(var(--background))",\n        foreground: "hsl(var(--foreground))",\n        primary: {\n          DEFAULT: "hsl(var(--primary))",\n          foreground: "hsl(var(--primary-foreground))",\n        },\n        secondary: {\n          DEFAULT: "hsl(var(--secondary))",\n          foreground: "hsl(var(--secondary-foreground))",\n        },\n        destructive: {\n          DEFAULT: "hsl(var(--destructive))",\n          foreground: "hsl(var(--destructive-foreground))",\n        },\n        muted: {\n          DEFAULT: "hsl(var(--muted))",\n          foreground: "hsl(var(--muted-foreground))",\n        },\n        accent: {\n          DEFAULT: "hsl(var(--accent))",\n          foreground: "hsl(var(--accent-foreground))",\n        },\n        popover: {\n          DEFAULT: "hsl(var(--popover))",\n          foreground: "hsl(var(--popover-foreground))",\n        },\n        card: {\n          DEFAULT: "hsl(var(--card))",\n          foreground: "hsl(var(--card-foreground))",\n        },\n      },\n      borderRadius: {\n        lg: "var(--radius)",\n        md: "calc(var(--radius) - 2px)",\n        sm: "calc(var(--radius) - 4px)",\n      },\n    },\n  },\n  plugins: [],\n}\n`,

    'index.html': `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <script>
      (function() {
        function reportError(event) {
          try {
            var msg = event?.error?.message || event?.message || event?.reason?.message || String(event?.reason || event || 'Unknown error');
            var file = event?.error?.fileName || event?.filename || '';
            var line = event?.error?.lineNumber || event?.lineno || 0;
            var stack = event?.error?.stack || event?.reason?.stack || '';
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({
                type: 'PREVIEW_RUNTIME_ERROR',
                message: msg,
                filename: file,
                lineno: line,
                stack: stack
              }, '*');
            }
          } catch (_) {}
        }
        window.addEventListener('error', reportError);
        window.addEventListener('unhandledrejection', reportError);
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,

    'src/main.jsx': `if (typeof window !== 'undefined') {
  const reportError = (event) => {
    try {
      const msg = event?.error?.message || event?.message || event?.reason?.message || String(event?.reason || event || 'Unknown error')
      const file = event?.error?.fileName || event?.filename || ''
      const line = event?.error?.lineNumber || event?.lineno || 0
      const stack = event?.error?.stack || event?.reason?.stack || ''
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'PREVIEW_RUNTIME_ERROR',
          message: msg,
          filename: file,
          lineno: line,
          stack: stack
        }, '*')
      }
    } catch (_) {}
  }
  window.addEventListener('error', reportError)
  window.addEventListener('unhandledrejection', reportError)
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,

    'src/index.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground antialiased;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}
`,

    'src/lib/utils.js': `import { clsx } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nexport function cn(...inputs) {\n  return twMerge(clsx(inputs));\n}\n`,

    'src/App.jsx': `export default function App() {\n  return (\n    <div className="flex min-h-screen items-center justify-center px-4 text-center">\n      <div>\n        <h1 className="text-3xl font-bold tracking-tight">${projectName}</h1>\n        <p className="mt-3 text-white/60">\n          Este proyecto se está construyendo. Pídele a la IA lo que necesites en el chat.\n        </p>\n      </div>\n    </div>\n  )\n}\n`,

    // Página 404 lista para usar apenas el proyecto tenga más de una ruta/vista. La IA la
    // importa y la muestra para cualquier path que no matchee (ver instrucciones del agente).
    'src/pages/NotFound.jsx': `export default function NotFound() {\n  return (\n    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">\n      <p className="text-7xl font-black tracking-tight text-white/15">404</p>\n      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Esta página no existe</h1>\n      <p className="mt-2 max-w-sm text-sm text-white/60">\n        Revisá la dirección o volvé al inicio.\n      </p>\n      <a\n        href="/"\n        className="mt-8 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/5"\n      >\n        Volver al inicio\n      </a>\n    </div>\n  )\n}\n`,

    'README.md': `# ${projectName}\n\nProyecto creado con FlowPro. Descríbele a la IA en el chat qué quieres construir.\n`,
  }

  if (withSupabase) {
    files['src/lib/supabase.js'] = SUPABASE_CLIENT
    files['.env.example'] = `VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n`
  }

  if (withVps) {
    files['src/lib/db.js'] = DB_PROXY_CLIENT
    files['src/lib/auth.js'] = AUTH_CLIENT
    files['.env.example'] = `VITE_DB_PROXY_URL=\nVITE_DB_PROXY_TOKEN=\nVITE_STORAGE_PROXY_URL=\nVITE_STORAGE_PROXY_TOKEN=\n`
  }

  // Preinstalar catálogo industrial de componentes shadcn/ui
  Object.assign(files, UI_COMPONENTS_SEED)

  return files
}

export const AUTH_CLIENT = `// src/lib/auth.js - Cliente Oficial de Autenticación de FlowPro
const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_AUTH_API_URL || import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;
  const projectId = import.meta.env.VITE_PROJECT_ID;
  if (projectId) return \`/api/projects/\${projectId}\`;
  const token = import.meta.env.VITE_DB_PROXY_TOKEN;
  if (token) return \`/api/projects/\${token}\`;
  return '/api/projects';
};

export const auth = {
  async signUp(email, password, metadata = {}) {
    const res = await fetch(\`\${getBaseUrl()}/auth/signup\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, metadata }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Error al interpretar respuesta' }));
    if (!res.ok) throw new Error(data.error || 'Error al registrarse');
    const token = data.token || data.data?.token;
    if (token) {
      localStorage.setItem('flowpro_token', token);
      localStorage.setItem('flowpro_db_session', token);
    }
    return data;
  },

  async signIn(email, password) {
    const res = await fetch(\`\${getBaseUrl()}/auth/login\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'Error al interpretar respuesta' }));
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
    const token = data.token || data.data?.token;
    if (token) {
      localStorage.setItem('flowpro_token', token);
      localStorage.setItem('flowpro_db_session', token);
    }
    return data;
  },

  async getUser() {
    const token = this.getToken();
    if (!token) return { user: null };
    const res = await fetch(\`\${getBaseUrl()}/auth/user\`, {
      headers: { Authorization: \`Bearer \${token}\` },
    });
    if (!res.ok) {
      this.signOut();
      return { user: null };
    }
    return res.json().catch(() => ({ user: null }));
  },

  signOut() {
    localStorage.removeItem('flowpro_token');
    localStorage.removeItem('flowpro_db_session');
    window.location.reload();
  },

  getToken() {
    return localStorage.getItem('flowpro_token') || localStorage.getItem('flowpro_db_session');
  },
};
`
