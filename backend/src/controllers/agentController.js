import { processLovableDispatch } from '../services/lovableBridgeService.js';

/**
 * Controlador para procesar peticiones interceptadas por la extensión FlowPro Bridge desde Lovable.dev
 */
export async function handleLovableDispatch(req, res) {
  try {
    const { projectId, prompt, github, activeRoute, async: isAsync } = req.body || {};

    // 1. Validación de enlace de GitHub
    if (!github || !github.owner || !github.repo) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_GITHUB_LINK',
        message: 'Por favor vincula tu proyecto a GitHub en los ajustes de Lovable para sincronizar con FlowPro.'
      });
    }

    // 2. Validación de prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_PROMPT',
        message: 'El campo prompt es obligatorio.'
      });
    }

    // 3. Manejo Asíncrono (si la extensión solicita respuesta inmediata para liberar el socket)
    if (isAsync || req.headers['x-dispatch-mode'] === 'async') {
      const pid = projectId || `${github.owner}/${github.repo}`;
      res.status(200).json({
        ok: true,
        status: 'processing',
        projectId: pid
      });

      // Procesar en background sin bloquear
      processLovableDispatch({ projectId: pid, prompt, github, activeRoute })
        .then(result => {
          console.log(`[LovableDispatch:Async] Completado con éxito para ${pid}:`, result.commitSha);
        })
        .catch(err => {
          console.error(`[LovableDispatch:Async] Error procesando ${pid}:`, err.message);
        });
      return;
    }

    // 4. Modo Síncrono (espera la finalización de la edición y push)
    const result = await processLovableDispatch({
      projectId,
      prompt,
      github,
      activeRoute
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error('[handleLovableDispatch] Error:', err);
    return res.status(500).json({
      ok: false,
      error: 'DISPATCH_ERROR',
      message: err.message || 'Error interno procesando el despacho de Lovable.'
    });
  }
}
