import crypto from 'node:crypto'
import { supabase } from '../db/supabaseClient.js'

export function slugify(text) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'proyecto'
  )
}

export function generateHumanProjectName(prompt, explicitName) {
  if (explicitName && explicitName.trim()) {
    return explicitName.trim()
  }
  const cleanPrompt = String(prompt || '').trim()
  const words = cleanPrompt.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, ' ').split(/\s+/).filter(Boolean)
  
  const FILLER_PREFIXES = new Set([
    'actua', 'como', 'un', 'una', 'crea', 'creame', 'haz', 'hazme', 
    'disena', 'disename', 'diseña', 'diseñame', 'quiero', 'necesito',
    'construye', 'construyeme', 'desarrolla', 'desarrollame'
  ])
  const STOP_WORDS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'en', 'para', 'con', 'y', 'o', 'al'])

  let start = 0
  while (start < words.length && start < 4) {
    const w = words[start].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (FILLER_PREFIXES.has(w)) start++
    else break
  }

  const meaningful = words.slice(start, start + 4)
  const chosen = (meaningful.length > 0 ? meaningful : words.slice(0, 3))
  const titleCased = chosen.map((w, i) => {
    const low = w.toLowerCase()
    if (i > 0 && STOP_WORDS.has(low)) return low
    if (/^[A-Z0-9]{2,5}$/.test(w)) return w
    return low.charAt(0).toUpperCase() + low.slice(1)
  })

  return titleCased.join(' ') || 'Nuevo Proyecto'
}

export function isVirtualRepo(repoFullName) {
  return typeof repoFullName === 'string' && repoFullName.startsWith('virtual/')
}

export async function getOwnedProject(userId, projectId) {
  const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

// Sin filtro de dueño a propósito: la usa el endpoint público de tracking, que solo necesita
// saber a qué proyecto atribuir la visita, no verificar quién la está pidiendo.
export async function getProjectBySlug(slug) {
  const { data, error } = await supabase.from('projects').select('id, slug').eq('slug', slug).maybeSingle()
  if (error) throw error
  return data
}

export async function getOwnedProjectByRepo(userId, repoFullName) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('user_id', userId)
    .eq('repo_full_name', repoFullName)
    .maybeSingle()
  if (error) throw error
  return data
}

// Orden por actividad real, no por fecha de creación: un proyecto viejo en el que se acaba de
// aplicar un cambio tiene que aparecer primero. "project_checkpoints" se crea cada vez que se
// aprueba un cambio de código/DB/asset (ver createCheckpoint), así que su created_at más
// reciente por proyecto es exactamente "cuándo lo edité por última vez". Se resuelve en dos
// consultas simples en vez de una vista/función en la base, para no requerir una migración.
export async function listOwnedProjects(userId) {
  const { data: projects, error } = await supabase.from('projects').select('*').eq('user_id', userId)
  if (error) throw error
  if (projects.length === 0) return projects

  const { data: checkpoints, error: checkpointsError } = await supabase
    .from('project_checkpoints')
    .select('project_id, created_at')
    .in(
      'project_id',
      projects.map((p) => p.id),
    )
    .order('created_at', { ascending: false })
  if (checkpointsError) throw checkpointsError

  const lastEditedAt = new Map()
  for (const c of checkpoints) {
    if (!lastEditedAt.has(c.project_id)) lastEditedAt.set(c.project_id, c.created_at)
  }

  return projects.sort((a, b) => {
    const aTime = new Date(lastEditedAt.get(a.id) || a.created_at).getTime()
    const bTime = new Date(lastEditedAt.get(b.id) || b.created_at).getTime()
    return bTime - aTime
  })
}

// El slug es "<esto>.flow-pro.online", único en toda la plataforma — dos usuarios distintos (o
// el mismo dos veces) pidiendo algo como "Landing page" slugifican igual, y sin esto el INSERT
// tiraba crudo el error de Postgres ("duplicate key value violates unique constraint
// projects_slug_key") directo al usuario, sin ninguna forma de entender o resolver el problema
// desde la UI. Reintenta agregando un sufijo random corto en vez de fallar.
async function insertProjectWithUniqueSlug(baseRow, baseSlug) {
  let slug = baseSlug
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('projects')
      .insert({ ...baseRow, slug })
      .select('*')
      .single()
    if (!error) return data
    if (error.code !== '23505') throw error
    slug = `${baseSlug}-${crypto.randomBytes(2).toString('hex')}`
  }
  throw new Error('No se pudo generar un subdominio único para el proyecto — probá con otro nombre.')
}

// Proyecto sin GitHub: vive enteramente en FlowPro (project_files), estilo Lovable.
// El id se genera acá (no lo pone la DB) porque repo_full_name lo necesita de una.
export async function createVirtualProject(userId, name) {
  const id = crypto.randomUUID()
  return insertProjectWithUniqueSlug(
    { id, user_id: userId, name, storage_type: 'virtual', repo_full_name: `virtual/${id}` },
    slugify(name),
  )
}

// Encuentra o crea el project row para un repo real de GitHub (el resto de las tablas
// — conversations, proposed_changes, etc. — ya funcionan con repo_full_name tal cual).
export async function ensureGithubProject(userId, repoFullName, { branch } = {}) {
  const existing = await getOwnedProjectByRepo(userId, repoFullName)
  if (existing) return existing
  const name = repoFullName.split('/')[1] || repoFullName
  return insertProjectWithUniqueSlug(
    { user_id: userId, name, storage_type: 'github', repo_full_name: repoFullName, branch: branch || null },
    slugify(name),
  )
}
