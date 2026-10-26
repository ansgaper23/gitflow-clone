import { processLovableDispatch } from '../services/lovableBridgeService.js';

/**
 * Controlador para procesar peticiones interceptadas por la extensión FlowPro Bridge desde Lovable.dev
 */
export async function handleLovableDispatch(req, res) {
  const isSSE = Boolean(
    req.headers.accept?.includes('text/event-stream') ||
    req.query.stream === 'true' ||
    req.body?.stream === true
  );

  let sendEvent = null;

  if (isSSE) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    sendEvent = (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      } catch (_) {}
    };

    sendEvent('activity', { description: 'Conectando con FlowPro Bridge...' });
  }

  try {
    const { projectId, prompt, github, activeRoute, async: isAsync } = req.body || {};

    // 1. Validación de enlace de GitHub
    if (!github || !github.owner || !github.repo) {
      const errPayload = {
        ok: false,
        error: 'MISSING_GITHUB_LINK',
        message: 'Por favor vincula tu proyecto a GitHub en los ajustes de Lovable para sincronizar con FlowPro.'
      };
      if (isSSE) {
        sendEvent('error', errPayload);
        return res.end();
      }
      return res.status(400).json(errPayload);
    }

    // 2. Validación de prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      const errPayload = {
        ok: false,
        error: 'MISSING_PROMPT',
        message: 'El campo prompt es obligatorio.'
      };
      if (isSSE) {
        sendEvent('error', errPayload);
        return res.end();
      }
      return res.status(400).json(errPayload);
    }

    // 3. Manejo Asíncrono (si la extensión solicita respuesta inmediata para liberar el socket)
    if (isAsync || req.headers['x-dispatch-mode'] === 'async') {
      const pid = projectId || `${github.owner}/${github.repo}`;
      if (isSSE) {
        sendEvent('activity', { description: 'Procesamiento en segundo plano iniciado...' });
        sendEvent('done', { ok: true, status: 'processing', projectId: pid });
        res.end();
      } else {
        res.status(200).json({
          ok: true,
          status: 'processing',
          projectId: pid
        });
      }

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

    // 4. Modo Síncrono (espera la finalización de la edición y push, con streaming de telemetría si es SSE)
    const onActivity = isSSE
      ? (description) => sendEvent('activity', { description })
      : undefined;

    const result = await processLovableDispatch({
      projectId,
      prompt,
      github,
      activeRoute,
      onActivity
    });

    if (isSSE) {
      sendEvent('done', result);
      return res.end();
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[handleLovableDispatch] Error:', err);
    const errPayload = {
      ok: false,
      error: 'DISPATCH_ERROR',
      message: err.message || 'Error interno procesando el despacho de Lovable.'
    };
    if (isSSE) {
      sendEvent('error', errPayload);
      return res.end();
    }
    return res.status(500).json(errPayload);
  }
}
