import { Router } from 'express'
import multer from 'multer'
import { requireAuth, hasAccess } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { getProgress } from '../services/progressTracker.js'
import { getOwnedProject } from '../services/projectResolver.js'
import { sendGithubAwareError, isGithubAuthError } from '../services/github.js'
import { runConversationTurn, TurnError } from '../services/conversationTurn.js'
import { isExtractableDocument, isLegacyOfficeDocument, extractDocumentText } from '../services/documentExtractor.js'

export const conversationsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB por archivo
})

const MAX_ATTACHMENTS = 5

const ALLOWED_ATTACHMENT_TYPES = new Set(['application/pdf'])

// Word/Excel no tienen forma multimodal en ninguna API de IA — a diferencia de imagen/PDF, acá
// se les saca el texto/datos (ver documentExtractor.js) y viajan como "kind: 'document-text'",
// que agent.js suma como TEXTO al mensaje del usuario en vez de mandarlos como adjunto binario.
async function attachmentFromUpload(file) {
  if (!file) return null
  const isImage = file.mimetype.startsWith('image/')
  const isPdf = ALLOWED_ATTACHMENT_TYPES.has(file.mimetype)
  if (isImage || isPdf) {
    return {
      filename: file.originalname,
      mimeType: file.mimetype,
      base64: file.buffer.toString('base64'),
      kind: isPdf ? 'pdf' : 'image',
      sizeBytes: file.size,
    }
  }
  if (isLegacyOfficeDocument(file.mimetype)) {
    throw new Error(`"${file.originalname}" es un formato de Office viejo (.doc/.xls de 97-2003) — guardalo como .docx/.xlsx y volvé a subirlo.`)
  }
  if (isExtractableDocument(file.mimetype)) {
    let extractedText
    try {
      extractedText = await extractDocumentText(file.buffer, file.mimetype)
    } catch (err) {
      throw new Error(`No se pudo leer "${file.originalname}": ${err.message}`)
    }
    return {
      filename: file.originalname,
      mimeType: file.mimetype,
      kind: 'document-text',
      extractedText,
      sizeBytes: file.size,
    }
  }
  throw new Error(`Tipo de archivo no soportado: ${file.mimetype}. Imágenes, PDF, Word (.docx) o Excel (.xlsx).`)
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

  res.json({
    conversation: convo,
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
async function handleSendMessage(req, res, { content, attachments = [], mode, elementContext, agentId }) {
  if (!hasAccess(req.user)) {
    return res.status(402).json({ error: 'Tu demo gratis o tu plan terminaron. Elige un plan para seguir usando el agente.' })
  }

  const controller = new AbortController()
  // req.on('close') aborta el agente si el cliente corta la petición SSE prematuramente
  req.on('close', () => {
    controller.abort()
  })

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const onStreamEvent = (step) => {
    if (step.type === 'telemetry' || step.type === 'usage' || step.type === 'thinking' || step.type === 'build_applied') {
      res.write(`event: ${step.type}\ndata: ${JSON.stringify(step)}\n\n`)
    }
  }

  try {
    const result = await runConversationTurn({
      user: req.user,
      conversationId: req.params.id,
      content,
      attachments,
      mode,
      elementContext, agentId,
      signal: controller.signal,
      onStreamEvent
    })
    
    res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`)
    res.end()
  } catch (err) {
    if (err.name === 'AbortError') {
      res.end()
      return
    }
    if (err instanceof TurnError) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message, code: err.code, detail: err.detail })}\n\n`)
      return res.end()
    }
    console.error(err.rawDetail ? `${err.message}\n${err.rawDetail}` : err)
    if (isGithubAuthError(err)) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'El agente de IA falló al procesar el mensaje', code: 'github_auth_error' })}\n\n`)
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message || 'El agente de IA falló al procesar el mensaje' })}\n\n`)
    }
    res.end()
  }
}

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

conversationsRouter.post('/:id/messages', requireAuth, async (req, res) => {
  await handleSendMessage(req, res, {
    content: req.body.content,
    attachments: [],
    mode: req.body.mode,
    elementContext: req.body.elementContext,
    agentId: req.body.agentId,
  })
})

conversationsRouter.post('/:id/auto-fix', requireAuth, async (req, res) => {
  const { error, logsTail } = req.body
  if (!error) return res.status(400).json({ error: 'Falta error para arreglar' })

  // Respondemos rápido para no bloquear al cliente, y disparamos el turno auto en background
  res.json({ ok: true })

  const content = `La vista previa no arranca o tiró este error de compilación: ${error}\n\nÚltimas líneas de log:\n${logsTail || '(sin salida)'}\n\nPor favor, revisá el error, usá "check_preview_errors" si hace falta, y arréglalo usando propose_patch. NO elimines código ni componentes útiles para silenciar el error, corrige la sintaxis específica manteniendo intacta la lógica y estilos visuales. No le preguntes al usuario "qué hacer" ni frenes para confirmar: proponé y aplicá el arreglo directo.`

  // import triggersAutoTurn dynamically or from top
  // we need to make sure we have access to it
  // Since we already have triggerAutoTurn we can use it
  const { triggerAutoTurn } = await import('../services/conversationTurn.js')
  triggerAutoTurn(req.user, req.params.id, content)
})

conversationsRouter.post('/:id/messages-with-attachment', requireAuth, upload.array('files', MAX_ATTACHMENTS), async (req, res) => {
  let attachments
  try {
    attachments = await Promise.all((req.files || []).map(attachmentFromUpload))
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  if (attachments.length === 0) return res.status(400).json({ error: 'Falta al menos un archivo (campo "files")' })
  let elementContext, agentId
  if (req.body.elementContext, agentId) {
    try {
      elementContext, agentId = JSON.parse(req.body.elementContext, agentId)
    } catch {
      elementContext, agentId = undefined
    }
  }
  await handleSendMessage(req, res, { content: req.body.content, attachments, mode: req.body.mode, elementContext, agentId })
})
