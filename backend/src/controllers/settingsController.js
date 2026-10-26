import { getOwnedProject } from '../services/projectResolver.js';
import { supabase } from '../db/supabaseClient.js';
import { listProjectServerSecrets, upsertProjectServerSecret, deleteProjectServerSecret } from '../services/projectServerSecrets.js';

export async function getSettings(req, res) {
  const { id } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    let secrets = [];
    try {
      secrets = await listProjectServerSecrets(project.id);
    } catch(e) {}

    return res.json({
      success: true,
      settings: {
        name: project.name || project.slug || 'Mi Proyecto',
        domain: project.custom_domain || null,
        isPublished: Boolean(project.custom_domain || project.published)
      },
      secrets: secrets.map(s => ({ key: s.key, valueMasked: 'sk_live_***', id: s.id }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener configuraci?n' });
  }
}

export async function updateSettings(req, res) {
  const { id } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const updates = {};
    if (req.body.name) updates.name = req.body.name;
    // other fields as needed

    const { error } = await supabase.from('projects').update(updates).eq('id', project.id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error al actualizar configuraci?n' });
  }
}

export async function addSecret(req, res) {
  const { id } = req.params;
  const { key, value } = req.body;
  if (!key || !value) return res.status(400).json({ error: 'Faltan key y value' });
  
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await upsertProjectServerSecret(project.id, key, value);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error al guardar secreto' });
  }
}

export async function removeSecret(req, res) {
  const { id, key } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // In FlowPro, we typically delete by ID or Key. Let's assume deleteProjectSecret takes (projectId, key)
    // Actually the mock implementation earlier in projects.js deletes by SecretID. We will just list and find.
    const secrets = await listProjectServerSecrets(project.id);
    const target = secrets.find(s => s.key === key || s.id === key);
    if (target) {
      await deleteProjectServerSecret(target.id);
    }
    
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Error al eliminar secreto' });
  }
}
