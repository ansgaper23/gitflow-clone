import { Router } from 'express'
import multer from 'multer'
import { requireAuth, hasAccess } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { getProgress } from '../services/progressTracker.js'
import { getOwnedProject } from '../services/projectResolver.js'
import { sendGithubAwareError, isGithubAuthError } from '../services/github.js'
import { runConversationTurn, TurnError, activeTurns } from '../services/conversationTurn.js'
import path from 'node:path'
import { AttachmentProcessor, isExtractableDocument, extractDocxAssets } from '../services/attachmentProcessor.js'

export const conversationsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB por archivo
})

const MAX_ATTACHMENTS = 10

// Extractor universal de adjuntos: extrae texto de Word (.docx), Excel (.xlsx, .xls),
// CSV/TSV, texto plano, código y PDF para enriquecer el contexto del LLM.
async function attachmentFromUpload(file) {
  if (!file) return null
  const filename = file.originalname || 'archivo'
  const ext = path.extname(filename).toLowerCase()
  const mime = (file.mimetype || '').toLowerCase()

  // 1. Imágenes
  if (mime.startsWith('image/')) {
    return {
      filename,
      mimeType: mime,
      base64: file.buffer.toString('base64'),
      kind: 'image',
      sizeBytes: file.size,
    }
  }

  // 2. Archivos PDF: texto extraído para prompt + activos de imagen extraídos + páginas renderizadas
  if (mime === 'application/pdf' || ext === '.pdf') {
    let extractedText = ''
    let extractedAssets = []
    let manifest = null
    try {
      const fullRes = await AttachmentProcessor.extractTextFull(file.buffer, filename, mime)
      extractedText = fullRes.text || ''
      extractedAssets = fullRes.extractedAssets || []
      manifest = fullRes.manifest || null
    } catch (err) {
      console.warn(`[attachmentFromUpload] Error extrayendo texto/activos de PDF ${filename}:`, err.message)
    }
    return {
      filename,
      mimeType: 'application/pdf',
      base64: file.buffer.toString('base64'),
      kind: 'pdf',
      extractedText,
      extractedAssets,
      manifest,
      sizeBytes: file.size,
    }
  }

  // 3. Documentos y planillas procesables (.docx, .xlsx, .xls, .csv, .tsv, .txt, .json, .sql, etc.)
  if (isExtractableDocument(filename, mime)) {
    try {
      // FASE 8: Para .docx usamos extractTextFull que extrae imágenes incrustadas + guía estructural
      if (ext === '.docx' || mime.includes('wordprocessingml')) {
        const { text: extractedText, extractedAssets } = await AttachmentProcessor.extractTextFull(file.buffer, filename, mime)
        return {
          filename,
          mimeType: mime,
          kind: 'document-text',
          extractedText,
          extractedAssets: extractedAssets || [],
          sizeBytes: file.size,
        }
      }
      // Otros tipos de documento: solo texto
      const extractedText = await AttachmentProcessor.extractText(file.buffer, filename, mime)
      return {
        filename,
        mimeType: mime,
        kind: 'document-text',
        extractedText,
        extractedAssets: [],
        sizeBytes: file.size,
      }
    } catch (err) {
      throw new Error(`No se pudo leer "${filename}": ${err.message}`)
    }
  }

  // 4. Archivos ZIP
  if (ext === '.zip' || mime.includes('zip')) {
    return {
      filename,
      mimeType: mime || 'application/zip',
      base64: file.buffer.toString('base64'),
      kind: 'zip',
      sizeBytes: file.size,
    }
  }

  // 5. Fallback seguro de texto si no contiene caracteres nulos
  try {
    const rawStr = file.buffer.toString('utf-8')
    if (!rawStr.includes('\0')) {
      return {
        filename,
        mimeType: mime || 'text/plain',
        kind: 'document-text',
        extractedText: rawStr.slice(0, 50000),
        sizeBytes: file.size,
      }
    }
  } catch (_) {}

  throw new Error(`Tipo de archivo no soportado: ${mime || ext}. Se admiten imágenes, documentos (.docx, .pdf), planillas (.xlsx, .csv), código y texto plano (.txt, .sql, .json).`)
}

async function attachmentFromBase64Json(item) {
  if (!item) return null
  const filename = item.filename || item.name || 'archivo'
  const ext = path.extname(filename).toLowerCase()
  const mime = (item.mimeType || item.type || '').toLowerCase()
  const buffer = item.base64 ? Buffer.from(item.base64, 'base64') : Buffer.from(item.content || '', 'utf-8')
  const size = item.sizeBytes || buffer.length

  return attachmentFromUpload({
    originalname: filename,
    mimetype: mime,
    buffer,
    size
  })
}

conversationsRouter.get('/', requireAuth, async (req, res) => {
  const { projectId, repo } = req.query
  let query = supabase.from('conversations').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false })
  if (projectId) query = query.eq('project_id', projectId)
  else if (repo) query = query.eq('repo_full_name', repo)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

conversationsRouter.post('/', requireAuth, async (req, res) => {
  const { projectId, title } = req.body
  if (!projectId) return res.status(400).json({ error: 'Falta projectId' })

  let project
  try {
    project = await getOwnedProject(req.user.id, projectId)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: req.user.id, project_id: project.id, repo_full_name: project.repo_full_name, title: title || 'Nueva conversación' })
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// Paginado hacia atrás en el tiempo: sin "before" trae los últimos `limit` mensajes (lo que
// hace falta para pintar el chat de entrada, sin traer una conversación entera que puede tener
// cientos de mensajes); con "before" (un created_at de referencia) trae la página anterior a
// esa fecha — así el frontend puede ir cargando más al scrollear hacia arriba.
conversationsRouter.get('/:id/messages', requireAuth, async (req, res) => {
  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()
  if (convoErr || !convo) return res.status(404).json({ error: 'Conversación no encontrada' })

  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
  const before = req.query.before

  let pageQuery = supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(limit + 1) // uno de más, solo para saber si queda algo más viejo sin traerlo
  if (before) pageQuery = pageQuery.lt('created_at', before)

  const { data: page, error } = await pageQuery
  if (error) return res.status(500).json({ error: error.message })

  const hasMore = page.length > limit
  const messages = page.slice(0, limit).reverse() // de vuelta a orden ascendente para pintar
  const messageIds = messages.map((m) => m.id)

  const changesTable = async (table) => {
    if (messageIds.length === 0) return []
    const { data, error: tableErr } = await supabase
      .from(table)
      .select('*')
      .in('message_id', messageIds)
      .order('created_at', { ascending: true })
    if (tableErr) throw tableErr
    return data
  }

  let changes, dbChanges, assetChanges, edgeFunctionChanges
  try {
    ;[changes, dbChanges, assetChanges, edgeFunctionChanges] = await Promise.all([
      changesTable('proposed_changes'),
      changesTable('proposed_db_changes'),
      changesTable('proposed_asset_changes'),
      changesTable('proposed_edge_functions'),
    ])
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }

  const projectData = convo.project_id ? await getOwnedProject(req.user.id, convo.project_id).catch(() => null) : null
  res.json({
    conversation: convo,
    project: projectData,
    messages,
    changes,
    dbChanges,
    assetChanges,
    edgeFunctionChanges,
    hasMore,
    oldestCursor: messages[0]?.created_at || null,
  })
})

// Convertido a SSE (Server-Sent Events) para transmitir la telemetría en tiempo real
async function handleSendMessage(req, res, { content, attachments = [], mode, elementContext, agentId, activeViewContext }) {
  if (!hasAccess(req.user)) {
    return res.status(402).json({ error: 'Tu demo gratis o tu plan terminaron. Elige un plan para seguir usando el agente.' })
  }

  const conversationId = req.params.id
  let turnFinished = false
  let clientDisconnected = false
  let pingInterval = null

  // SSE Keep-Alive y Anti-Drop:
  // La desconexión del socket SSE (por micro-corte de red, recarga de página o proxy timeout)
  // JAMÁS debe abortar el turno en el backend. El agente continuará ejecutando en segundo plano,
  // guardando archivos, actualizando Docker preview y persistiendo la respuesta en Supabase.
  // El turno ÚNICAMENTE se cancela si el usuario explícitamente solicita /cancel o /stop.
  const cleanupPing = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  };

  req.on('close', () => {
    clientDisconnected = true;
    cleanupPing();
    if (!turnFinished) {
      console.log(`[SSE Anti-Drop] Conexión SSE cerrada por el cliente en conversación ${conversationId}. Manteniendo turno activo en segundo plano.`);
    }
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Enviar ping inicial inmediato para abrir el túnel de inmediato en Cloudflare / Nginx
  try {
    res.write(': ping\n\n');
    if (typeof res.flush === 'function') res.flush();
  } catch (_) {}

  // Heartbeat activo: envía un comentario SSE cada 5 segundos para mantener vivas las conexiones
  pingInterval = setInterval(() => {
    if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
      try {
        res.write(': ping\n\n');
        if (typeof res.flush === 'function') res.flush();
      } catch (_) {}
    }
  }, 5000);

  const onStreamEvent = (step) => {
    if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
      try {
        if (step.type === 'telemetry' || step.type === 'usage' || step.type === 'thinking' || step.type === 'build_applied' || step.type === 'ping' || step.type === 'project_updated' || step.type === 'activity_description') {
          res.write(`event: ${step.type}\ndata: ${JSON.stringify(step)}\n\n`);
          if (typeof res.flush === 'function') res.flush();
        }
      } catch (_) {}
    }
  };

  try {
    const result = await runConversationTurn({
      user: req.user,
      conversationId,
      content,
      attachments,
      mode,
      elementContext, agentId,
      activeViewContext,
      signal: null, // Desacoplado: el turno nunca se aborta por corte de socket SSE
      onStreamEvent
    });
    turnFinished = true;
    cleanupPing();
    if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
      try {
        res.write(`event: activity_description\ndata: ${JSON.stringify({ type: 'activity_description', description: null })}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      } catch (_) {}
      res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    }
  } catch (err) {
    turnFinished = true;
    cleanupPing();
    if (err.name === 'AbortError') {
      if (!clientDisconnected && !res.writableEnded && !res.destroyed) res.end();
      return;
    }
    if (err.message && err.message.includes('Ya hay un turno en ejecución')) {
      console.info(`[handleSendMessage] Solicitud concurrente en ${conversationId}: avisando al cliente para enganche en segundo plano.`);
      if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
        res.write(`event: turn_running\ndata: ${JSON.stringify({ type: 'turn_running', message: 'Hay un turno en ejecución para este proyecto. Sincronizando con el progreso en vivo...' })}\n\n`);
        res.end();
      }
      return;
    }
    if (err instanceof TurnError) {
      if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message, code: err.code, detail: err.detail })}\n\n`);
        res.end();
      }
      return;
    }
    console.error(`[TURN ERROR] en conversación ${conversationId}:`, err.rawDetail ? `${err.message}\n${err.rawDetail}` : err);
    if (!clientDisconnected && !res.writableEnded && !res.destroyed) {
      if (isGithubAuthError(err)) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'El agente de IA falló al procesar el mensaje', code: 'github_auth_error' })}\n\n`);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'El agente de IA falló al procesar el mensaje' })}\n\n`);
      }
      res.end();
    }
  }
}

// Endpoint de cancelación explícita por usuario (soporta /cancel y /stop)
async function handleCancelConversationTurn(req, res) {
  const conversationId = req.params.id;
  let cancelled = false;
  if (activeTurns.has(conversationId)) {
    const turnData = activeTurns.get(conversationId);
    if (turnData) {
      turnData.explicitCancelRequested = true;
      if (turnData.abortController) {
        try { turnData.abortController.abort(); } catch (_) {}
      }
      cancelled = true;
    }
  }
  return res.json({
    ok: true,
    cancelled,
    message: cancelled ? 'Cancelación explícita procesada exitosamente.' : 'No había ningún turno activo para esta conversación.'
  });
}
conversationsRouter.post('/:id/cancel', requireAuth, handleCancelConversationTurn);
conversationsRouter.post('/:id/stop', requireAuth, handleCancelConversationTurn);

// Cola de mensajes en vuelo FIFO por conversación (Message Queue Engine estilo Lovable)
export const conversationQueues = new Map();

// Alias de cancelación reactiva
conversationsRouter.post('/:id/abort', requireAuth, handleCancelConversationTurn);

// Endpoints de cola de mensajes en vuelo FIFO
conversationsRouter.get('/:id/queue', requireAuth, async (req, res) => {
  const conversationId = req.params.id;
  const queue = conversationQueues.get(conversationId) || [];
  res.json({ ok: true, queue });
});

conversationsRouter.post('/:id/queue', requireAuth, async (req, res) => {
  const conversationId = req.params.id;
  const { id, text, content, files, attachments, mode, agentId } = req.body || {};
  const messageText = (text || content || '').trim();
  const rawFiles = Array.isArray(files) ? files : (Array.isArray(attachments) ? attachments : []);
  if (!messageText && rawFiles.length === 0) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }

  if (!conversationQueues.has(conversationId)) {
    conversationQueues.set(conversationId, []);
  }
  const queue = conversationQueues.get(conversationId);
  const newItem = {
    id: id || `userMessage:${Math.random().toString(36).slice(2, 10)}`,
    text: messageText,
    content: messageText,
    files: rawFiles,
    attachments: rawFiles,
    mode: mode || 'build',
    agentId: agentId || null,
    createdAt: new Date().toISOString(),
    userId: req.user.id,
  };
  queue.push(newItem);
  res.status(201).json({ ok: true, item: newItem, queue });
});

conversationsRouter.patch('/:id/queue/:queueId', requireAuth, async (req, res) => {
  const { id: conversationId, queueId } = req.params;
  const { text, content, mode, order } = req.body || {};
  const queue = conversationQueues.get(conversationId) || [];
  const idx = queue.findIndex(item => item.id === queueId);
  if (idx === -1) {
    return res.status(404).json({ error: 'Mensaje no encontrado en la cola' });
  }
  if (text !== undefined || content !== undefined) {
    queue[idx].text = (text !== undefined ? text : content).trim();
    queue[idx].content = queue[idx].text;
  }
  if (mode !== undefined) {
    queue[idx].mode = mode;
  }
  if (typeof order === 'number' && order >= 0 && order < queue.length) {
    const [moved] = queue.splice(idx, 1);
    queue.splice(order, 0, moved);
  }
  res.json({ ok: true, item: queue[idx] || null, queue });
});

conversationsRouter.delete('/:id/queue/:queueId', requireAuth, async (req, res) => {
  const { id: conversationId, queueId } = req.params;
  if (!conversationQueues.has(conversationId)) {
    return res.json({ ok: true, queue: [] });
  }
  const queue = conversationQueues.get(conversationId);
  const filtered = queue.filter(item => item.id !== queueId);
  conversationQueues.set(conversationId, filtered);
  res.json({ ok: true, queue: filtered });
});

// Endpoint para responder interactivamente a herramientas de planificación (roadmap / propose_tasks)
conversationsRouter.post('/:id/tools/respond', requireAuth, async (req, res) => {
  const conversationId = req.params.id;
  const { toolCallId, approval_status, feedback } = req.body || {};
  if (!approval_status) {
    return res.status(400).json({ error: 'Falta approval_status' });
  }

  // 1. Verificar pertenencia de la conversación
  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .select('id, project_id, repo_full_name')
    .eq('id', conversationId)
    .eq('user_id', req.user.id)
    .single();
  if (convoErr || !convo) return res.status(404).json({ error: 'Conversación no encontrada' });

  // 2. Buscar último mensaje con plan
  const { data: recentMsgs } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(10);

  const planMsg = (recentMsgs || []).find(m => Array.isArray(m.actions) && m.actions.some(a => a.type === 'plan'));
  if (planMsg) {
    const updatedActions = planMsg.actions.map(a => {
      if (a.type === 'plan') {
        return {
          ...a,
          status: approval_status === 'approved' ? 'approved' : 'rejected',
          feedback: feedback || null,
          respondedAt: new Date().toISOString(),
        };
      }
      return a;
    });
    try {
      const { error: updActionsErr } = await supabase.from('messages').update({ actions: updatedActions }).eq('id', planMsg.id);
      if (updActionsErr) {
        console.warn('[SupabaseQueryError] update message actions failed:', { error: updActionsErr.message, details: updActionsErr.details });
      }
    } catch (err) {
      console.warn('[SupabaseQueryError] update message actions caught:', { error: err.message });
    }
  }

  // 3. Si se aprueba, disparar automáticamente el turno en modo BUILD para ejecutar el plan
  if (approval_status === 'approved') {
    const followUpPrompt = 'Plan aprobado por el usuario. Procede a implementar todas las tareas del plan en orden, creando y editando los archivos especificados.';
    const { triggerAutoTurn } = await import('../services/conversationTurn.js');
    triggerAutoTurn(req.user, conversationId, followUpPrompt, { mode: 'build' });
    return res.json({ ok: true, status: 'approved', message: 'Ejecutando plan en modo Build' });
  } else {
    if (feedback && feedback.trim()) {
      const adjustPrompt = `El usuario desea ajustar el plan con estas observaciones: "${feedback.trim()}". Por favor genera una propuesta revisada del plan con las tareas ajustadas usando propose_tasks.`;
      const { triggerAutoTurn } = await import('../services/conversationTurn.js');
      triggerAutoTurn(req.user, conversationId, adjustPrompt, { mode: 'plan' });
      return res.json({ ok: true, status: 'rejected', feedback: feedback.trim(), message: 'Ajustando plan según feedback del usuario' });
    }
    return res.json({ ok: true, status: 'rejected', message: 'Plan descartado' });
  }
});

conversationsRouter.get('/:id/activity', requireAuth, async (req, res) => {
  const { data: convo, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()
  if (error || !convo) return res.status(404).json({ error: 'Conversación no encontrada' })

  const progress = getProgress(convo.id)
  res.json({ steps: progress?.steps || [], updatedAt: progress?.updatedAt || null })
})

conversationsRouter.get('/:id/turn-status', requireAuth, async (req, res) => {
  const { data: convo, error } = await supabase
    .from('conversations')
    .select('id, project_id')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()
  if (error || !convo) return res.status(404).json({ error: 'Conversación no encontrada' })

  const isActive = Boolean(
    activeTurns.has(convo.id) ||
    (convo.project_id && activeTurns.has(convo.project_id))
  )
  const turnData = activeTurns.get(convo.id) || (convo.project_id ? activeTurns.get(convo.project_id) : null)

  res.json({
    active: isActive,
    conversationId: convo.id,
    projectId: convo.project_id || null,
    startedAt: turnData?.startedAt || null,
  })
})

conversationsRouter.post('/:id/messages', requireAuth, async (req, res) => {
  let activeViewContext = req.body.activeViewContext
  if (typeof activeViewContext === 'string') {
    try {
      activeViewContext = JSON.parse(activeViewContext)
    } catch {
      activeViewContext = undefined
    }
  }
  let elementContext = req.body.elementContext
  if (typeof elementContext === 'string') {
    try {
      elementContext = JSON.parse(elementContext)
    } catch {
      elementContext = undefined
    }
  }
  await handleSendMessage(req, res, {
    content: req.body.content || req.body.message,
    attachments: req.body.attachments || [],
    mode: req.body.mode || 'build',
    elementContext,
    agentId: req.body.agentId,
    activeViewContext
  })
})

// Endpoint ultrarrápido desacoplado para procesar adjuntos (JSON < 300ms, CERO SSE).
// Extrae el texto de documentos y metadatos de imágenes para inyectar en el turno.
conversationsRouter.post('/:id/parse-attachments', requireAuth, upload.array('files', MAX_ATTACHMENTS), async (req, res) => {
  let attachments
  try {
    attachments = await Promise.all((req.files || []).map(attachmentFromUpload))
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  if (!attachments || attachments.length === 0) {
    return res.status(400).json({ error: 'Falta al menos un archivo (campo "files")' })
  }

  // Sanitización de payload: los documentos con texto extraído no requieren retornar el base64 pesado del documento.
  // FASE 8: Se preservan los extractedAssets (catálogo de imágenes con base64 individual por imagen).
  const sanitizedAttachments = attachments.map(a => {
    if (a.kind === 'pdf' || a.mimeType === 'application/pdf') {
      return {
        filename: a.filename,
        mimeType: a.mimeType,
        kind: 'pdf',
        base64: a.base64,
        extractedText: a.extractedText,
        extractedAssets: a.extractedAssets || [],
        sizeBytes: a.sizeBytes
      }
    }
    if (a.kind === 'document-text' || (a.extractedText && a.extractedText.trim().length > 20)) {
      return {
        filename: a.filename,
        mimeType: a.mimeType,
        kind: 'document-text',
        extractedText: a.extractedText,
        extractedAssets: a.extractedAssets || [],
        sizeBytes: a.sizeBytes
      }
    }
    return a
  })

  res.json({ ok: true, attachments: sanitizedAttachments })
})

// Fallback JSON Base64 si multipart es interceptado o bloqueado por Cloudflare WAF
conversationsRouter.post('/:id/parse-attachments-json', requireAuth, async (req, res) => {
  const { files = [] } = req.body || {}
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'Falta array de archivos en campo "files"' })
  }
  let attachments
  try {
    attachments = await Promise.all(files.map(attachmentFromBase64Json))
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const sanitizedAttachments = attachments.map(a => {
    if (a.kind === 'pdf' || a.mimeType === 'application/pdf') {
      return {
        filename: a.filename,
        mimeType: a.mimeType,
        kind: 'pdf',
        base64: a.base64,
        extractedText: a.extractedText,
        extractedAssets: a.extractedAssets || [],
        sizeBytes: a.sizeBytes
      }
    }
    if (a.kind === 'document-text' || (a.extractedText && a.extractedText.trim().length > 20)) {
      return {
        filename: a.filename,
        mimeType: a.mimeType,
        kind: 'document-text',
        extractedText: a.extractedText,
        extractedAssets: a.extractedAssets || [],
        sizeBytes: a.sizeBytes
      }
    }
    return a
  })

  res.json({ ok: true, attachments: sanitizedAttachments })
})

conversationsRouter.post('/:id/auto-fix', requireAuth, async (req, res) => {
  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch {}
  }
  const { error, logsTail, filename, lineno, stack, errorMessage } = body || {}
  const rawErr = errorMessage || error
  if (!rawErr) return res.status(400).json({ error: 'Falta error para arreglar' })

  // Respondemos rápido para no bloquear al cliente, y disparamos el turno auto en background
  res.json({ ok: true })

  const fileInfo = (filename || lineno) ? ` en ${filename || 'desconocido'}:${lineno || 0}` : ''
  const stackTrace = stack || logsTail || '(no stack trace)'

  const combinedLogs = `${rawErr}\n${stackTrace}`
  const missingMatch = combinedLogs.match(/(?:Failed to resolve import|Cannot find module) ["']([^"'./][^"']*)["']/i)
  let depHint = ''
  if (missingMatch) {
    const rawPkg = missingMatch[1].trim()
    const pkgName = rawPkg.startsWith('@') ? rawPkg.split('/').slice(0, 2).join('/') : rawPkg.split('/')[0]
    depHint = `\n\nATENCIÓN CRÍTICA: Falta el paquete o librería "${pkgName}". Si falta en package.json, edita "package.json" inmediatamente usando propose_patch agregándolo a "dependencies" (ejemplo: "${pkgName}": "latest") para que el servidor de desarrollo pueda compilar. NO elimines ni comentes código que use "${pkgName}" si se resuelve instalando el paquete.`
  }

  const content = `CRITICAL SYSTEM FEEDBACK: La vista previa de React/Vite acaba de fallar (Crash) con el siguiente error: \n\n[${rawErr}${fileInfo}]\n\nStack Trace:\n${stackTrace}${depHint}\n\nTu tarea exclusiva es corregir este error de compilación/ejecución inmediatamente. Analiza qué import falta, qué variable está indefinida o qué componente está mal estructurado y aplica el parche usando replace_file_content o propose_patch. ESTRICTAMENTE PROHIBIDO emitir texto conversacional explicativo en este turno. Solo debes ejecutar las herramientas de edición de archivos.`

  const { triggerAutoTurn } = await import('../services/conversationTurn.js')
  triggerAutoTurn(req.user, req.params.id, content, { isAutoFix: true, hidden: true })
})

conversationsRouter.post('/:id/messages-with-attachment', requireAuth, upload.array('files', MAX_ATTACHMENTS), async (req, res) => {
  let attachments
  try {
    attachments = await Promise.all((req.files || []).map(attachmentFromUpload))
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  if (attachments.length === 0) return res.status(400).json({ error: 'Falta al menos un archivo (campo "files")' })
  let elementContext = req.body.elementContext
  if (typeof elementContext === 'string') {
    try {
      elementContext = JSON.parse(elementContext)
    } catch {
      elementContext = undefined
    }
  }
  let activeViewContext = req.body.activeViewContext
  if (typeof activeViewContext === 'string') {
    try {
      activeViewContext = JSON.parse(activeViewContext)
    } catch {
      activeViewContext = undefined
    }
  }
  const agentId = req.body.agentId
  await handleSendMessage(req, res, {
    content: req.body.content || req.body.message,
    attachments,
    mode: req.body.mode || 'build',
    elementContext,
    agentId,
    activeViewContext
  })
})
