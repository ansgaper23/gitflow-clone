import pg from 'pg'
import { runManagementQuery } from './supabaseOAuth.js'
import { dumpContainsCopy, runDumpImport } from './dumpImporter.js'

const { Client } = pg

async function withClient(connectionString, fn) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
    statement_timeout: 30000,
    query_timeout: 30000,
  })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

// "_flowpro_users" es infraestructura de auth de la base automática (ver vpsPostgres.js), no
// una tabla de la app — nunca se le muestra a la IA como "tabla existente" ni aparece en el
// visor de datos del editor, para que no la trate como una tabla más para editar/borrar.
const SCHEMA_QUERY = `
  SELECT 
    t.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name 
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' 
        AND tc.table_name = t.table_name 
        AND kcu.column_name = c.column_name
    ) AS is_primary_key,
    (
      SELECT ccu.table_name 
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' 
        AND tc.table_name = t.table_name 
        AND kcu.column_name = c.column_name
      LIMIT 1
    ) AS references_table,
    COALESCE(pt.rowsecurity, false) AS rls_enabled
  FROM information_schema.tables t
  JOIN information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
  LEFT JOIN pg_tables pt ON pt.tablename = t.table_name AND pt.schemaname = 'public'
  WHERE t.table_schema = 'public' 
    AND t.table_type = 'BASE TABLE'
    AND t.table_name NOT LIKE '_flowpro_%'
  ORDER BY t.table_name, c.ordinal_position;
`;

function summarizeSchemaRows(rows) {
  const schemaDetails = {};
  for (const r of rows) {
    if (!schemaDetails[r.table_name]) {
      schemaDetails[r.table_name] = [];
    }
    schemaDetails[r.table_name].push(r.column_name);
  }
  return schemaDetails;
}

// `conn` es { type: 'manual', connectionString } o { type: 'oauth', accessToken, projectRef }

export async function testConnection(conn) {
  if (conn.type === 'oauth') {
    await runManagementQuery(conn.accessToken, conn.projectRef, 'select 1')
    return
  }
  await withClient(conn.connectionString, (client) => client.query('select 1'))
}

// Cuenta aproximada por tabla (vía pg_stat_user_tables.n_live_tup — lo que Postgres ya lleva
// contado solo, no un COUNT(*) real por tabla) — pensado para que la IA pueda CONFIRMAR de
// verdad si datos que se supone se importaron/migraron están ahí, en vez de inventar una
// respuesta (ver "check_db_data" en agent.js). Es una estimación (se actualiza con
// autovacuum/analyze, no al instante de cada insert) — de sobra para distinguir "tiene datos
// reales" de "está vacía", no pensado para un conteo exacto al dígito.
const ROW_COUNT_QUERY = `
  select relname as table_name, n_live_tup as row_count
  from pg_stat_user_tables
  where schemaname = 'public' and relname != '_flowpro_users'
  order by relname
`

// De qué "names" (funciones que el código llama vía supabase.rpc(...), ver
// supabaseReferenceScanner.js#scanForMissingRpcFunctions) existe de verdad como función en la
// base conectada — para detectar de antemano las que faltan después de migrar (un backup de
// datos nunca trae funciones/triggers propios).
export async function getExistingFunctionNames(conn, names) {
  if (!names?.length) return []
  const list = names.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(',')
  const sql = `select routine_name from information_schema.routines where routine_schema = 'public' and routine_name in (${list})`
  const rows =
    conn.type === 'oauth'
      ? await runManagementQuery(conn.accessToken, conn.projectRef, sql)
      : await withClient(conn.connectionString, async (client) => (await client.query(sql)).rows)
  return rows.map((r) => r.routine_name)
}

export async function getTableRowCounts(conn) {
  const rows =
    conn.type === 'oauth'
      ? await runManagementQuery(conn.accessToken, conn.projectRef, ROW_COUNT_QUERY)
      : await withClient(conn.connectionString, async (client) => (await client.query(ROW_COUNT_QUERY)).rows)
  return rows.map((r) => ({ table: r.table_name, rows: Number(r.row_count) }))
}

export async function getSchemaSummary(conn) {
  if (conn.type === 'oauth') {
    const rows = await runManagementQuery(conn.accessToken, conn.projectRef, SCHEMA_QUERY)
    return summarizeSchemaRows(rows)
  }
  return withClient(conn.connectionString, async (client) => {
    const { rows } = await client.query(SCHEMA_QUERY)
    return summarizeSchemaRows(rows)
  })
}

// Nombre de tabla válido en Postgres sin comillas (mismo criterio que usa el propio Postgres
// para identificadores sin comillar) — se valida ANTES de interpolarlo en una consulta, porque
// a diferencia de un valor, el nombre de una tabla no se puede parametrizar con $1.
const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// Metadata Resolver Global y Transversal de Tablas para FlowPro.
// Compatible con PostgreSQL nativo (VPS), conexiones directas (manual) y Supabase OAuth (Management API).
export async function fetchGlobalTableMetadata(conn) {
  const query = `
    SELECT 
      t.table_name,
      COALESCE(c.relrowsecurity, false) AS rls_enabled,
      (
        SELECT count(*)::int 
        FROM information_schema.columns col 
        WHERE col.table_schema = 'public' AND col.table_name = t.table_name
      ) AS column_count,
      (
        SELECT json_agg(json_build_object(
          'column_name', col.column_name,
          'name', col.column_name,
          'data_type', col.data_type,
          'type', col.data_type,
          'is_nullable', col.is_nullable = 'YES',
          'is_primary', EXISTS (
            SELECT 1 FROM information_schema.key_column_usage kcu
            JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY' 
              AND kcu.table_schema = 'public' 
              AND kcu.table_name = t.table_name 
              AND kcu.column_name = col.column_name
          )
        ) ORDER BY col.ordinal_position)
        FROM information_schema.columns col
        WHERE col.table_schema = 'public' AND col.table_name = t.table_name
      ) AS columns
    FROM information_schema.tables t
    LEFT JOIN pg_class c ON c.relname = t.table_name
    LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE t.table_schema = 'public' 
      AND t.table_type = 'BASE TABLE' 
      AND (c.relkind IS NULL OR c.relkind = 'r')
      AND t.table_name NOT LIKE '_flowpro_%'
    ORDER BY t.table_name ASC;
  `;

  let rawTables = [];
  try {
    const result = await runCloudQuery(conn, query);
    rawTables = result.rows || [];
  } catch (err) {
    console.error('[fetchGlobalTableMetadata] Error al consultar esquema de tablas:', err.message);
    try {
      const fallbackQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE' 
          AND table_name NOT LIKE '_flowpro_%'
        ORDER BY table_name ASC;
      `;
      const fallbackRes = await runCloudQuery(conn, fallbackQuery);

      // Consulta de respaldo de columnas agrupadas por tabla
      let colsByTable = {};
      try {
        const colsRes = await runCloudQuery(conn, `
          SELECT table_name, column_name, data_type, is_nullable, ordinal_position
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name NOT LIKE '_flowpro_%'
          ORDER BY table_name, ordinal_position ASC
        `);
        for (const col of (colsRes.rows || [])) {
          if (!colsByTable[col.table_name]) colsByTable[col.table_name] = [];
          colsByTable[col.table_name].push({
            name: col.column_name,
            column_name: col.column_name,
            type: col.data_type,
            data_type: col.data_type,
            is_nullable: col.is_nullable === 'YES',
            is_primary: col.column_name === 'id'
          });
        }
      } catch (colsErr) {
        console.warn('[fetchGlobalTableMetadata] Error en cols de fallback:', colsErr.message);
      }

      rawTables = (fallbackRes.rows || []).map((r) => {
        const tblCols = colsByTable[r.table_name] || [];
        return {
          table_name: r.table_name,
          rls_enabled: false,
          column_count: tblCols.length,
          columns: tblCols
        };
      });
    } catch (fbErr) {
      console.error('[fetchGlobalTableMetadata] Fallback falló:', fbErr.message);
      return [];
    }
  }

  // Conteo real por tabla ejecutando SELECT COUNT(*)::int FROM "public"."<tableName>"
  // con fallback silencioso ante tablas vacías o bloqueadas por RLS/permisos
  const tablesWithCounts = await Promise.all(
    rawTables.map(async (table) => {
      let row_count = 0;
      try {
        const safeName = String(table.table_name).replace(/"/g, '""');
        const countRes = await runCloudQuery(conn, `SELECT COUNT(*)::int AS count FROM "public"."${safeName}"`);
        const val = countRes.rows?.[0]?.count ?? countRes.rows?.[0]?.c;
        if (val !== undefined && val !== null) {
          row_count = parseInt(val, 10);
          if (isNaN(row_count) || row_count < 0) row_count = 0;
        }
      } catch (countErr) {
        // Fallback silencioso ante tablas vacías o bloqueadas por RLS / permisos
        row_count = 0;
      }

      const normalizedColumns = (table.columns || []).map((c) => ({
        name: c.name || c.column_name,
        column_name: c.name || c.column_name,
        type: c.type || c.data_type || 'text',
        data_type: c.type || c.data_type || 'text',
        is_nullable: c.is_nullable !== false,
        is_primary: Boolean(c.is_primary || c.is_pk || (c.name || c.column_name) === 'id')
      }));

      return {
        table_name: table.table_name,
        name: table.table_name,
        row_count,
        column_count: parseInt(table.column_count || 0, 10) || normalizedColumns.length,
        rls_enabled: Boolean(table.rls_enabled),
        columns: normalizedColumns
      };
    })
  );

  return tablesWithCounts;
}

/**
 * Consulta las columnas completas de una tabla específica desde information_schema.columns
 * ordenadas por ordinal_position con tipado y detección de primary key.
 */
export async function fetchTableColumns(conn, tableName) {
  if (!tableName) return [];
  const safeName = String(tableName).replace(/'/g, "''");
  try {
    const query = `
      SELECT 
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.ordinal_position,
        EXISTS (
          SELECT 1 
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.table_constraints tc 
            ON kcu.constraint_name = tc.constraint_name 
            AND kcu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY' 
            AND kcu.table_schema = 'public' 
            AND kcu.table_name = '${safeName}' 
            AND kcu.column_name = c.column_name
        ) AS is_primary
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' 
        AND c.table_name = '${safeName}'
      ORDER BY c.ordinal_position ASC;
    `;
    const res = await runCloudQuery(conn, query);
    if (res.rows && res.rows.length > 0) {
      return res.rows.map((col) => ({
        name: col.column_name,
        column_name: col.column_name,
        type: col.data_type,
        data_type: col.data_type,
        is_nullable: col.is_nullable === 'YES',
        is_primary: Boolean(col.is_primary)
      }));
    }
  } catch (err) {
    console.warn(`[fetchTableColumns] Consulta primaria falló para ${tableName}:`, err.message);
  }

  // Fallback simple ante restricciones o vistas especiales
  try {
    const fallbackSql = `
      SELECT column_name, data_type, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${safeName}'
      ORDER BY ordinal_position ASC;
    `;
    const res = await runCloudQuery(conn, fallbackSql);
    return (res.rows || []).map((col) => ({
      name: col.column_name,
      column_name: col.column_name,
      type: col.data_type,
      data_type: col.data_type,
      is_nullable: col.is_nullable === 'YES',
      is_primary: col.column_name === 'id'
    }));
  } catch (fbErr) {
    console.error(`[fetchTableColumns] Fallback falló para ${tableName}:`, fbErr.message);
    return [];
  }
}

// Estructurado — pensado para listar tablas con su conteo real de filas, columnas y RLS en la UI.
export async function listTables(conn) {
  return fetchGlobalTableMetadata(conn);
}

// Trae hasta `limit` filas de una tabla puntual — valida el nombre contra un allowlist
// construido en el momento (las tablas reales del esquema) antes de armar el SQL, ya que un
// identificador de tabla no se puede pasar como parámetro como sí se hace con un valor.
export async function getTableRows(conn, tableName, limit = 50) {
  if (!SAFE_IDENTIFIER_RE.test(tableName)) throw new Error('Nombre de tabla inválido')
  const tables = await listTables(conn)
  if (!tables.some((t) => t.name === tableName)) throw new Error(`La tabla "${tableName}" no existe en el esquema public`)

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
  const sql = `select * from "${tableName}" limit ${safeLimit}`
  const { rows } = await runSql(conn, sql)
  return rows
}

// Escapa valores para literales en SQL.
// string -> 'texto''escapado'
// number/boolean -> literal
// null -> NULL
function escapeValue(val) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  return `'${String(val).replace(/'/g, "''")}'`
}

export async function insertTableRow(conn, tableName, data) {
  if (!SAFE_IDENTIFIER_RE.test(tableName)) throw new Error('Nombre de tabla inválido')

  const cols = Object.keys(data)
  if (cols.length === 0) throw new Error('No hay datos para insertar')
  for (const c of cols) {
    if (!SAFE_IDENTIFIER_RE.test(c)) throw new Error('Nombre de columna inválido')
  }

  const columnsStr = cols.map(c => `"${c}"`).join(', ')
  const valuesStr = cols.map(c => escapeValue(data[c])).join(', ')

  const sql = `INSERT INTO "${tableName}" (${columnsStr}) VALUES (${valuesStr}) RETURNING *`
  const { rows } = await runSql(conn, sql)
  return rows[0]
}

export async function updateTableRow(conn, tableName, pkColumn, pkValue, data) {
  if (!SAFE_IDENTIFIER_RE.test(tableName)) throw new Error('Nombre de tabla inválido')
  if (!SAFE_IDENTIFIER_RE.test(pkColumn)) throw new Error('Nombre de columna primaria inválido')

  const cols = Object.keys(data)
  if (cols.length === 0) return null
  for (const c of cols) {
    if (!SAFE_IDENTIFIER_RE.test(c)) throw new Error('Nombre de columna inválido')
  }

  const setStr = cols.map(c => `"${c}" = ${escapeValue(data[c])}`).join(', ')
  const sql = `UPDATE "${tableName}" SET ${setStr} WHERE "${pkColumn}" = ${escapeValue(pkValue)} RETURNING *`

  const { rows } = await runSql(conn, sql)
  return rows[0]
}

export async function deleteTableRow(conn, tableName, pkColumn, pkValue) {
  if (!SAFE_IDENTIFIER_RE.test(tableName)) throw new Error('Nombre de tabla inválido')
  if (!SAFE_IDENTIFIER_RE.test(pkColumn)) throw new Error('Nombre de columna primaria inválido')

  const sql = `DELETE FROM "${tableName}" WHERE "${pkColumn}" = ${escapeValue(pkValue)} RETURNING *`
  const { rows } = await runSql(conn, sql)
  return rows[0]
}

export async function runSql(conn, sql) {
  if (dumpContainsCopy(sql)) {
    if (conn.type === 'oauth') {
      throw new Error(
        'Este SQL usa sentencias COPY (típico de un dump de pg_dump), que la conexión OAuth/Management API no soporta. Conecta este repo con el connection string directo de Postgres (modo manual) para poder importarlo.',
      )
    }
    const result = await runDumpImport(conn.connectionString, sql)
    return { rowCount: result.rowsCopied, rows: [], statementsRun: result.statementsRun }
  }

  if (conn.type === 'oauth') {
    const rows = await runManagementQuery(conn.accessToken, conn.projectRef, sql)
    return { rowCount: Array.isArray(rows) ? rows.length : 0, rows: (rows || []).slice(0, 20) }
  }
  return withClient(conn.connectionString, async (client) => {
    try {
      const result = await client.query(sql)
      const lastResult = Array.isArray(result) ? result[result.length - 1] : result
      const totalRowCount = Array.isArray(result)
        ? result.reduce((acc, r) => acc + (r?.rowCount || 0), 0)
        : (result?.rowCount ?? 0)
      const allRows = Array.isArray(result)
        ? result.flatMap(r => r?.rows || [])
        : (result?.rows || [])
      return {
        rowCount: totalRowCount,
        rows: allRows.slice(0, 50),
      }
    } catch (sqlErr) {
      if (sqlErr.code === '42P07' || /already exists/i.test(sqlErr.message)) {
        console.warn(`[DDL IDEMPOTENCY] Advertencia idempotente (42P07 / ya existe): ${sqlErr.message}`);
        return {
          rowCount: 0,
          rows: [],
          warning: sqlErr.message,
          idempotent: true,
        };
      }
      throw sqlErr;
    }
  })
}

/**
 * Divide sentencias SQL respetando estrictamente bloques con dollar-quoting ($$...$$ o $tag$...$tag$).
 * NUNCA divide por ';' si el punto y coma se encuentra dentro de un bloque DO, función o procedimiento.
 */
export function splitSqlStatements(sql) {
  if (!sql || typeof sql !== 'string') return []
  const statements = []
  let current = ''
  let i = 0
  let dollarTag = null

  while (i < sql.length) {
    if (dollarTag === null) {
      const dollarMatch = /^\$([a-zA-Z0-9_]*)\$/.exec(sql.slice(i, i + 64))
      if (dollarMatch) {
        dollarTag = dollarMatch[0]
        current += dollarTag
        i += dollarTag.length
        continue
      }
      current += sql[i]
      if (sql[i] === ';') {
        if (current.trim()) statements.push(current.trim())
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
  if (current.trim()) statements.push(current.trim())
  return statements
}

export async function runCloudQuery(conn, sql, params = []) {
  if (conn.type === 'oauth') {
    // The Management API doesn't support parameterized queries easily via simple REST wrapper,
    // but the cloud panel only uses params for simple stuff. Let's interpolate carefully or avoid params.
    // Actually, runManagementQuery only takes (accessToken, projectRef, query). 
    // We must format queries before calling this for oauth.
    const rows = await runManagementQuery(conn.accessToken, conn.projectRef, sql)
    return { rowCount: Array.isArray(rows) ? rows.length : 0, rows: rows || [] }
  }
  return withClient(conn.connectionString, async (client) => {
    const result = await client.query(sql, params)
    return {
      rowCount: result.rowCount ?? 0,
      rows: result.rows || [],
    }
  })
}
