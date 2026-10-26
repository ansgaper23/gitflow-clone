import * as cheerio from 'cheerio';
import { getOwnedProject } from '../services/projectResolver.js';
import { readProjectFile } from '../services/projectStorage.js';
import { dispatchAgentTask } from '../services/agentDispatcher.js';

export async function runSeoAudit(req, res) {
  const { id } = req.params;

  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const checks = [];
    let score = 100;

    let indexHtml = '';
    try {
      indexHtml = await readProjectFile(project, req.user.github_access_token, 'index.html');
    } catch (e) {
      checks.push({ id: 'index_missing', label: 'Archivo index.html no encontrado', passed: false, impact: 'high' });
      return res.json({ score: 0, checks });
    }

    const $ = cheerio.load(indexHtml);

    // 1. Verificaci?n de <title>
    const title = $('title').text().trim();
    if (!title || title === 'Vite + React' || title === 'Lovable App') {
      checks.push({ id: 'title', label: 'T?tulo gen?rico o ausente (30-60 chars)', passed: false, impact: 'high' });
      score -= 25;
    } else {
      checks.push({ id: 'title', label: 'T?tulo v?lido', passed: true, impact: 'high' });
    }

    // 2. Verificaci?n de Meta Description
    const description = $('meta[name="description"]').attr('content');
    if (!description || description.length < 20) {
      checks.push({ id: 'desc', label: 'Meta descripci?n faltante o muy corta (70-160 chars)', passed: false, impact: 'high' });
      score -= 25;
    } else {
      checks.push({ id: 'desc', label: 'Meta descripci?n v?lida', passed: true, impact: 'high' });
    }

    // 3. Verificaci?n de OpenGraph
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDesc = $('meta[property="og:description"]').attr('content');
    if (!ogTitle || !ogDesc) {
      checks.push({ id: 'og', label: 'Etiquetas OpenGraph incompletas (og:title, og:description)', passed: false, impact: 'medium' });
      score -= 20;
    } else {
      checks.push({ id: 'og', label: 'Etiquetas OpenGraph v?lidas', passed: true, impact: 'medium' });
    }

    // 4. Verificaci?n de Canonical URL y robots.txt
    const canonical = $('link[rel="canonical"]').attr('href');
    if (!canonical) {
      checks.push({ id: 'canonical', label: 'URL can?nica ausente', passed: false, impact: 'low' });
      score -= 10;
    } else {
      checks.push({ id: 'canonical', label: 'URL can?nica presente', passed: true, impact: 'low' });
    }

    let robotsTxt = false;
    try {
      await readProjectFile(project, req.user.github_access_token, 'public/robots.txt');
      robotsTxt = true;
    } catch(e) {}
    
    if (!robotsTxt) {
      checks.push({ id: 'robots', label: 'Archivo robots.txt faltante', passed: false, impact: 'low' });
      score -= 10;
    } else {
      checks.push({ id: 'robots', label: 'Archivo robots.txt presente', passed: true, impact: 'low' });
    }

    return res.json({
      success: true,
      score: Math.max(0, score),
      checks
    });
  } catch (err) {
    console.error('SEO Audit error:', err);
    return res.status(500).json({ error: 'No se pudo auditar el preview.' });
  }
}

export async function fixSeoWithAgent(req, res) {
  const { id } = req.params;
  
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const prompt = `Fix SEO tags in index.html (title, meta description, og:title, og:description) and ensure robots.txt and canonical URLs exist. This is a DIAGNOSE_REPAIR / BUILD_ACTION request.`;

    await dispatchAgentTask({ projectId: project.repo_full_name, prompt, intent: 'DIAGNOSE_REPAIR' });
    
    return res.json({ ok: true, messageId: 'injected_chat_message' });
  } catch (err) {
    console.error('SEO Agent dispatch error:', err);
    return res.status(500).json({ error: 'Error al enviar la tarea al agente.' });
  }
}
