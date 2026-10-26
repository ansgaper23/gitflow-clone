import { supabase } from '../db/supabaseClient.js'

// Nombre de variable de entorno válido (mismo criterio de siempre: letras/números/_, no
// puede arrancar con número) — se valida antes de guardar para no terminar con algo que la
// app generada no pueda ni siquiera leer con import.meta.env.
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export async function listProjectSecrets(projectId) {
  const { data, error } = await supabase
    .from('project_secrets')
    .select('id, key, created_at')
    .eq('project_id', projectId)
    .order('key', { ascending: true })
  if (error) throw error
  return data
}

export async function upsertProjectSecret(projectId, key, value) {
  if (!KEY_RE.test(key)) {
    throw new Error('El nombre solo puede tener letras, números y guión bajo, y no puede empezar con un número')
  }
  const { data, error } = await supabase
    .from('project_secrets')
    .upsert({ project_id: projectId, key, value }, { onConflict: 'project_id,key' })
    .select('id, key, created_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteProjectSecret(projectId, secretId) {
  const { error } = await supabase.from('project_secrets').delete().eq('id', secretId).eq('project_id', projectId)
  if (error) throw error
}

// Para inyectar en el preview: acá SÍ hacen falta los valores reales, no solo las claves.
export async function getProjectSecretsMap(projectId) {
  const { data, error } = await supabase.from('project_secrets').select('key, value').eq('project_id', projectId)
  if (error) throw error
  return Object.fromEntries(data.map((s) => [s.key, s.value]))
}
