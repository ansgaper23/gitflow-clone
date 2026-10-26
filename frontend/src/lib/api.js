const BASE = `${import.meta.env.VITE_API_URL || ''}/api`

function getToken() {
  return localStorage.getItem('gitflow_token')
}

export function setToken(token) {
  if (token) localStorage.setItem('gitflow_token', token)
  else localStorage.removeItem('gitflow_token')
}

let isPageUnloading = false

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    isPageUnloading = true
  })
  window.addEventListener('pagehide', () => {
    isPageUnloading = true
  })
}

export function isUnloading() {
  return isPageUnloading
}

/**
 * Wrapper de fetch con detección de recarga de página (F5) y reintentos automáticos
 * con backoff para micro-cortes transitorios de red.
 */
async function resilientFetch(url, options = {}, retries = 2) {
  // Las mutaciones de mensajes (/messages o /messages-with-attachment) NO deben reintentar
  // el POST a ciegas porque el backend ya puede estar ejecutando el turno en background.
  const isMessagePost = (options.method === 'POST' || !options.method) && /\/messages(-with-attachment)?/i.test(url);
  const effectiveRetries = isMessagePost ? 0 : retries;
  const delays = [600, 1500]
  let lastError = null

  for (let attempt = 0; attempt <= effectiveRetries; attempt++) {
    if (isPageUnloading) {
      const abortErr = new Error('Página descargando')
      abortErr.name = 'AbortError'
      throw abortErr
    }

    try {
      const res = await fetch(url, options)
      return res
    } catch (err) {
      lastError = err

      // Si la ventana se está descargando o fue cancelada explícitamente, salir inmediatamente
      if (isPageUnloading || err?.name === 'AbortError' || options?.signal?.aborted) {
        const abortErr = new Error('Petición abortada')
        abortErr.name = 'AbortError'
        throw abortErr
      }

      const isTransientNetwork =
        err instanceof TypeError ||
        /failed to fetch|networkerror|load failed|network request failed/i.test(err?.message || '')

      if (!isTransientNetwork || attempt >= retries) {
        break
      }

      const delay = delays[attempt] || 1500
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  // Si tras todos los reintentos sigue fallando por corte de red, dar mensaje amigable en español
  if (
    lastError instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(lastError?.message || '')
  ) {
    const friendlyErr = new Error('No se pudo conectar con el servidor. Por favor, verifica tu conexión a internet o el estado del backend.')
    friendlyErr.name = 'NetworkError'
    friendlyErr.code = 'NETWORK_ERROR'
    friendlyErr.originalError = lastError
    throw friendlyErr
  }

  throw lastError
}

async function request(path, options = {}) {
  const token = getToken()
  const res = await resilientFetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json() : null

  if (!res.ok) {
    const err = new Error((data && data.error) || await res.text())
    if (data && data.code) err.code = data.code
    throw err
  }
  return data
}

async function uploadFile(path, formData, options = {}) {
  const token = getToken()
  const res = await resilientFetch(`${BASE}${path}`, {
    ...options,
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: formData,
    signal: options.signal,
  }, 1)
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json() : null
  if (!res.ok) {
    const err = new Error((data && data.error) || await res.text())
    if (data && data.code) err.code = data.code
    throw err
  }
  return data
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined' || !file) {
      return resolve('')
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const commaIdx = result.indexOf(',')
        resolve(commaIdx !== -1 ? result.slice(commaIdx + 1) : result)
      } else {
        resolve('')
      }
    }
    reader.onerror = (err) => reject(err)
    reader.readAsDataURL(file)
  })
}

async function recoverTurnFromPolling(conversationId, onEvent, signal, maxWaitMs = 1200000) {
  const token = getToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const startTime = Date.now()
  let lastStepCount = 0
  let inactiveCheckCount = 0

  if (onEvent) {
    onEvent('telemetry', { type: 'telemetry', phase: 'RUNNING', label: 'Procesando cambios en el proyecto...' })
  }

  while (Date.now() - startTime < maxWaitMs) {
    if (isPageUnloading || signal?.aborted) {
      const abortErr = new Error('Stream cancelado')
      abortErr.name = 'AbortError'
      throw abortErr
    }

    await new Promise((r) => setTimeout(r, 2000))

    try {
      // 1. Obtener actividad en vivo para alimentar la UI
      const actRes = await fetch(`${BASE}/conversations/${conversationId}/activity`, { headers, signal })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)

      if (actRes?.steps && actRes.steps.length > lastStepCount) {
        const newSteps = actRes.steps.slice(lastStepCount)
        lastStepCount = actRes.steps.length
        if (onEvent) {
          for (const s of newSteps) {
            onEvent(s.type || 'telemetry', s)
          }
        }
      } else if (lastStepCount === 0 && onEvent) {
        onEvent('telemetry', { type: 'telemetry', phase: 'RUNNING', label: 'Procesando cambios en el proyecto...' })
      }

      // 2. Verificar si el turno ya finalizó en el backend
      const statusRes = await fetch(`${BASE}/conversations/${conversationId}/turn-status`, { headers, signal })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)

      if (statusRes && statusRes.active === false) {
        // El turno terminó o abortó en el backend. Esperamos 1 segundo para asegurar persistencia en BD
        await new Promise(r => setTimeout(r, 1000));
        const msgRes = await fetch(`${BASE}/conversations/${conversationId}/messages?limit=10`, { headers, signal })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)

        if (msgRes && Array.isArray(msgRes.messages) && msgRes.messages.length > 0) {
          const rawMsgs = msgRes.messages;
          let lastUserIndex = -1;
          for (let i = rawMsgs.length - 1; i >= 0; i--) {
            if (rawMsgs[i].role === 'user') {
              lastUserIndex = i;
              break;
            }
          }

          if (lastUserIndex !== -1) {
            const userMessage = rawMsgs[lastUserIndex];
            const userTime = new Date(userMessage.created_at).getTime();

            // PROHIBIDO reciclar mensajes viejos: solo tomar un assistant generado DESPUÉS del userMessage
            const assistantMessage = rawMsgs.slice(lastUserIndex + 1).find(m =>
              m.role === 'assistant' && new Date(m.created_at).getTime() >= userTime
            );

            if (assistantMessage) {
              return {
                userMessage,
                assistantMessage,
                changes: msgRes.changes || [],
                dbChanges: msgRes.dbChanges || [],
                assetChanges: msgRes.assetChanges || [],
                edgeFunctionChanges: msgRes.edgeFunctionChanges || [],
              };
            }
          }
        }

        // Si el backend dice que NO está activo y tras 2 comprobaciones no hay mensaje nuevo del asistente,
        // significa que el turno abortó con error fatal en el backend (ej. excepción de código o error interno).
        // Salir de inmediato arrojando el error en lugar de bloquear la interfaz por 20 minutos.
        inactiveCheckCount++
        if (inactiveCheckCount >= 2) {
          console.warn(`[recoverTurnFromPolling] El turno en ${conversationId} no está activo y no produjo respuesta del asistente. Saliendo de recuperación.`)
          throw new Error('El turno en el servidor finalizó inesperadamente sin generar respuesta.')
        }
      } else if (statusRes && statusRes.active === true) {
        inactiveCheckCount = 0
      }
    } catch (pollErr) {
      if (signal?.aborted || pollErr?.name === 'AbortError') throw pollErr
      if (pollErr?.message?.includes('finalizó inesperadamente')) throw pollErr
    }
  }

  // Si se agotó el tiempo máximo, intentar una última lectura de mensajes
  const lastCheck = await fetch(`${BASE}/conversations/${conversationId}/messages?limit=10`, { headers, signal })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)

  if (lastCheck && Array.isArray(lastCheck.messages) && lastCheck.messages.length > 0) {
    const rawMsgs = lastCheck.messages;
    let lastUserIndex = -1;
    for (let i = rawMsgs.length - 1; i >= 0; i--) {
      if (rawMsgs[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex !== -1) {
      const userMessage = rawMsgs[lastUserIndex];
      const userTime = new Date(userMessage.created_at).getTime();
      const assistantMessage = rawMsgs.slice(lastUserIndex + 1).find(m =>
        m.role === 'assistant' && new Date(m.created_at).getTime() >= userTime
      );

      if (assistantMessage) {
        return {
          userMessage,
          assistantMessage,
          changes: lastCheck.changes || [],
          dbChanges: lastCheck.dbChanges || [],
          assetChanges: lastCheck.assetChanges || [],
          edgeFunctionChanges: lastCheck.edgeFunctionChanges || [],
        };
      }
    }
  }

  throw new Error('La conexión con el servidor se interrumpió y no se pudo recuperar el resultado del turno.')
}

async function streamRequest(path, options = {}, onEvent) {
  let hasExplicitServerError = false;
  let serverErrorMessage = '';
  const token = getToken()
  const conversationId = path.match(/\/conversations\/([a-zA-Z0-9_-]+)/)?.[1]
  let res
  try {
    res = await resilientFetch(`${BASE}${path}`, {
      ...options,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
      signal: options.signal,
    })
  } catch (err) {
    if (isPageUnloading || options?.signal?.aborted) {
      const abortErr = new Error('Stream cancelado')
      abortErr.name = 'AbortError'
      throw abortErr
    }

    // Auto-recuperación: Si el fetch falló por corte de red inicial (Response headers 0 / timeout / AbortError sin signal abortada),
    // comprobamos dos veces si el backend ya arrancó el turno o si ya está activo. Si está activo, recuperamos el turno silenciosamente sin error.
    if (conversationId) {
      for (const delay of [0, 800]) {
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        try {
          const turnCheck = await fetch(`${BASE}/conversations/${conversationId}/turn-status`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).then(r => r.ok ? r.json() : null).catch(() => null)

          if (turnCheck && turnCheck.active) {
            console.info(`[streamRequest] Turno activo en backend detectado tras corte de red inicial. Activando polling de recuperación...`)
            return await recoverTurnFromPolling(conversationId, onEvent, options.signal)
          }
        } catch (_) {}
      }
    }
    throw err
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json() : null

  if (!res.ok) {
    const errText = (data && data.error) || await res.text().catch(() => '')
    if (res.status === 409 || errText.includes('Ya hay un turno en ejecución')) {
      console.info(`[streamRequest] Backend reportó turno en ejecución (HTTP ${res.status}). Conectando a polling de recuperación...`)
      if (conversationId) {
        return await recoverTurnFromPolling(conversationId, onEvent, options.signal)
      }
    }
    const err = new Error(errText)
    if (data && data.code) err.code = data.code
    throw err
  }

  if (isJson) {
    return data;
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finalResult = null
  let currentEvent = null

  try {
    while (true) {
      if (isPageUnloading || options?.signal?.aborted) {
        try { reader.cancel() } catch (_) {}
        const abortErr = new Error('Stream cancelado')
        abortErr.name = 'AbortError'
        throw abortErr
      }

      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.startsWith(':')) {
          // Keep-alive SSE comment ping (e.g. ": ping")
          continue
        }
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim()
        } else if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim()
          if (dataStr === '[DONE]') continue
          
          let data;
          try {
            if (!dataStr || dataStr === 'undefined' || dataStr === 'null') continue;
            data = JSON.parse(dataStr);
          } catch (err) {
            console.warn('[safeJsonParse] String no es JSON valido:', dataStr);
            continue;
          }

          if (currentEvent === 'complete') {
            finalResult = data
          } else if (currentEvent === 'turn_running' || (currentEvent === 'error' && data?.error?.includes('Ya hay un turno en ejecución'))) {
            console.info('[streamRequest] Turno activo en progreso detectado en SSE. Conectando a recoverTurnFromPolling...')
            return await recoverTurnFromPolling(conversationId, onEvent, options.signal)
          } else if (currentEvent === 'error') {
            hasExplicitServerError = true;
            serverErrorMessage = data?.error || 'Error en el stream';
            throw new Error(serverErrorMessage)
          } else if (onEvent) {
            onEvent(currentEvent, data)
          }
        }
      }
    }
  } catch (streamErr) {
    if (isPageUnloading || options?.signal?.aborted) {
      const abortErr = new Error('Stream cancelado')
      abortErr.name = 'AbortError'
      throw abortErr
    }

    if (hasExplicitServerError) {
      throw streamErr;
    }

    // Si el socket SSE se cortó prematuramente pero el turno sigue corriendo en backend:
    if (conversationId && !finalResult) {
      console.warn('[streamRequest] Socket SSE desconectado prematuramente. Activando auto-recovery polling...', streamErr.message);
      try {
        return await recoverTurnFromPolling(conversationId, onEvent, options.signal);
      } catch (recoveryErr) {
        if (options?.signal?.aborted || recoveryErr?.name === 'AbortError') throw recoveryErr;
        console.error('[streamRequest] Falló la auto-recuperación:', recoveryErr);
      }
    }
    throw streamErr
  }

  if (!finalResult && conversationId && !hasExplicitServerError) {
    return await recoverTurnFromPolling(conversationId, onEvent, options.signal);
  }

  return finalResult
}

export const api = {
  health: () => request('/health'),
  me: () => request('/auth/me'),
  register: (email, password, name) => request('/auth/register', { method: 'POST', body: { email, password, name } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  githubLinkUrl: () => `${BASE}/auth/github/login?linkToken=${encodeURIComponent(getToken() || '')}`,
  googleLinkUrl: () => `${BASE}/auth/google/login?linkToken=${encodeURIComponent(getToken() || '')}`,
  repos: () => request('/repos'),
  repoTree: (owner, repo) => request(`/repos/${owner}/${repo}/tree`),
  listProjects: () => request('/projects'),
  getProject: (projectId) => request(`/projects/${projectId}`),
  deleteProject: (projectId) => request(`/projects/${projectId}`, { method: 'DELETE' }),
  renameProject: (projectId, name) => request(`/projects/${projectId}`, { method: 'PATCH', body: { name } }),
  openProject: (repoFullName) => request('/projects/open', { method: 'POST', body: { repoFullName } }),
  remixProject: (projectId) => request(`/projects/${projectId}/remix`, { method: 'POST' }),
  publishProject: (projectId) => request(`/projects/${projectId}/publish`, { method: 'POST' }),
  unpublishProject: (projectId) => request(`/projects/${projectId}/unpublish`, { method: 'POST' }),
  connectDomain: (projectId, domain) => request(`/projects/${projectId}/domain`, { method: 'POST', body: { domain } }),
  domainStatus: (projectId) => request(`/projects/${projectId}/domain/status`),
  disconnectDomain: (projectId) => request(`/projects/${projectId}/domain`, { method: 'DELETE' }),
  migrateToGithub: (projectId, repoName) =>
    request(`/projects/${projectId}/migrate-to-github`, { method: 'POST', body: { repoName } }),
  listProjectPages: (projectId) => request(`/projects/${projectId}/pages`),
  listProjectFiles: (projectId) => request(`/projects/${projectId}/files`),
  listProjectSecrets: (projectId) => request(`/projects/${projectId}/secrets`),
  saveProjectSecret: (projectId, key, value) => request(`/projects/${projectId}/secrets`, { method: 'POST', body: { key, value } }),
  deleteProjectSecret: (projectId, secretId) => request(`/projects/${projectId}/secrets/${secretId}`, { method: 'DELETE' }),
  listProjectSkills: (projectId) => request(`/projects/${projectId}/skills`),
  uploadProjectSkill: (projectId, file) => {
    const form = new FormData()
    form.append('file', file)
    return uploadFile(`/projects/${projectId}/skills`, form)
  },
  toggleProjectSkill: (projectId, skillId, isActive) =>
    request(`/projects/${projectId}/skills/${skillId}`, { method: 'PATCH', body: { isActive } }),
  deleteProjectSkill: (projectId, skillId) => request(`/projects/${projectId}/skills/${skillId}`, { method: 'DELETE' }),
  listProjectServerSecrets: (projectId) => request(`/projects/${projectId}/server-secrets`),
  listProjectEdgeFunctions: (projectId) => request(`/projects/${projectId}/edge-functions`),
  saveProjectServerSecret: (projectId, key, value) =>
    request(`/projects/${projectId}/server-secrets`, { method: 'POST', body: { key, value } }),
  deleteProjectServerSecret: (projectId, secretId) =>
    request(`/projects/${projectId}/server-secrets/${secretId}`, { method: 'DELETE' }),
  projectAnalytics: (projectId, days) => request(`/analytics/projects/${projectId}${days ? `?days=${days}` : ''}`),
  readProjectFile: (projectId, path) => request(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`),
  saveProjectFile: (projectId, path, content) =>
    request(`/projects/${projectId}/file`, { method: 'PUT', body: { path, content } }),
  createProjectFile: (projectId, path, content = '') =>
    request(`/projects/${projectId}/file`, { method: 'POST', body: { path, content } }),
  deleteProjectFile: (projectId, path) =>
    request(`/projects/${projectId}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  downloadProjectZip: async (projectId, slug = 'project') => {
    const token = localStorage.getItem('gitflow_token')
    const res = await fetch(`/api/projects/${projectId}/export-zip`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    if (!res.ok) throw new Error('Error al descargar ZIP del proyecto')
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}.zip`
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  },
  listCheckpoints: (projectId) => request(`/projects/${projectId}/checkpoints`),
  restoreCheckpoint: (projectId, checkpointId) =>
    request(`/projects/${projectId}/checkpoints/${checkpointId}/restore`, { method: 'POST' }),
  checkSlugAvailable: (slug, projectId) =>
    request(`/projects/slug-available?slug=${encodeURIComponent(slug)}&projectId=${encodeURIComponent(projectId)}`),
  updateProjectSlug: (projectId, slug) => request(`/projects/${projectId}/slug`, { method: 'PATCH', body: { slug } }),
  updateProjectKnowledge: (projectId, knowledge) =>
    request(`/projects/${projectId}/knowledge`, { method: 'PATCH', body: { knowledge } }),
  updateProjectAiMemory: (projectId, aiMemory) =>
    request(`/projects/${projectId}/ai-memory`, { method: 'PATCH', body: { aiMemory } }),
  uploadProjectLogo: (projectId, file) => {
    const form = new FormData()
    form.append('file', file)
    return uploadFile(`/projects/${projectId}/logo`, form)
  },
  uploadProjectSocialImage: (projectId, file) => {
    const form = new FormData()
    form.append('file', file)
    return uploadFile(`/projects/${projectId}/social-image`, form)
  },
  conversations: (projectId) => request(`/conversations?projectId=${encodeURIComponent(projectId)}`),
  createConversation: (projectId, title) =>
    request('/conversations', { method: 'POST', body: { projectId, title } }),
  conversationMessages: (id, { limit, before } = {}) => {
    const params = new URLSearchParams()
    if (limit) params.set('limit', limit)
    if (before) params.set('before', before)
    const qs = params.toString()
    return request(`/conversations/${id}/messages${qs ? `?${qs}` : ''}`)
  },
  conversationActivity: (id) => request(`/conversations/${id}/activity`),
  turnStatus: (id) => request(`/conversations/${id}/turn-status`),
  stopConversation: (id) => request(`/conversations/${id}/cancel`, { method: 'POST' }),
  cancelConversation: (id) => request(`/conversations/${id}/cancel`, { method: 'POST' }),
  recoverTurn: (id, onEvent, signal) => recoverTurnFromPolling(id, onEvent, signal),
  sendMessage: (id, content, signal, mode, elementContext, agentId, onEvent, activeViewContext) =>
    streamRequest(`/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, message: content, mode: mode || 'build', elementContext, agentId, activeViewContext }),
      signal
    }, onEvent),
  sendMessageWithAttachments: async (id, content, files, signal, mode, elementContext, agentId, onEvent, activeViewContext) => {
    // PASO A: Desacoplar la extracción del archivo del stream SSE.
    // Subida ultrarrápida (JSON < 300ms) para extraer texto y metadatos de los archivos.
    let processedAttachments = []
    if (files && files.length > 0) {
      if (onEvent) {
        onEvent('telemetry', { type: 'telemetry', phase: 'UPLOAD', label: 'Procesando documentos adjuntos...' })
      }
      try {
        const form = new FormData()
        for (const file of files) form.append('files', file)
        const parseRes = await uploadFile(`/conversations/${id}/parse-attachments`, form, { signal })
        if (parseRes && parseRes.attachments) {
          processedAttachments = parseRes.attachments
        }
      } catch (uploadErr) {
        if (uploadErr?.name === 'AbortError' || isPageUnloading) throw uploadErr
        console.warn('[sendMessageWithAttachments] Falló multipart /parse-attachments, intentando fallback JSON:', uploadErr.message)
        try {
          const filesJson = await Promise.all(files.map(async (f) => {
            const base64 = await fileToBase64(f)
            return {
              filename: f.name || 'archivo',
              mimeType: f.type || 'application/octet-stream',
              base64,
              sizeBytes: f.size || 0
            }
          }))
          const jsonRes = await request(`/conversations/${id}/parse-attachments-json`, {
            method: 'POST',
            body: { files: filesJson },
            signal
          })
          if (jsonRes && jsonRes.attachments) {
            processedAttachments = jsonRes.attachments
          }
        } catch (jsonErr) {
          if (jsonErr?.name === 'AbortError' || isPageUnloading) throw jsonErr
          console.error('[sendMessageWithAttachments] Falló fallback JSON:', jsonErr.message)
        }
      }
    }

    // PASO B: Con los datos extraídos (en < 300ms), iniciar el turno vía JSON -> SSE estándar
    return streamRequest(`/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        message: content,
        attachments: processedAttachments,
        mode: mode || 'build',
        elementContext,
        agentId,
        activeViewContext
      }),
      signal
    }, onEvent)
  },
  approveChange: (id) => request(`/changes/${id}/approve`, { method: 'POST' }),
  rejectChange: (id) => request(`/changes/${id}/reject`, { method: 'POST' }),
  approveAllForMessage: (messageId) => request(`/turn/${messageId}/approve-all`, { method: 'POST' }),
  rejectAllForMessage: (messageId) => request(`/turn/${messageId}/reject-all`, { method: 'POST' }),
  plans: () => request('/plans'),
  updatePlan: (id, patch) => request(`/admin/plans/${id}`, { method: 'PATCH', body: patch }),
  purchasePlan: (planId) => request('/plans/purchase', { method: 'POST', body: { planId } }),
  checkoutPlan: (planId) => request('/plans/checkout', { method: 'POST', body: { planId } }),
  yapeInfo: () => request('/plans/yape-info'),
  yapeCheckout: (planId) => request('/plans/yape-checkout', { method: 'POST', body: { planId } }),
  confirmYapePayment: (paymentId, operationNumber) =>
    request(`/plans/yape-checkout/${paymentId}/confirm`, { method: 'POST', body: { operationNumber } }),
  redeemPlanKey: (code) => request('/plans/redeem-key', { method: 'POST', body: { code } }),

  dbConnection: (repoFullName) => request(`/db-connections?repo=${encodeURIComponent(repoFullName)}`),
  dbTables: (repoFullName) => request(`/db-connections/tables?repo=${encodeURIComponent(repoFullName)}`),
  dbTableRows: (repoFullName, table, limit) =>
    request(`/db-connections/tables/${encodeURIComponent(table)}/rows?repo=${encodeURIComponent(repoFullName)}${limit ? `&limit=${limit}` : ''}`),
  insertDbTableRow: (repoFullName, table, data) =>
    request(`/db-connections/tables/${encodeURIComponent(table)}/rows?repo=${encodeURIComponent(repoFullName)}`, { method: 'POST', body: data }),
  updateDbTableRow: (repoFullName, table, pkColumn, pkValue, data) =>
    request(`/db-connections/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(pkColumn)}/${encodeURIComponent(pkValue)}?repo=${encodeURIComponent(repoFullName)}`, { method: 'PUT', body: data }),
  deleteDbTableRow: (repoFullName, table, pkColumn, pkValue) =>
    request(`/db-connections/tables/${encodeURIComponent(table)}/rows/${encodeURIComponent(pkColumn)}/${encodeURIComponent(pkValue)}?repo=${encodeURIComponent(repoFullName)}`, { method: 'DELETE' }),
  cloudTables: (projectId) => request(`/projects/${projectId}/cloud/database/tables`),
  cloudTableRows: (projectId, tableName, page = 1, limit = 50) =>
    request(`/projects/${projectId}/cloud/database/tables/${encodeURIComponent(tableName)}/rows?page=${page}&limit=${limit}`),
  insertCloudTableRow: (projectId, tableName, data) =>
    request(`/projects/${projectId}/cloud/database/tables/${encodeURIComponent(tableName)}/rows`, { method: 'POST', body: data }),
  updateCloudTableRow: (projectId, tableName, pkColumn, pkValue, data) =>
    request(`/projects/${projectId}/cloud/database/tables/${encodeURIComponent(tableName)}/rows/${encodeURIComponent(pkValue)}`, {
      method: 'PATCH',
      body: { pkColumn, payload: data }
    }),
  deleteCloudTableRow: (projectId, tableName, pkColumn, pkValue) =>
    request(`/projects/${projectId}/cloud/database/tables/${encodeURIComponent(tableName)}/rows/${encodeURIComponent(pkValue)}?pkColumn=${encodeURIComponent(pkColumn)}`, {
      method: 'DELETE'
    }),
  executeCloudSql: (projectId, sql) =>
    request(`/projects/${projectId}/cloud/database/sql`, {
      method: 'POST',
      body: { sql }
    }),
  connectDb: (repoFullName, label, target) =>
    request('/db-connections', { method: 'POST', body: { repoFullName, label, ...target } }),
  disconnectDb: (id) => request(`/db-connections/${id}`, { method: 'DELETE' }),
  dbMatchCheck: (repoFullName) => request(`/db-connections/match-check?repo=${encodeURIComponent(repoFullName)}`),
  approveDbChange: (id) => request(`/db-changes/${id}/approve`, { method: 'POST' }),
  rejectDbChange: (id) => request(`/db-changes/${id}/reject`, { method: 'POST' }),
  approveEdgeFunctionChange: (id) => request(`/edge-function-changes/${id}/approve`, { method: 'POST' }),
  rejectEdgeFunctionChange: (id) => request(`/edge-function-changes/${id}/reject`, { method: 'POST' }),
  supabaseOAuthStatus: () => request('/db-connections/supabase-status'),
  // Cuentas de Supabase ya vinculadas (podÃ©s tener varias) y sus proyectos â€” "accountId" dice de
  // cuÃ¡l de ellas listar.
  supabaseAccounts: () => request('/db-connections/supabase-accounts'),
  disconnectSupabaseAccount: (id) => request(`/db-connections/supabase-accounts/${id}`, { method: 'DELETE' }),
  supabaseProjects: (accountId) => request(`/db-connections/supabase-projects?accountId=${encodeURIComponent(accountId)}`),
  vpsDbStatus: () => request('/db-connections/vps-status'),
  createVpsDb: (repoFullName, label) => request('/db-connections/vps', { method: 'POST', body: { repoFullName, label } }),
  // "label" es el nombre que el usuario le pone a la cuenta ANTES de salir a Supabase (ej. "Mi
  // cuenta", "Cliente X") â€” vuelve del callback como una cuenta vinculada nueva, no reemplaza
  // ninguna existente.
  supabaseLoginUrl: (projectId, label) =>
    request(`/auth/supabase/login-url?projectId=${encodeURIComponent(projectId)}${label ? `&label=${encodeURIComponent(label)}` : ''}`),
  importSqlDump: (conversationId, file) => {
    const form = new FormData()
    form.append('conversationId', conversationId)
    form.append('file', file)
    return uploadFile('/db-import', form)
  },
  chooseBackupDb: (pendingImportId, type, extra) =>
    request('/db-import/choose-backup-db', { method: 'POST', body: { pendingImportId, type, ...extra } }),
  approveAssetChange: (id) => request(`/asset-changes/${id}/approve`, { method: 'POST' }),
  rejectAssetChange: (id) => request(`/asset-changes/${id}/reject`, { method: 'POST' }),

  createProject: (prompt, projectName, signal) =>
    request('/projects/create', { method: 'POST', body: { prompt, projectName }, signal }),
  designDirections: (prompt, signal) =>
    request('/projects/design-directions', { method: 'POST', body: { prompt }, signal }),
  quickEditProject: (projectId, body) =>
    request(`/projects/${projectId}/quick-edit`, { method: 'POST', body }),

  previewStatus: (projectId) => request(`/preview/status${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),
  startPreview: (projectId) => request('/preview/start', { method: 'POST', body: { projectId } }),
  restartPreview: (projectId) => request('/preview/restart', { method: 'POST', body: { projectId } }),
  stopPreview: (projectId) => request('/preview/stop', { method: 'POST', body: { projectId } }),

  aiAccounts: () => request('/admin/ai-accounts'),
  createAiAccount: (body) => request('/admin/ai-accounts', { method: 'POST', body }),
  updateAiAccount: (id, body) => request(`/admin/ai-accounts/${id}`, { method: 'PATCH', body }),
  deleteAiAccount: (id) => request(`/admin/ai-accounts/${id}`, { method: 'DELETE' }),
  testAiAccount: (id) => request(`/admin/ai-accounts/${id}/test`, { method: 'POST' }),
  startAntigravityLogin: () => request('/admin/ai-accounts/antigravity-login/start', { method: 'POST' }),
  completeAntigravityLogin: (accountId, code, extra) =>
    request(`/admin/ai-accounts/antigravity-login/${accountId}/complete`, { method: 'POST', body: { code, ...extra } }),
  cancelAntigravityLogin: (accountId) =>
    request(`/admin/ai-accounts/antigravity-login/${accountId}/cancel`, { method: 'POST' }),
  aiUsageSummary: () => request('/admin/ai-usage/summary'),
  clearAiUsageErrors: () => request('/admin/ai-usage/clear-errors', { method: 'POST' }),

  adminUsers: () => request('/admin/users'),
  adminPayments: () => request('/admin/payments'),
  adminApprovePayment: (id) => request(`/admin/payments/${id}/approve`, { method: 'POST' }),
  adminRejectPayment: (id) => request(`/admin/payments/${id}/reject`, { method: 'POST' }),
  adminSystemStatus: () => request('/admin/system-status'),
  grantPlan: (userId, planId) => request(`/admin/users/${userId}/grant-plan`, { method: 'POST', body: { planId } }),
  revokePlan: (userId) => request(`/admin/users/${userId}/revoke-plan`, { method: 'POST' }),
  impersonateUser: (userId) => request(`/admin/users/${userId}/impersonate`, { method: 'POST' }),
  setCollaborator: (userId, isCollaborator) =>
    request(`/admin/users/${userId}/set-collaborator`, { method: 'POST', body: { isCollaborator } }),

  // --- Panel Reseller (Fase 1) ---
  adminResellers: () => request('/admin/resellers'),
  adminGrantResellerLicense: (userId, body) => request(`/admin/resellers/${userId}/license`, { method: 'POST', body }),
  adminGrantResellerCredits: (userId, amount) => request(`/admin/resellers/${userId}/credits`, { method: 'POST', body: { amount } }),
  adminResellerPlanCosts: () => request('/admin/reseller-plan-costs'),
  adminSetResellerPlanCost: (planId, creditCost) =>
    request(`/admin/reseller-plan-costs/${planId}`, { method: 'PATCH', body: { creditCost } }),

  resellerStatus: () => request('/reseller/status'),
  resellerWallet: () => request('/reseller/wallet'),
  resellerPlanCosts: () => request('/reseller/plan-costs'),
  resellerClients: () => request('/reseller/clients'),
  resellerActivatePlan: (clientId, planId) =>
    request(`/reseller/clients/${clientId}/activate-plan`, { method: 'POST', body: { planId } }),
  resellerSetGateways: (gateways) => request('/reseller/gateways', { method: 'PUT', body: { gateways } }),
  resellerInvites: () => request('/reseller/invites'),
  resellerCreateInvite: (email) => request('/reseller/invites', { method: 'POST', body: { email } }),
  resellerKeys: () => request('/reseller/keys'),
  resellerGenerateKey: (planId) => request('/reseller/keys', { method: 'POST', body: { planId } }),
  resellerRevokeKey: (id) => request(`/reseller/keys/${id}/revoke`, { method: 'POST' }),
  resellerInvitePreview: (token) => request(`/reseller/invites/${token}`),
  resellerAcceptInvite: (token) => request(`/reseller/invites/${token}/accept`, { method: 'POST' }),
  autoFixPreview: (id, error, logsTail, extra = {}) => request(`/conversations/${id}/auto-fix`, { method: 'POST', body: { error, logsTail, ...extra } }),
  listAgents: () => request('/agents'),
  createAgent: (agent) => request('/agents', { method: 'POST', body: agent }),
  updateAgent: (id, agent) => request(`/agents/${id}`, { method: 'PATCH', body: agent }),
  deleteAgent: (id) => request(`/agents/${id}`, { method: 'DELETE' }),
  updateProjectDefaultAgent: (projectId, agentId) => request(`/projects/${projectId}/default-agent`, { method: 'PATCH', body: { default_agent_id: agentId } }),

  // Subsistema de Cola de Mensajes (Message Queue Engine estilo Lovable)
  getConversationQueue: (conversationId) => request(`/conversations/${conversationId}/queue`),
  enqueueMessage: (conversationId, body) => request(`/conversations/${conversationId}/queue`, { method: 'POST', body }),
  updateQueuedMessage: (conversationId, queueId, body) => request(`/conversations/${conversationId}/queue/${queueId}`, { method: 'PATCH', body }),
  deleteQueuedMessage: (conversationId, queueId) => request(`/conversations/${conversationId}/queue/${queueId}`, { method: 'DELETE' }),
  abortTurn: (conversationId) => request(`/conversations/${conversationId}/abort`, { method: 'POST' }),

  // Subsistema de Rollback Atómico y Trayectoria
  revertTrajectory: (projectId, body) => request(`/projects/${projectId}/revert-trajectory`, { method: 'POST', body }),

  // Subsistema de Hoja de Ruta / Planes Interactivos
  respondTool: (conversationId, body) => request(`/conversations/${conversationId}/tools/respond`, { method: 'POST', body }),
}
