import { logAiUsage } from '../aiUsageLog.js'
import { isCodeAgentCall, bridgeFetch, bridgeFetchJob, buildCodeAgentInstruccion, syncWorkspace, extractTokens } from './bridgeClient.js'

// Antigravity no es un proveedor de IA "de verdad" (no habla la Anthropic Messages API ni el
// formato de OpenAI): es un puente HTTP propio (antigravity-bridge, alojado junto al backend en
// el VPS) que envuelve la CLI "agy" de Google Antigravity. Esa CLI tiene sus PROPIAS herramientas
// internas (list_files/read_file/propose_change, expuestas vía MCP) que operan sobre una carpeta
// de trabajo propia del bridge — no sobre las tools ni el repo de GitHub que reciben los demás
// proveedores. Por eso esta interfaz cumple el mismo contrato que converseAnthropic/
// converseGemini/etc. (system, tools, history, userMessage, executeTool → {text}), pero por
// dentro hace algo distinto: sincroniza el árbol del proyecto contra el bridge y traduce lo que
// "agy" proponga a un "propose_change" real de FlowPro, en vez de pasarle las tools tal cual.
//
// Limitación real, a propósito: solo puede proponer cambios de ARCHIVOS. No sabe crear tablas
// (propose_db_change), ni desplegar Edge Functions, ni generar imágenes, ni testear la preview —
// si el pedido necesita eso, el modelo simplemente lo va a decir en texto en vez de ejecutarlo.
//
// Hallazgo real de uso (ver providers/claudecode.js para el motor hermano, más estricto en esto):
// "agy" a veces escribe directo en su copia de trabajo sin pasar por su propia tool MCP
// propose_change — nunca llega a esta función como "pendingProposals" entonces, así que nunca se
// traduce a un propose_change de FlowPro ni pasa por la aprobación real. El efecto queda
// contenido en la carpeta descartable del bridge (se pisa en el próximo sync), pero por eso NO es
// 100% cierto que "nunca escribe nada" — solo que nunca le llega a FlowPro.

const ENGINE = 'Antigravity'

export async function converseAntigravity({
  apiKey,
  baseURL,
  model,
  system,
  tools,
  history,
  userMessage,
  executeTool,
  signal,
  accountId,
  bridgeAccountId,
  projectId,
  scope = 'agent',
  toolChoice = undefined,
}) {
  if (!baseURL) {
    throw new Error('A la cuenta de Antigravity le falta la Base URL del bridge.')
  }

  const startedAt = Date.now()
  const useCodeAgent = isCodeAgentCall(tools)

  try {
    let result
    if (!useCodeAgent) {
      // Sin tools de código (ej. el botón "Probar conexión" del admin, o charla casual sin
      // proyecto real detrás): un ping simple, sin tocar el workspace compartido para nada.
      result = await bridgeFetchJob(
        baseURL,
        '/api/antigravity',
        apiKey,
        { instruccion: `${system}\n\n${userMessage}`.slice(0, 4000), modelo: model, accountId: bridgeAccountId },
        signal,
        ENGINE,
      )
    } else {
      const hasDbConnection = tools.some((t) => t.name === 'propose_db_change')
      const canWrite = tools.some((t) => t.name === 'propose_change')

      // El bridge libera "lockToken" cuando el job de /api/antigravity/agent TERMINA (no cuando
      // el POST responde — eso es instantáneo). Si el proceso del bridge se cae antes de eso, el
      // lock queda vivo hasta que expire solo (6 min ahí), no hay forma de liberarlo desde acá.
      const lockToken = await syncWorkspace({ baseURL, apiKey, executeTool, signal, projectId, engineLabel: ENGINE })

      const instruccion = buildCodeAgentInstruccion({ userMessage, history, hasDbConnection, canWrite, system })
      // OJO: siempre "mode: 'tools'", incluso en Modo Plan de FlowPro. El modo "plan" NATIVO de
      // agy no ejecuta ninguna tool (ni de lectura) — dejaría al modelo sin ver un solo archivo
      // real del proyecto. En cambio, con "tools" sí explora el código de verdad; si además no
      // puede escribir (Modo Plan de FlowPro = "canWrite" false), simplemente se descarta
      // cualquier propuesta que igual haga en vez de reenviarla.
      result = await bridgeFetchJob(
        baseURL,
        '/api/antigravity/agent',
        apiKey,
        // verifyClaims desactivado a propósito: dobla la duración del turno cuando hace falta
        // (dos llamadas a agy seguidas). La detección de "unconfirmedChangeClaim" (gratis, sin
        // retry) sigue activa igual, ver más abajo.
        { instruccion, modelo: model, mode: 'tools', lockToken, projectId, accountId: bridgeAccountId },
        signal,
        ENGINE,
      )
      for (const proposal of result.pendingProposals || []) {
        if (canWrite) {
          await executeTool({
            name: 'propose_change',
            input: {
              path: proposal.path,
              new_content: proposal.content,
              // Sin nombrar el motor: el usuario ve "FlowPro" trabajando, no qué IA corre por
              // debajo (Antigravity es un detalle de implementación interno).
              summary: `Cambio en ${proposal.path}`,
            },
          })
        }
        // El archivo real en disco de "agy" no es el repo del proyecto (ya quedó traducido a un
        // propose_change de FlowPro, que sí sigue el flujo de aprobación real, cuando corresponde)
        // — se rechaza en el bridge para que nunca quede como "aplicado" en su propia cola.
        bridgeFetch(baseURL, `/api/proposals/${proposal.id}/reject`, apiKey, {}, signal, ENGINE).catch(() => {})
      }
      for (const dbProposal of result.pendingDbProposals || []) {
        if (hasDbConnection) {
          await executeTool({
            name: 'propose_db_change',
            input: {
              sql: dbProposal.sql,
              summary: dbProposal.summary || 'Cambio en base de datos',
            },
          })
        }
        bridgeFetch(baseURL, `/api/proposals/${dbProposal.id}/reject`, apiKey, {}, signal, ENGINE).catch(() => {})
      }
      // Si el motor llamó a "update_memory" en este turno (ver mcpServer.js del bridge), el
      // bridge ya lo detectó por diff de versión y lo manda acá — se persiste igual que en el
      // camino nativo (agent.js maneja "update_memory" escribiendo directo a projects.ai_memory,
      // sin aprobación, es solo la nota del motor).
      if (result.memoryUpdate) {
        await executeTool({ name: 'update_memory', input: { memory: result.memoryUpdate } })
      }
    }

    logAiUsage({
      accountId,
      provider: 'antigravity',
      model,
      scope,
      ...extractTokens(result.usage),
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })

    // El bridge detecta (y, con verifyClaims, intenta corregir) el caso en que agy da por hecho
    // un cambio de archivo que nunca llegó a proponer de verdad — si sigue sin confirmarse
    // después de eso, mostrar su texto tal cual mentiría sobre lo que pasó realmente.
    const text = result.unconfirmedChangeClaim
      ? 'No pude confirmar que el cambio se haya propuesto de verdad — probá pedirlo de nuevo, con un poco más de detalle si podés.'
      : result.response || ''

    return { text, usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 } }
  } catch (err) {
    if (err.name === 'AbortError' || signal?.aborted) throw err
    logAiUsage({
      accountId,
      provider: 'antigravity',
      model,
      scope,
      statusCode: 500,
      error: err.message,
      latencyMs: Date.now() - startedAt,
    })
    throw err
  }
}
