import { supabase } from '../db/supabaseClient.js'

// Igual que projectSecrets.js, pero para secrets de SERVIDOR (Edge Functions) — nunca se
// mezclan con los del cliente para no arriesgarse a hornear por error una clave secreta en el
// bundle público. Ver services/edgeFunctions.js para el push real a Supabase.
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export async function listProjectServerSecrets(projectId) {
  const { data, error } = await supabase
    .from('project_server_secrets')
    .select('id, key, created_at')
    .eq('project_id', projectId)
    .order('key', { ascending: true })
  if (error) throw error
  return data
}

export async function upsertProjectServerSecret(projectId, key, value) {
  if (!KEY_RE.test(key)) {
    throw new Error('El nombre solo puede tener letras, números y guión bajo, y no puede empezar con un número')
  }
  if (key.startsWith('SUPABASE_')) {
    throw new Error('Los nombres que empiezan con "SUPABASE_" están reservados por Supabase')
  }
  const { data, error } = await supabase
    .from('project_server_secrets')
    .upsert({ project_id: projectId, key, value }, { onConflict: 'project_id,key' })
    .select('id, key, created_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteProjectServerSecret(projectId, secretId) {
  const { error } = await supabase.from('project_server_secrets').delete().eq('id', secretId).eq('project_id', projectId)
  if (error) throw error
}
