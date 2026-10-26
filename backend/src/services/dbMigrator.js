import fs from 'fs';
import path from 'path';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function importDatabaseZip(client, extractedPath) {
  try {
    await client.query('BEGIN;');

    // 1. Inyectar Shim Universal de Supabase (esquemas auth, storage, stubs y funciones)
    const shimPath = path.join(__dirname, '../sql/supabase-shim.sql');
    if (fs.existsSync(shimPath)) {
      const shimSql = fs.readFileSync(shimPath, 'utf8');
      await client.query(shimSql);
    }

    // 2. Ejecutar DDL sanitizado del proyecto
    const ddlPath = path.join(extractedPath, 'database/full_schema_structure.sql');
    if (fs.existsSync(ddlPath)) {
      let ddlSql = fs.readFileSync(ddlPath, 'utf8');
      // Sanitizar sentencias que requieren superusuario
      ddlSql = ddlSql
        .replace(/\bALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*;/gi, '/* [SANITIZED PRIVILEGES] */')
        .replace(/\bSET\s+session_replication_role\b[^;]*;/gi, '/* [SANITIZED REPLICATION] */')
        .replace(/\bOWNER\s+TO\b[^;]*;/gi, '/* [SANITIZED OWNER] */')
        .replace(/CREATE\s+ROLE\s+[^;]+;/gi, '/* [SANITIZED CREATE ROLE] */')
        .replace(/ALTER\s+ROLE\s+[^;]+;/gi, '/* [SANITIZED ALTER ROLE] */');

      await client.query(ddlSql);
    }

    // 3. Importación de CSVs con validación de tamaño (omite 0 bytes)
    const csvDir = path.join(extractedPath, 'tablas_csv');
    if (fs.existsSync(csvDir)) {
      const csvFiles = fs.readdirSync(csvDir).filter(f => f.endsWith('.csv'));

      // Ordenar topológicamente no está en la propuesta original, pero si falla por FK lo dejaremos como propuso el user.
      for (const file of csvFiles) {
        const filePath = path.join(csvDir, file);
        const tableName = path.basename(file, '.csv');
        const stats = fs.statSync(filePath);

        // Guardia crítica: omitir tablas vacías para evitar colapso de COPY
        if (stats.size === 0) {
          console.warn(`[Migrator] Omitiendo tabla vacía (0 bytes): ${tableName}`);
          continue;
        }

        const copyQuery = `COPY public."${tableName}" FROM STDIN WITH (FORMAT csv, HEADER true, ENCODING 'utf-8');`;
        const dbStream = client.query(copyFrom(copyQuery));
        const fileStream = fs.createReadStream(filePath);

        await pipeline(fileStream, dbStream);
      }
    }

    // 4. Sincronizar secuencias automáticas al valor máximo real
    await client.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN
          SELECT table_name, column_name, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (column_default LIKE 'nextval%' OR is_identity = 'YES')
        LOOP
          EXECUTE format(
            'SELECT setval(pg_get_serial_sequence(%L, %L), coalesce(max(%I), 1), max(%I) IS NOT NULL) FROM %I',
            r.table_name, r.column_name, r.column_name, r.column_name, r.table_name
          );
        END LOOP;
      END $$;
    `);

    await client.query('COMMIT;');
    return { success: true };

  } catch (err) {
    // 5. Rollback inmediato para no dejar la conexión en estado abortado
    try {
      await client.query('ROLLBACK;');
    } catch (rbErr) {
      console.error('[Migrator] Error durante ROLLBACK:', rbErr.message);
    }

    const detailedMessage = [
      err.message,
      err.detail && `Detalle: ${err.detail}`,
      err.hint && `Sugerencia: ${err.hint}`,
      err.position && `Posición: ${err.position}`
    ].filter(Boolean).join(' | ');

    throw new Error(`Fallo en la importación: ${detailedMessage}`);
  }
}
