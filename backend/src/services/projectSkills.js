import AdmZip from 'adm-zip'
import { supabase } from '../db/supabaseClient.js'

// Parsea el frontmatter mínimo que usan los SKILL.md (solo "name:" y "description:" de texto
// plano, nunca listas/objetos anidados) — no hace falta una librería YAML completa para esto.
function parseSkillMd(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { name: null, description: null, content: text.trim() }
  const [, frontmatter, body] = match
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') || null
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') || null
  return { name, description, content: body.trim() }
}

// Acepta un .md directo, o un .zip con un SKILL.md adentro — es el formato en el que vienen
// empaquetadas las skills que se descargan (una carpeta con SKILL.md comprimida en zip).
export function extractSkillFromUpload(buffer, filename) {
  let text
  if (/\.zip$/i.test(filename)) {
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries()
    const entry = entries.find((e) => /skill\.md$/i.test(e.entryName)) || entries.find((e) => /\.md$/i.test(e.entryName))
    if (!entry) throw new Error('El zip no tiene ningún archivo .md adentro (se esperaba un SKILL.md)')
    text = entry.getData().toString('utf-8')
  } else {
    text = buffer.toString('utf-8')
  }
  const { name, description, content } = parseSkillMd(text)
  if (!content) throw new Error('El archivo de la skill está vacío')
  return {
    name: (name || filename.replace(/\.(zip|md)$/i, '')).slice(0, 100),
    description: (description || '').slice(0, 500),
    content: content.slice(0, 40000), // mismo margen que read_file — de sobra para un SKILL.md real
  }
}

export async function listProjectSkills(projectId, userId) {
  let query = supabase
    .from('project_skills')
    .select('id, name, description, is_active, created_at, projects!inner(user_id)')
    .order('created_at', { ascending: true })

  if (userId) {
    query = query.eq('projects.user_id', userId)
  } else {
    query = query.eq('project_id', projectId)
  }

  const { data, error } = await query
  if (error) throw error
  return data.map(s => {
    // strip out projects relation object so it matches original shape
    const { projects, ...rest } = s
    return rest
  })
}

export async function addProjectSkill(projectId, { name, description, content }) {
  const { data, error } = await supabase
    .from('project_skills')
    .insert({ project_id: projectId, name, description, content })
    .select('id, name, description, is_active, created_at')
    .single()
  if (error) throw error
  return data
}

export async function toggleProjectSkill(userId, skillId, isActive) {
  // Primero verificamos que el skill pertenezca a algun proyecto del usuario
  const { data: check, error: checkError } = await supabase
    .from('project_skills')
    .select('id, projects!inner(user_id)')
    .eq('id', skillId)
    .eq('projects.user_id', userId)
    .single()
    
  if (checkError || !check) throw new Error('Skill no encontrado o no tienes permiso')

  const { data, error } = await supabase
    .from('project_skills')
    .update({ is_active: isActive })
    .eq('id', skillId)
    .select('id, name, description, is_active, created_at')
    .single()
  if (error) throw error
  return data
}

export async function deleteProjectSkill(userId, skillId) {
  // Primero verificamos que el skill pertenezca a algun proyecto del usuario
  const { data: check, error: checkError } = await supabase
    .from('project_skills')
    .select('id, projects!inner(user_id)')
    .eq('id', skillId)
    .eq('projects.user_id', userId)
    .single()
    
  if (checkError || !check) throw new Error('Skill no encontrado o no tienes permiso')

  const { error } = await supabase.from('project_skills').delete().eq('id', skillId)
  if (error) throw error
}

export async function getActiveProjectSkills(projectId, userId) {
  let query = supabase
    .from('project_skills')
    .select('name, description, content, projects!inner(user_id)')
    .eq('is_active', true)

  if (userId) {
    query = query.eq('projects.user_id', userId)
  } else {
    query = query.eq('project_id', projectId)
  }

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getMentionedProjectSkills(projectId, prompt) {
  const { data, error } = await supabase
    .from('project_skills')
    .select('name, description, content, is_active')
    .eq('project_id', projectId);
  if (error || !data) return [];
  
  return data.filter(skill => 
    skill.is_active || 
    (prompt && (prompt.includes(`/${skill.name}`) || prompt.includes(`@${skill.name}`)))
  );
}
