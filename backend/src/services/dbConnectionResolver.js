import { supabase } from '../db/supabaseClient.js'
import { getValidAccessToken } from './supabaseOAuth.js'

// Devuelve { type: 'manual', connectionString } | { type: 'oauth', accessToken, projectRef } | null
export async function resolveDbConnection(user, repoFullName) {
  const { data: row } = await supabase
    .from('repo_db_connections')
    .select('*')
    .eq('user_id', user.id)
    .eq('repo_full_name', repoFullName)
    .maybeSingle()

  if (!row) return null

  if (row.connection_type === 'oauth') {
    if (!row.supabase_account_id) {
      throw new Error('Esta conexión de Supabase quedó de una versión anterior sin cuenta vinculada — desconectala y volvé a conectar el proyecto.')
    }
    const { data: account } = await supabase
      .from('supabase_oauth_accounts')
      .select('*')
      .eq('id', row.supabase_account_id)
      .maybeSingle()
    if (!account) {
      throw new Error('La cuenta de Supabase vinculada a este proyecto ya no existe — volvé a conectar el proyecto.')
    }
    const accessToken = await getValidAccessToken(account)
    return { type: 'oauth', accessToken, projectRef: row.project_ref }
  }

  // 'vps' (base de datos automática en el Postgres del VPS) corre el mismo camino que 'manual'
  // para todo lo que ejecuta SQL server-side (repoDb.js no necesita saber la diferencia) — pero
  // además lleva "isVps"/"publicToken" para que previewEnv.js sepa armarle a la app publicada las
  // variables del proxy REST (routes/dbProxy.js) en vez de las de Supabase.
  if (row.connection_type === 'vps') {
    // "vpsDatabaseName" identifica también la carpeta de Storage de este proyecto en el VPS
    // (ver flowStorage.js) — mismo nombre que la base de Postgres, no hace falta otro id.
    return {
      type: 'manual',
      connectionString: row.connection_string,
      isVps: true,
      publicToken: row.public_token,
      vpsDatabaseName: row.vps_database_name,
    }
  }
  return { type: 'manual', connectionString: row.connection_string }
}
