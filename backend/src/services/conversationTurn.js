export const activeTurns = new Map()
// Compatibilidad con invocaciones legacy tipo .add()
activeTurns.add = function (key) {
  this.set(key, { startedAt: Date.now() })
}
﻿// ============================================================================
// 1. FAST-PATH: DETECCIÓn DE SALUDOS Y MENSAJES PURAMENTE SOCIALES
// ============================================================================
const GREETING_REGEX = /^(hola|buenas|buenos d[i?]as|buenas tardes|buenas noches|hey|hello|hi|saludos|qu[e?] tal|ayuda|estamos bien|todo bien|c[o?]mo est[a?]s|como estas|me escuchas|est[a?]s ah[i?]|estas ahi|ok|entendido|perfecto|gracias)\b[!?.\s]*$/i;

function isPureGreeting(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  const clean = prompt.trim().toLowerCase();
  return GREETING_REGEX.test(clean) && clean.length <= 40;
}

import { supabase } from '../db/supabaseClient.js'
import { runAgent } from './agent.js'
import { resolveDbConnection } from './dbConnectionResolver.js'
import { resetProgress, addStep, clearProgress, getProgress } from './progressTracker.js'
import { getOwnedProject, isVirtualRepo } from './projectResolver.js'
import {
  generateProjectName,
  ensureUniqueSlug,
  isGenericOrLiteralName,
} from './projectNaming.js'
import { applyCodeChanges, applyDbChanges, applyAssetChanges } from './applyProposals.js'
import { createCheckpoint } from './checkpoints.js'
import { createLocalGitCheckpoint, findProjectWorkspace } from './gitCheckpoint.js'
import { isPreviewConfigured } from '../config.js'
import fs from 'node:fs'
import path from 'node:path'
import { writeProjectFile } from './projectStorage.js'
import { inspectWebsiteUrl } from './websiteInspector.js'
import { refreshPreview, getPreviewStatus } from './previewOrchestrator.js'
import { autoInjectDependencies } from './dependencyAutoInjector.js'

// Núcleo de "mandar un mensaje al agente", separado de Express (sin tocar req/res) para poder
// dispararlo desde 2 lugares distintos: la ruta HTTP normal (routes/conversations.js, un usuario
// escribiendo en el chat) y un turno disparado por el propio backend sin que nadie haga clic
// (ver dbImport.js — después de conectar una base de datos, para cablear el código solo). Mismo
// comportamiento en los dos casos; el llamador decide qué hacer con el resultado o el error.
//
// Tira un Error con `.status` (y `.code`/`.rawDetail` si vienen del agente) en vez de escribir a
// una respuesta HTTP — el llamador HTTP lo traduce a res.json(), el llamador automático solo lo
// loguea (ver dbImport.js).
export class TurnError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    Object.assign(this, extra)
  }
}

// Dispara un turno completo del agente SIN que haya un usuario escribiendo — usado después de
// conectar/importar una base de datos, para que el código quede apuntando ahí sin que nadie
// tenga que pedirlo (ver dbImport.js). Fire-and-forget: nunca tira, solo loguea si falla, porque
// quien la llama ya respondió su propia request HTTP antes de invocar esto.
export async function triggerAutoTurn(user, conversationId, content, options = {}) {
  try {
    await runConversationTurn({
      user,
      conversationId,
      content,
      hidden: true,
      isAutoFix: Boolean(options?.isAutoFix),
      ...options
    })
  } catch (err) {
    console.error(`No se pudo completar el turno automático (conversación ${conversationId}):`, err.rawDetail || err.message)
  }
}

const CONTINUE_STAGE_PROMPT =
  'Seguí con la etapa siguiente — ya apliqué la anterior por vos. No hay ningún usuario mirando este chat esperando para confirmar entre etapas: NUNCA vuelvas a pausar preguntando "¿seguimos?" — encadená todas las etapas que falten, una tras otra, hasta terminar la migración completa en este mismo hilo de turnos.'

const MAX_AUTO_CONNECT_STAGES = 8

// Igual que triggerAutoTurn (nunca tira, solo loguea), pero para "conectar el código" — un
// pedido que, por su tamaño real (puede tocar decenas de archivos), el propio agente suele
// partir solo en etapas y pausar preguntando "¿seguimos con la etapa 2?" (ver "PEDIDOS GRANDES"
// en agent.js). Esa pausa tiene sentido con un usuario real del otro lado, pero acá NO hay
// nadie que le conteste — sin este loop, el turno quedaba parado ahí para siempre, con esa
// etapa además sin aplicar (queda 'pending', esperando el botón de aprobar que nadie va a
// tocar). Este loop hace de "usuario": aplica cada etapa que quedó pendiente y le pide seguir,
// hasta que el propio modelo termina solo (deja de pedir aprobación) o se llega al tope de
// seguridad. TODOS los turnos intermedios se insertan ocultos (hidden:true, ver
// runConversationTurn) — al chat solo le importa el resultado final, no este ida y vuelta
// interno; el último mensaje del asistente (el que de verdad cierra la migración) se
// "desoculta" al final para que se vea como la respuesta real que es.
export async function runAutoConnectLoop(user, conversationId, project, firstPrompt) {
  let content = firstPrompt
  let lastAssistantMessageId = null
  try {
    for (let stage = 0; stage < MAX_AUTO_CONNECT_STAGES; stage++) {
      const result = await runConversationTurn({ user, conversationId, content, hidden: true })
      lastAssistantMessageId = result.assistantMessage.id

      if (!result.requiresApproval) return lastAssistantMessageId // terminó solo, sin pedir más etapas

      // Quedó una etapa 'pending' sin aplicar (ver runConversationTurn: solo se auto-aplica
      // cuando requiresApproval es false) — se aplica acá mismo, mismo camino que el botón
      // "aprobar todo" de turnActions.js#approve-all, antes de pedirle que siga.
      try {
        const [{ data: codeRows }, { data: dbRows }] = await Promise.all([
          supabase.from('proposed_changes').select('*').eq('message_id', result.assistantMessage.id).eq('status', 'pending'),
          supabase.from('proposed_db_changes').select('*').eq('message_id', result.assistantMessage.id).eq('status', 'pending'),
        ])
        if (dbRows?.length) {
          await applyDbChanges(dbRows, (repo) => resolveDbConnection(user, repo))
        }
        if (codeRows?.length) {
          const applied = await applyCodeChanges(project, user.github_access_token, codeRows)
          if (applied) {
            await createCheckpoint(project, conversationId, { changeType: 'code', summary: applied.summary, commitSha: applied.commitSha })
          }
        }
        if (isPreviewConfigured && (codeRows?.length || dbRows?.length)) {
          try {
            await refreshPreview(`user:${user.id}`, project)
            if (typeof onStreamEvent === 'function') onStreamEvent({ type: 'build_applied', timestamp: Date.now() })
          } catch (e) {}
        }
      } catch (err) {
        console.error(`No se pudo auto-aplicar una etapa del turno automático (conversación ${conversationId}):`, err.message)
        return lastAssistantMessageId // no sigas encadenando etapas sobre una que no se pudo aplicar
      }

      content = CONTINUE_STAGE_PROMPT
    }
    console.error(`El turno automático de conectar código llegó al máximo de ${MAX_AUTO_CONNECT_STAGES} etapas sin terminar (conversación ${conversationId}).`)
    return lastAssistantMessageId
  } catch (err) {
    console.error(`No se pudo completar el turno automático (conversación ${conversationId}):`, err.rawDetail || err.message)
    return lastAssistantMessageId
  } finally {
    // El último mensaje (terminó solo, se cortó por el tope de seguridad, o falló aplicando)
    // es el único que de verdad cierra el asunto — se muestra en el chat como corresponde,
    // todo lo anterior queda oculto para siempre.
    if (lastAssistantMessageId) {
      try {
        const { error: unhideErr } = await supabase.from('messages').update({ hidden: false }).eq('id', lastAssistantMessageId);
        if (unhideErr) {
          console.warn('[SupabaseQueryError] unhide last assistant message failed:', { error: unhideErr.message, details: unhideErr.details });
        }
      } catch (err) {
        console.warn('[SupabaseQueryError] unhide last assistant message caught:', { error: err.message });
      }
    }
  }
}

export async function runConversationTurn({ user, conversationId, content, attachments = [], mode, elementContext, agentId, activeViewContext, signal, hidden = false, isAutoFix = false, onStreamEvent }) {
  // 1. Verificación de turno activo con auto-limpieza si expiró TTL (Dead Man's Switch por inactividad >120s o >600s total)
  if (activeTurns.has(conversationId)) {
    const existing = activeTurns.get(conversationId);
    const lastActivity = existing?.lastActivityAt || existing?.startedAt || 0;
    const isStale = (Date.now() - lastActivity > 120000) || (Date.now() - (existing?.startedAt || 0) > 600000);
    if (isStale) {
      console.warn(`[WATCHDOG] Turno huérfano inactivo detectado en conversación ${conversationId}. Liberando forzosamente.`);
      if (existing.turnTimeout) clearTimeout(existing.turnTimeout);
      if (existing.maxTimeout) clearTimeout(existing.maxTimeout);
      if (existing.abortController) {
        try { existing.abortController.abort(); } catch (_) {}
      }
      activeTurns.delete(conversationId);
      if (existing.projectId) activeTurns.delete(existing.projectId);
    } else {
      console.warn(`[Turn] Conversation ${conversationId} is already running a turn. Dropping/ignoring this concurrent request.`);
      throw new Error('Ya hay un turno en ejecución para este proyecto. Espera a que termine.');
    }
  }

  // 2. Controlador de aborto coordinado para el turno
  const turnAbortController = new AbortController();

  // 3. Watchdog adaptativo: Timeout por inactividad de 240s (se refresca con cada evento/progreso)
  // y tope de seguridad absoluto de 20 minutos (1200s) para soportar builds pesados de múltiples archivos y PDFs.
  const INACTIVITY_TIMEOUT_MS = 240000;
  const ABSOLUTE_MAX_TURN_MS = 1200000;

  const turnData = {
    conversationId,
    projectId: null,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    abortController: turnAbortController,
    explicitCancelRequested: false,
    turnTimeout: null,
    maxTimeout: null,
  };

  if (signal) {
    if (signal.aborted && turnData.explicitCancelRequested) {
      turnAbortController.abort();
    } else {
      signal.addEventListener('abort', () => {
        if (turnData.explicitCancelRequested) {
          turnAbortController.abort();
        } else {
          console.log(`[conversationTurn] Señal externa de aborto ignorada en conversación ${conversationId} porque no fue una cancelación explícita del usuario.`);
        }
      }, { once: true });
    }
  }

  const scheduleInactivityTimeout = () => {
    if (turnData.turnTimeout) clearTimeout(turnData.turnTimeout);
    turnData.turnTimeout = setTimeout(() => {
      if (activeTurns.has(conversationId) || (turnData.projectId && activeTurns.has(turnData.projectId))) {
        console.warn(`[WATCHDOG] Liberando turno huérfano por inactividad (>240s) en conversación ${conversationId} (proyecto: ${turnData.projectId || 'N/A'})`);
        try { turnAbortController.abort(); } catch (_) {}
        activeTurns.delete(conversationId);
        if (turnData.projectId) activeTurns.delete(turnData.projectId);
      }
    }, INACTIVITY_TIMEOUT_MS);
  };

  turnData.touch = () => {
    turnData.lastActivityAt = Date.now();
    scheduleInactivityTimeout();
  };

  scheduleInactivityTimeout();

  turnData.maxTimeout = setTimeout(() => {
    if (activeTurns.has(conversationId) || (turnData.projectId && activeTurns.has(turnData.projectId))) {
      console.warn(`[WATCHDOG] Tope absoluto de turno alcanzado (20 min) en conversación ${conversationId}. Liberando.`);
      try { turnAbortController.abort(); } catch (_) {}
      activeTurns.delete(conversationId);
      if (turnData.projectId) activeTurns.delete(turnData.projectId);
    }
  }, ABSOLUTE_MAX_TURN_MS);

  activeTurns.set(conversationId, turnData);

  let convo = null;
  let userMsg = null;

  try {
    if (onStreamEvent) {
      onStreamEvent({ type: 'activity_description', description: 'Analizando la estructura del proyecto...' });
    }
    if (!content?.trim() && attachments.length === 0) throw new TurnError(400, 'Mensaje vacío')

  const { data: convoData, error: convoErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('user_id', user.id)
    .single()
  if (convoErr || !convoData) throw new TurnError(404, 'Conversación no encontrada')
  convo = convoData;

  if (convo.project_id) {
    turnData.projectId = convo.project_id;
    if (activeTurns.has(convo.project_id) && activeTurns.get(convo.project_id) !== turnData) {
      const existingProj = activeTurns.get(convo.project_id);
      const lastActivityProj = existingProj?.lastActivityAt || existingProj?.startedAt || 0;
      const isStaleProj = (Date.now() - lastActivityProj > 240000) || (Date.now() - (existingProj?.startedAt || 0) > 1200000);
      if (isStaleProj) {
        console.warn(`[WATCHDOG] Turno huérfano inactivo detectado en proyecto ${convo.project_id}. Liberando forzosamente.`);
        if (existingProj.turnTimeout) clearTimeout(existingProj.turnTimeout);
        if (existingProj.maxTimeout) clearTimeout(existingProj.maxTimeout);
        if (existingProj.abortController) {
          try { existingProj.abortController.abort(); } catch (_) {}
        }
        if (existingProj.conversationId) activeTurns.delete(existingProj.conversationId);
        activeTurns.delete(convo.project_id);
      } else {
        console.warn(`[Turn] Proyecto ${convo.project_id} ya tiene un turno en ejecución.`);
        throw new Error('Ya hay un turno en ejecución para este proyecto. Espera a que termine.');
      }
    }
    activeTurns.set(convo.project_id, turnData);
  }

  let project = null
  if (convo.project_id) {
    project = await getOwnedProject(user.id, convo.project_id)
  }
  if (!project) {
    // Filas viejas sin project_id (no debería pasar tras la migración, pero por si acaso).
    throw new TurnError(409, 'Este proyecto necesita re-vincularse. Vuelve a abrirlo desde el dashboard.')
  }

  // Generación semántica asíncrona no bloqueante (estilo Lovable) si el nombre del proyecto es genérico o literal
  if (isGenericOrLiteralName(project.name, content)) {
    (async () => {
      try {
        const urls = (content || '').match(/https?:\/\/[^\s"'<>]+/gi) || []
        const attachmentNames = attachments.map((a) => a.filename).filter(Boolean)
        const generated = await generateProjectName(content, { urls, attachmentNames })
        if (generated && generated.name) {
          const { data: current } = await supabase.from('projects').select('name, slug').eq('id', project.id).single()
          if (current && isGenericOrLiteralName(current.name, content)) {
            const uniqueSlug = await ensureUniqueSlug(generated.slug, project.id, supabase)
            const { data: updatedProj } = await supabase
              .from('projects')
              .update({ name: generated.name, slug: uniqueSlug })
              .eq('id', project.id)
              .select('*')
              .single()
            if (updatedProj) {
              project.name = updatedProj.name
              project.slug = updatedProj.slug
              if (typeof onStreamEvent === 'function') {
                onStreamEvent({
                  type: 'project_updated',
                  project: {
                    id: updatedProj.id,
                    name: updatedProj.name,
                    slug: updatedProj.slug,
                  },
                })
              }
              console.log(`[projectNaming] Proyecto ${project.id} renombrado en vivo a "${updatedProj.name}" (${updatedProj.slug})`)
            }
          }
        }
      } catch (err) {
        console.warn('[conversationTurn] Error en generación de nombre semántico en background:', err.message)
      }
    })()
  }

  const isVirtual = isVirtualRepo(project.repo_full_name)
  if (!isVirtual && !user.github_access_token) {
    throw new TurnError(403, 'Conecta tu cuenta de GitHub para continuar', { code: 'github_not_connected' })
  }

    const messageText = content?.trim() || attachments.map((a) => '📎 ' + a.filename).join(' ')

  if (isPureGreeting(messageText) && attachments.length === 0) {
    const { data: userMsg, error: userMsgErr } = await supabase
      .from('messages')
      .insert({ conversation_id: convo.id, role: 'user', content: messageText, hidden })
      .select('*')
      .single()
    if (userMsgErr) throw new TurnError(500, userMsgErr.message)

    const fallbackText = '¡Hola! ¿En qué puedo ayudarte hoy con tu proyecto en FlowPro? Si deseas hacer algún cambio de diseño o código, solo dime qué necesitas.'
    
    if (onStreamEvent) {
      onStreamEvent({ type: 'text', content: fallbackText })
    }

    const { data: assistantMsg, error: assistantErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: convo.id,
        role: 'assistant',
        content: fallbackText,
        actions: [],
        question: null,
        suggestions: null,
        hidden,
      })
      .select('*')
      .single()
    if (assistantErr) throw assistantErr
    
    return assistantMsg
  }
  const { data: insertedUserMsg, error: userMsgErr } = await supabase
    .from('messages')
    .insert({ conversation_id: convo.id, role: 'user', content: messageText, hidden })
    .select('*')
    .single()
  userMsg = insertedUserMsg
  if (userMsgErr) throw new TurnError(500, userMsgErr.message)

  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', convo.id)
    .or('hidden.is.null,hidden.eq.false')
    .order('created_at', { ascending: true })

  let dbConnection = null
  try {
    dbConnection = await resolveDbConnection(user, convo.repo_full_name)
  } catch (err) {
    throw new TurnError(400, 'No se pudo preparar la conexión de base de datos', { detail: err.message })
  }

  resetProgress(convo.id)
  try {
    // ── FASE 8: PERSISTENCIA FÍSICA AUTOMÁTICA DE ACTIVOS EN EL PROYECTO ──
    // Guarda imágenes de documentos (.docx) e imágenes subidas en project_files y en los workspaces del VPS
    // ANTES de que inicie el turno del LLM para que <img src="/doc-assets/..." /> funcione de inmediato.
    try {
      // ── DETECCIÓN AUTOMÁTICA Y ESPEJADO PREVIO DE URLS EXTERNAS (Playwright + Mirroring) ──
      const detectedUrlMatch = messageText ? messageText.match(/https?:\/\/[^\s"'<>)]+/i) : null
      const detectedExternalUrl = detectedUrlMatch ? detectedUrlMatch[0] : null

      if (detectedExternalUrl && !attachments.some(a => a.kind === 'url_inspection')) {
        try {
          console.log(`[conversationTurn] URL externa detectada: ${detectedExternalUrl}. Ejecutando inspección previa y espejado de activos...`)
          onStreamEvent?.({ type: 'activity_description', description: 'Inspeccionando diseño y activos de la web de referencia...' })
          onStreamEvent?.({ type: 'telemetry', phase: 'INSPECTING_URL', label: `Inspeccionando ${detectedExternalUrl} y descargando activos...` })
          const urlInspection = await inspectWebsiteUrl(detectedExternalUrl, {
            project,
            accessToken: user?.github_access_token,
            downloadAssets: true
          })

          if (urlInspection && Array.isArray(urlInspection.extractedAssets)) {
            attachments.push({
              kind: 'url_inspection',
              filename: 'url_inspection_report.json',
              url: detectedExternalUrl,
              extractedText: urlInspection.structuredSummary || urlInspection.mainText,
              extractedAssets: urlInspection.extractedAssets,
              designSystem: urlInspection.computedDesignSystem,
              palette: urlInspection.designPalette,
              headings: urlInspection.headings,
              contact: urlInspection.contact,
              navLinks: urlInspection.navLinks,
              ...(urlInspection.screenshotBase64 ? {
                base64: urlInspection.screenshotBase64,
                mimeType: 'image/jpeg',
                isMultimodal: true
              } : {})
            })
            console.log(`[conversationTurn] Espejado exitoso: ${urlInspection.extractedAssets.length} activos descargados de ${detectedExternalUrl}`)
          }
        } catch (urlInspectErr) {
          console.warn(`[conversationTurn] Error en inspección previa de URL ${detectedExternalUrl}:`, urlInspectErr.message)
        }
      }

      const assetsToPersist = []
      for (const a of attachments) {
        if (Array.isArray(a.extractedAssets)) {
          assetsToPersist.push(...a.extractedAssets)
        }
        if ((a.kind === 'image' || a.mimeType?.startsWith('image/')) && a.base64 && !a._fromDocAsset) {
          const fileName = a.filename || 'uploaded-image.png'
          assetsToPersist.push({
            fileName,
            publicPath: `/doc-assets/${fileName}`,
            base64: a.base64,
            mimeType: a.mimeType || 'image/png',
          })
        }
      }

      for (const asset of assetsToPersist) {
        if (!asset.base64 || !asset.fileName) continue
        const relPath = `public/doc-assets/${asset.fileName}`

        // 1. Guardar en almacenamiento del proyecto (project_files o GitHub)
        await writeProjectFile(project, user?.github_access_token, {
          path: relPath,
          newContent: asset.base64,
          summary: `Activo multimedia: ${asset.fileName}`,
          contentIsBase64: true,
        }).catch(err => console.warn(`[persistAssets] writeProjectFile ${relPath}:`, err.message))

        // 2. Si existen workspaces de preview en disco en el VPS, persistir también directamente
        const previewsBase = '/opt/gitflow-previews'
        if (fs.existsSync(previewsBase)) {
          for (let i = 0; i < 5; i++) {
            const wsPath = path.join(previewsBase, `workspace-${i}`)
            if (fs.existsSync(wsPath)) {
              const targetDir = path.join(wsPath, 'public', 'doc-assets')
              try {
                fs.mkdirSync(targetDir, { recursive: true })
                fs.writeFileSync(path.join(targetDir, asset.fileName), Buffer.from(asset.base64, 'base64'))
              } catch (_) {}
            }
          }
        }
      }
    } catch (persistErr) {
      console.warn('[conversationTurn] Error en persistencia previa de activos:', persistErr.message)
    }

    if (attachments.some(a => a.mimeType?.includes('pdf') || a.filename?.toLowerCase().endsWith('.pdf') || a.kind === 'document-text')) {
      onStreamEvent?.({ type: 'activity_description', description: 'Extrayendo colores, logotipo y catálogo del documento...' })
    }

    const result = await runAgent({
      accessToken: user.github_access_token,
      project,
      history: (history || []).slice(0, -1),
      userMessage: messageText,
      signal: turnAbortController.signal,
      isExplicitCancel: () => turnData.explicitCancelRequested,
      dbConnection,
      attachments,
      mode: (mode || 'build').toLowerCase().trim(),
      isAutoFix: Boolean(isAutoFix),
      onProgress: (step) => {
        turnData.touch();
        addStep(convo.id, step);
        if (onStreamEvent) onStreamEvent(step);
      },
      ownerKey: `user:${user.id}`,
      elementContext,
      activeViewContext,
    })

    // "thinking" y "activity_description" son indicadores efímeros en vivo; no aportan nada
    // como registro histórico y jamás deben guardarse en la tabla messages de la base de datos.
    const actions = (getProgress(convo.id)?.steps || []).filter((s) => s.type !== 'thinking' && s.type !== 'activity_description')

    const { data: assistantMsg, error: assistantErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: convo.id,
        role: 'assistant',
        content: result.text,
        actions,
        question: result.askedQuestion || null,
        suggestions: result.suggestions?.length ? result.suggestions : null,
        hidden,
      })
      .select('*')
      .single()
    if (assistantErr) throw assistantErr
    if (assistantMsg && result.versionTitle) {
      assistantMsg.versionTitle = result.versionTitle;
    }

    // Por default (result.requiresApproval === false, ver agent.js) los cambios de código y de
    // base de datos se aplican SOLOS, apenas propuestos — sin esperar ningún click. Solo quedan
    // en 'pending' (esperando el botón único de aprobar, ver routes/turnActions.js) durante una
    // etapa de un plan largo, que es la única situación en la que el modelo marca
    // "requires_approval". Asset changes y Edge Functions NO se auto-aplican todavía (subir un
    // archivo real o desplegar una función es más sensible) — siguen su flujo de siempre.
    let insertedChanges = []
    let changesData = []
    if (result.proposedChanges.length > 0) {
      const rows = result.proposedChanges.map((c) => ({
        message_id: assistantMsg.id,
        conversation_id: convo.id,
        repo_full_name: convo.repo_full_name,
        file_path: c.path,
        original_content: c.originalContent,
        new_content: c.newContent,
        summary: c.summary || `Cambio en ${c.path}`,
        status: 'pending',
      }))
      const { data, error: changesErr } = await supabase.from('proposed_changes').insert(rows).select('*')
      if (changesErr) throw changesErr
      changesData = data || []
      insertedChanges = changesData
    }

    let insertedDbChanges = []
    let dbChangesData = []
    // Validate SQL payloads before inserting to prevent not-null constraint crash
    result.proposedDbChanges = (result.proposedDbChanges || []).filter(c => {
      if (!c.sql || typeof c.sql !== 'string' || c.sql.trim().length === 0) {
        console.warn('Skipping invalid migration: SQL statement is empty or null.');
        return false;
      }
      const trimmed = c.sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('SHOW') || trimmed.startsWith('EXPLAIN')) {
        console.warn('Skipping read query: Cannot be recorded as proposed migration.');
        return false;
      }
      return true;
    });

    if (result.proposedDbChanges.length > 0) {
      const rows = result.proposedDbChanges.map((c) => ({
        message_id: assistantMsg.id,
        conversation_id: convo.id,
        repo_full_name: convo.repo_full_name,
        sql: c.sql,
        summary: c.summary || 'Cambio en base de datos',
        status: c.alreadyApplied ? 'applied' : 'pending',
      }))
      const { data, error: dbChangesErr } = await supabase.from('proposed_db_changes').insert(rows).select('*')
      if (dbChangesErr) throw dbChangesErr
      dbChangesData = data || []
      insertedDbChanges = dbChangesData
    }

    if (!result.requiresApproval) {
      let anyApplied = false

      // 1. Aplicar cambios de base de datos primero (para que el esquema esté listo en PostgreSQL)
      if (dbChangesData.length > 0) {
        try {
          insertedDbChanges = await applyDbChanges(dbChangesData, (repo) => resolveDbConnection(user, repo))
          anyApplied = true
        } catch (err) {
          console.error('No se pudo auto-aplicar el cambio de base de datos:', err.message)
          const { data: refreshed } = await supabase
            .from('proposed_db_changes')
            .select('*')
            .in(
              'id',
              dbChangesData.map((c) => c.id),
            )
          if (refreshed) insertedDbChanges = refreshed
        }
      }

      // 2. Aplicar cambios de código
      if (changesData.length > 0) {
        try {
          const applied = await applyCodeChanges(project, user.github_access_token, changesData)
          if (applied) {
            insertedChanges = applied.updated
            await createCheckpoint(project, convo.id, {
              changeType: 'code',
              summary: applied.summary,
              commitSha: applied.commitSha,
            })
            anyApplied = true
          }
        } catch (err) {
          console.error('No se pudo auto-aplicar el código propuesto:', err.message)
        }
      }

      // 3. Sincronización atómica de preview: refresco unificado para BD + Código
      if (isPreviewConfigured && anyApplied) {
        try {
          await refreshPreview(`user:${user.id}`, project)
          const currentStatus = await getPreviewStatus(`user:${user.id}`).catch(() => null)
          if (currentStatus?.status !== 'error') {
            if (typeof onStreamEvent === 'function') onStreamEvent({ type: 'build_applied', timestamp: Date.now() })
          } else {
            console.warn('[conversationTurn] Build has errors, omitting build_applied event:', currentStatus?.error)
          }
        } catch (e) {}
      }
    }

    let insertedAssetChanges = []
    if (result.proposedAssetChanges?.length > 0) {
      const rows = result.proposedAssetChanges.map((c) => ({
        message_id: assistantMsg.id,
        conversation_id: convo.id,
        repo_full_name: convo.repo_full_name,
        target: c.target,
        path: c.path,
        bucket: c.bucket || null,
        filename: c.filename,
        mime_type: c.mimeType,
        size_bytes: c.sizeBytes,
        file_base64: c.base64,
        summary: c.summary || `Cambio en ${c.filename || c.path || 'asset'}`,
        status: (mode === 'build' || !result.requiresApproval || c.alreadyApplied || c.status === 'applied') ? 'applied' : 'pending',
      }))
      const { data: assetChangesData, error: assetChangesErr } = await supabase
        .from('proposed_asset_changes')
        .insert(rows)
        .select('*')
      if (assetChangesErr) throw assetChangesErr
      insertedAssetChanges = assetChangesData
    }

      if ((mode === 'build' || !result.requiresApproval) && insertedAssetChanges.length > 0) {
        try {
          const appliedAssets = await applyAssetChanges(project, user.github_access_token, insertedAssetChanges, (repo) => resolveDbConnection(user, repo))
          for (const applied of appliedAssets) {
             const idx = insertedAssetChanges.findIndex(c => c.id === applied.id)
             if (idx >= 0) insertedAssetChanges[idx] = applied
             if (applied.commitSha) {
                await createCheckpoint(project, convo.id, {
                  changeType: 'asset',
                  summary: applied.summary,
                  commitSha: applied.commitSha,
                })
             }
          }
        } catch (err) {
          console.error('No se pudo auto-aplicar el cambio de asset:', err.message)
        }
      }

    let insertedEdgeFunctions = []
    if (result.proposedEdgeFunctions?.length > 0) {
      const rows = result.proposedEdgeFunctions.map((c) => ({
        message_id: assistantMsg.id,
        conversation_id: convo.id,
        repo_full_name: convo.repo_full_name,
        slug: c.slug,
        code: c.code,
        summary: c.summary || `Edge function: ${c.slug}`,
        verify_jwt: c.verifyJwt,
        status: 'pending',
      }))
      const { data: edgeFnData, error: edgeFnErr } = await supabase.from('proposed_edge_functions').insert(rows).select('*')
      if (edgeFnErr) throw edgeFnErr
      insertedEdgeFunctions = edgeFnData
    }

    await supabase
      .from('users')
      .update({ credits_used: (user.credits_used || 0) + 1 })
      .eq('id', user.id)

    if (insertedChanges.length > 0 || (result.proposedChanges && result.proposedChanges.length > 0)) {
      onStreamEvent?.({ type: 'activity_description', description: 'Compilando cambios en la vista previa...' })
    }

    let previewUrl = null
    if (isPreviewConfigured) {
      try {
        const previewState = await getPreviewStatus(`user:${user.id}`)
        if (previewState?.url) {
          previewUrl = previewState.url
        }
      } catch (err) {
        console.error('No se pudo obtener el estado del preview en el turno:', err.message)
      }
    }

    // Registrar snapshot Git y metadata de trayectoria / roadmap
    let localGitCommitSha = null;
    const wsDir = findProjectWorkspace(project);
    if (wsDir) {
      try {
        const cp = await createLocalGitCheckpoint(wsDir, {
          conversationId: convo.id,
          messageId: assistantMsg.id,
          summary: result.versionTitle || 'Mejoras en la aplicación',
        });
        if (cp?.commitSha) localGitCommitSha = cp.commitSha;
      } catch (cpErr) {
        console.warn('[conversationTurn] Error creando checkpoint local de Git:', cpErr.message);
      }
    }

    const checkpointSha = localGitCommitSha || (insertedChanges && insertedChanges[0]?.commit_url) || null;
    if (checkpointSha || result.proposedPlan) {
      const updatedActions = [...actions];
      if (checkpointSha) {
        updatedActions.push({
          type: 'checkpoint',
          commitSha: checkpointSha,
          summary: result.versionTitle || 'Mejoras en la aplicación',
          trajectory: { commitSha: checkpointSha, messageId: assistantMsg.id },
        });
      }
      if (result.proposedPlan) {
        updatedActions.push({
          type: 'plan',
          ...result.proposedPlan,
        });
      }
      assistantMsg.actions = updatedActions;
      try {
        const { error: updErr } = await supabase.from('messages').update({ actions: updatedActions }).eq('id', assistantMsg.id);
        if (updErr) {
          console.warn('[SupabaseQueryError] update assistantMsg actions failed:', { error: updErr.message, details: updErr.details });
        }
      } catch (err) {
        console.warn('[SupabaseQueryError] update assistantMsg actions caught:', { error: err.message });
      }
    }

    onStreamEvent?.({ type: 'activity_description', description: null })
    clearProgress(convo.id)
    return {
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      changes: insertedChanges,
      dbChanges: insertedDbChanges,
      assetChanges: insertedAssetChanges,
      edgeFunctionChanges: insertedEdgeFunctions,
      requiresApproval: result.requiresApproval,
      previewUrl,
      project: project ? { id: project.id, name: project.name, slug: project.slug } : null,
    }
  } catch (err) {
    try { onStreamEvent?.({ type: 'activity_description', description: null }); } catch (_) {}
    clearProgress(convo?.id || conversationId);
    const isExplicitCancel = Boolean(turnData.explicitCancelRequested || (err.message === 'Cancelado por el usuario' && turnData.explicitCancelRequested));
    if (isExplicitCancel) {
      try {
        const { data: assistantMsg } = await supabase
          .from('messages')
          .insert({
            conversation_id: convo?.id || conversationId,
            role: 'assistant',
            content: '🛑 Se detuvo la ejecución del agente.',
            hidden
          })
          .select('*')
          .single();
        if (assistantMsg) {
          return {
            userMessage: userMsg || null,
            assistantMessage: assistantMsg,
            changes: [], dbChanges: [], assetChanges: [], edgeFunctionChanges: [],
            requiresApproval: false,
            previewUrl: null
          };
        }
      } catch (insertErr) {
        console.error('[conversationTurn] Error insertando mensaje de detención:', insertErr.message);
      }
    }
    console.error(`[TURN ERROR] en proyecto/conversación ${conversationId}:`, err.rawDetail || err.message || err);
    throw err;
  }
  } finally {
    if (turnData.turnTimeout) clearTimeout(turnData.turnTimeout);
    if (turnData.maxTimeout) clearTimeout(turnData.maxTimeout);
    activeTurns.delete(conversationId);
    if (turnData.projectId) {
      activeTurns.delete(turnData.projectId);
      try {
        const { error: updErr } = await supabase.from('projects').update({ agent_status: 'idle' }).eq('id', turnData.projectId);
        if (updErr) {
          console.warn('[SupabaseQueryError] update project agent_status failed:', { error: updErr.message, details: updErr.details });
        }
      } catch (err) {
        console.warn('[SupabaseQueryError] update project agent_status caught:', { error: err.message });
      }
    }
  }
}
