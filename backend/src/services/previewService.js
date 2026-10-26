import { supabase } from '../db/supabaseClient.js';
import { signPreviewToken } from './previewAccess.js';

export async function getProjectPreviewUrl(repoFullName) {
  const { data: project } = await supabase
    .from('projects')
    .select('slug')
    .eq('repo_full_name', repoFullName)
    .single();

  if (!project) throw new Error('Project not found');

  const token = signPreviewToken(project.slug);
  return `https://${project.slug}.flow-pro.online/?token=${token}`;
}
