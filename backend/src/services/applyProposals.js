import { supabase } from '../db/supabaseClient.js'
import { writeProjectFiles, writeProjectFile } from './projectStorage.js'
import { runSql } from './repoDb.js'
import { invalidateSchemaCache } from './agent.js'
import { ensureAuthHelpers } from './vpsPostgres.js'
import { getServiceRoleKey, uploadToStorage } from './supabaseStorage.js'

// Aplica de una todos los cambios de CÓDIGO pendientes de un turno, en un solo commit — mejor
// historial de git que un commit por archivo (como era antes), y es lo que hace que "un pedido
// normal" y "una etapa de un plan largo" se sientan como UNA sola acción del lado del usuario,
// sea que se haya aplicado sola o con el botón único de aprobar (ver routes/conversations.js y
// routes/turnActions.js). Devuelve null si no había nada pendiente.
export async function applyCodeChanges(project, accessToken, changeRows) {
  if (!changeRows?.length) return null

  const files = {}
  for (const c of changeRows) files[c.file_path] = c.new_content
  const summary = changeRows.length === 1 ? changeRows[0].summary : `${changeRows.length} archivos actualizados`

  const { commitUrl, commitSha } = await writeProjectFiles(project, accessToken, files, summary)

  const { data: updated, error } = await supabase
    .from('proposed_changes')
    .update({ status: 'applied', commit_url: commitUrl })
    .in(
      'id',
      changeRows.map((c) => c.id),
    )
    .select('*')
  if (error) throw error

  return { updated, commitSha, summary }
}

// Cambios de BASE DE DATOS: a diferencia del código, no hay un "commit único" equivalente —
// cada SQL se corre por separado (son statements independientes, normal que un turno grande
// traiga más de uno), pero desde el punto de vista del usuario sigue siendo una sola acción (un
// solo click, o ninguno si se aplicó sola). "resolveConn" es la función resolveDbConnection ya
// atada al usuario — se pasa así para no importar auth acá adentro.
export async function applyDbChanges(dbChangeRows, resolveConn, onStreamEvent) {
  if (!dbChangeRows?.length) return []

  const updated = []
  for (const change of dbChangeRows) {
    const conn = await resolveConn(change.repo_full_name)
    if (!conn) throw new Error('No hay una base de datos conectada para este repositorio')
    try {
      if (conn.isVps) await ensureAuthHelpers(conn.connectionString).catch(() => {})

      if (onStreamEvent) {
        onStreamEvent({ type: 'DATABASE_MIGRATING', payload: { name: change.summary } });
      }

      await runSql(conn, `
        CREATE TABLE IF NOT EXISTS public._flowpro_migrations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text NOT NULL,
            up_sql text NOT NULL,
            executed_at timestamptz DEFAULT now()
        );
      `).catch(() => {});

      const migrationName = (change.summary || 'migration').replace(/'/g, "''");
      const upSqlEscaped = (change.sql || '').replace(/'/g, "''");

      let txnSql;
      const upperSql = (change.sql || '').toUpperCase();
      if (upperSql.includes('BEGIN;') || upperSql.includes('CREATE INDEX CONCURRENTLY') || upperSql.includes('ALTER TYPE')) {
        txnSql = `
${change.sql};
INSERT INTO public._flowpro_migrations (name, up_sql) VALUES ('${migrationName}', '${upSqlEscaped}');
`;
      } else {
        txnSql = `
BEGIN;
${change.sql}
INSERT INTO public._flowpro_migrations (name, up_sql) VALUES ('${migrationName}', '${upSqlEscaped}');
COMMIT;
        `;
      }
      const result = await runSql(conn, txnSql)

      // Post-migración: verificar con SELECT en information_schema que la tabla existe en la MISMA base que muestra el panel Cloud; si no, error.
      const extractCreatedTableNames = (sql) => {
        const tables = []
        const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["']?([a-zA-Z0-9_]+)["']?\.)?["']?([a-zA-Z0-9_]+)["']?/gi
        let m
        while ((m = re.exec(sql || '')) !== null) {
          const name = m[2]
          if (name && !name.startsWith('_flowpro_') && !tables.includes(name)) {
            tables.push(name)
          }
        }
        return tables
      }

      const expectedTables = extractCreatedTableNames(change.sql)
      for (const table of expectedTables) {
        const verifyRes = await runSql(
          conn,
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table.replace(/'/g, "''")}'`,
        )
        const rows = verifyRes?.rows || []
        if (rows.length === 0 && (verifyRes?.rowCount || 0) === 0) {
          throw new Error(`Verificación post-migración falló: la tabla "${table}" no existe en el esquema public de la base de datos tras ejecutar la migración.`)
        }
      }
      
      if (onStreamEvent) {
        onStreamEvent({ type: 'DATABASE_MIGRATED', payload: { name: change.summary, success: true } });
      }

      const { data, error } = await supabase
        .from('proposed_db_changes')
        .update({ status: 'applied', result: JSON.stringify(result) })
        .eq('id', change.id)
        .select('*')
        .single()
      if (error) throw error
      invalidateSchemaCache(conn)
      updated.push(data)
    } catch (err) {
      if (onStreamEvent) {
        onStreamEvent({ type: 'DATABASE_MIGRATED', payload: { name: change.summary, success: false, error: err.message } });
      }
      await runSql(conn, 'ROLLBACK;').catch(()=>{});
      await supabase.from('proposed_db_changes').update({ result: `Error: ${err.message}` }).eq('id', change.id)
      throw err
    }
  }
  return updated
}

export async function applyAssetChanges(project, accessToken, assetRows, resolveConn) {
  if (!assetRows?.length) return []

  const updated = []
  for (const change of assetRows) {
    try {
      if (change.target === 'github') {
        const { commitUrl, commitSha } = await writeProjectFile(project, accessToken, {
          path: change.path,
          newContent: change.file_base64,
          summary: change.summary,
          contentIsBase64: true,
        })
        const { data, error } = await supabase
          .from('proposed_asset_changes')
          .update({ status: 'applied', commit_url: commitUrl })
          .eq('id', change.id)
          .select('*')
          .single()
        if (error) throw error
        updated.push({ ...data, commitSha })
      } else if (change.target === 'storage') {
        const conn = await resolveConn(change.repo_full_name)
        if (!conn || conn.type !== 'oauth') throw new Error('No hay conexin OAuth para storage')
        const serviceRoleKey = await getServiceRoleKey(conn.accessToken, conn.projectRef)
        const { publicUrl } = await uploadToStorage({
          projectRef: conn.projectRef,
          serviceRoleKey,
          bucket: change.bucket,
          path: change.path,
          buffer: Buffer.from(change.file_base64, 'base64'),
          mimeType: change.mime_type,
        })
        const { data, error } = await supabase
          .from('proposed_asset_changes')
          .update({ status: 'applied', public_url: publicUrl })
          .eq('id', change.id)
          .select('*')
          .single()
        if (error) throw error
        updated.push(data)
      }
    } catch (err) {
      await supabase.from('proposed_asset_changes').update({ result: `Error: ${err.message}` }).eq('id', change.id)
      console.error('No se pudo aplicar asset:', err.message)
    }
  }
  return updated
}
