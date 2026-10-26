import { Client } from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import fs from 'fs'
import path from 'path'
import { upsertProjectSecret } from './projectSecrets.js'
import { restartPreviewIfRunning } from './previewOrchestrator.js'

export async function executeRemoteSupabaseMigration(projectId, user, credentials, zipExtractPath) {
  let { dbUri, supabaseUrl, anonKey, serviceRoleKey, projectRef, dbPassword, password } = credentials

  const rawPassword = dbPassword || password;
  
  let client;
  if (!dbUri) {
    if (!rawPassword) {
      throw new Error('La contraseña de la base de datos de Supabase no fue proporcionada o está vacía.');
    }
    const safePassword = String(rawPassword).trim();
    if (safePassword.length === 0) {
      throw new Error('La contraseña de la base de datos no puede ser una cadena vacía.');
    }
    supabaseUrl = `https://${projectRef}.supabase.co`;
    const host = `db.${projectRef}.supabase.co`;
    
    client = new Client({
      host,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: safePassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000
    });
    
    // Almacenamos el dbUri para guardarlo como secreto despues
    const safePasswordEncoded = encodeURIComponent(safePassword);
    dbUri = `postgres://postgres:${safePasswordEncoded}@${host}:5432/postgres`;
  } else {
    client = new Client({
      connectionString: dbUri,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000
    });
  }

  try {
    try {
      // Configuramos timeout de conexión a 15 segundos para detectar proyectos pausados
      await Promise.race([
        client.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connection timeout')), 15000))
      ])
    } catch (err) {
      if (err.message.includes('timeout') || err.message.includes('504')) {
        throw new Error('El proyecto de Supabase parece estar pausado o despertando. Por favor, asegúrate de reactivarlo en supabase.com/dashboard');
      }
      throw err;
    }
    await client.query('BEGIN;')

    // 2. Ejecutar DDL (Tablas, Enums, Funciones de Negocio y Triggers)
    const ddlPath = path.join(zipExtractPath, 'database/full_schema_structure.sql')
    if (fs.existsSync(ddlPath)) {
      const ddlSql = sanitizeDdlForSupabaseCloud(fs.readFileSync(ddlPath, 'utf8'))
      await client.query(ddlSql)
    }

    // 3. Importación concurrente o por lotes de CSVs con pg-copy-streams
    const csvDir = path.join(zipExtractPath, 'tablas_csv')
    if (fs.existsSync(csvDir)) {
      await client.query("SET session_replication_role = 'replica';")
      const csvFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.csv'))

      for (const file of csvFiles) {
        const tableName = file.replace('.csv', '')
        const filePath = path.join(csvDir, file)
        
        // Omitir tablas sin registros
        if (fs.statSync(filePath).size === 0) continue

        await new Promise((resolve, reject) => {
          const copyQuery = `COPY public."${tableName}" FROM STDIN WITH (FORMAT csv, HEADER true, ENCODING 'utf-8')`
          const stream = client.query(copyFrom(copyQuery))
          const fileStream = fs.createReadStream(filePath)

          fileStream.on('error', reject)
          stream.on('error', reject)
          stream.on('finish', resolve)

          fileStream.pipe(stream)
        })
      }
      await client.query("SET session_replication_role = 'origin';")
    }

    // 4. Sincronización de secuencias autonuméricas
    await client.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN SELECT table_name, column_name, column_default 
                 FROM information_schema.columns 
                 WHERE table_schema = 'public' AND (column_default LIKE 'nextval%' OR is_identity = 'YES') 
        LOOP
          EXECUTE format('SELECT setval(pg_get_serial_sequence(%L, %L), coalesce(max(%I), 1), max(%I) IS NOT NULL) FROM %I',
                         r.table_name, r.column_name, r.column_name, r.column_name, r.table_name);
        END LOOP;
      END $$;
    `)

    await client.query('COMMIT;')

    // 5. Inyección de variables de entorno
    await upsertProjectSecret(projectId, 'VITE_SUPABASE_URL', supabaseUrl)
    await upsertProjectSecret(projectId, 'VITE_SUPABASE_ANON_KEY', anonKey)
    await upsertProjectSecret(projectId, 'SUPABASE_SERVICE_ROLE_KEY', serviceRoleKey)
    await upsertProjectSecret(projectId, 'SUPABASE_DB_URI', dbUri)

    // 6. Hard-restart del proceso Vite
    const ownerKey = `user:${user.id}`
    await restartPreviewIfRunning(ownerKey, { id: projectId, repo_full_name: `flowpro-project-${projectId}` })

    return { success: true }

  } catch (err) {
    try { await client.query('ROLLBACK;') } catch (e) {}
    throw new Error(`Error en migración remota a Supabase: ${err.message} (Detalle: ${err.detail || 'N/A'})`)
  } finally {
    try { await client.end() } catch (e) {}
  }
}

/**
 * Sanitiza el SQL del esquema para evitar errores de permisos sobre
 * tablas gestionadas por Supabase Cloud (storage, auth, etc.)
 */
function sanitizeDdlForSupabaseCloud(sqlContent) {
  return sqlContent
    // 1. Eliminar cualquier cambio de propietario (OWNER TO ...)
    .replace(/ALTER\s+TABLE\s+[^;]+OWNER\s+TO\s+[^;]+;/gi, '-- [STRIPPED OWNER TO]')
    .replace(/ALTER\s+FUNCTION\s+[^;]+OWNER\s+TO\s+[^;]+;/gi, '-- [STRIPPED OWNER TO]')
    .replace(/ALTER\s+SCHEMA\s+[^;]+OWNER\s+TO\s+[^;]+;/gi, '-- [STRIPPED OWNER TO]')
    .replace(/ALTER\s+TYPE\s+[^;]+OWNER\s+TO\s+[^;]+;/gi, '-- [STRIPPED OWNER TO]')
    
    // 2. Eliminar creación o alteración estructural de tablas de storage y auth
    .replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["']?storage["']?\.["']?objects["']?[^;]+;/gi, '-- [STRIPPED storage.objects CREATE]')
    .replace(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?["']?storage["']?\.["']?buckets["']?[^;]+;/gi, '-- [STRIPPED storage.buckets CREATE]')
    .replace(/ALTER\s+TABLE\s+(ONLY\s+)?["']?storage["']?\.["']?[a-zA-Z0-9_]+["']?[^;]+;/gi, '-- [STRIPPED storage ALTER TABLE]')
    .replace(/ALTER\s+TABLE\s+(ONLY\s+)?["']?auth["']?\.["']?[a-zA-Z0-9_]+["']?[^;]+;/gi, '-- [STRIPPED auth ALTER TABLE]')
    
    // 3. Omitir sentencias ENABLE ROW LEVEL SECURITY sobre tablas que ya la tienen activada por el sistema
    .replace(/ALTER\s+TABLE\s+(ONLY\s+)?["']?storage["']?\.["']?objects["']?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY;/gi, '-- [STRIPPED]')
    .replace(/ALTER\s+TABLE\s+(ONLY\s+)?["']?storage["']?\.["']?objects["']?\s+FORCE\s+ROW\s+LEVEL\s+SECURITY;/gi, '-- [STRIPPED]');
}