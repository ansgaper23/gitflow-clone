import { logAiUsage } from '../aiUsageLog.js'
import { isCodeAgentCall, bridgeFetch, bridgeFetchJob, buildCodeAgentInstruccion, syncWorkspace, extractTokens } from './bridgeClient.js'

// Segundo motor del mismo antigravity-bridge (ver providers/antigravity.js para el porqué del
// bridge en general): esta vez envuelve la CLI real de Claude Code ("claude"), no la Anthropic
// Messages API — por eso es un proveedor aparte de "anthropic" aunque comparta compañía. Mismo
// contrato que el resto (system, tools, history, userMessage, executeTool → {text}) y misma
// mecánica de sincronizar el proyecto contra el bridge + traducir sus propuestas a un
// "propose_change" real de FlowPro.
//
// A diferencia de Antigravity, el bridge arranca "claude" con "--tools ''" (desactiva TODAS sus
// herramientas nativas de archivo) más "--allowedTools" nombrando solo las tools MCP puntuales
// (list_files/read_file/propose_change) — no hay "--dangerously-skip-permissions" de por medio en
// modo "tools". Eso cierra el hueco que sí tiene Antigravity (a veces escribía directo en su
// copia de trabajo sin pasar por su propia cola): acá, si el modelo no llama a la tool MCP
// exacta, no tiene con qué escribir un archivo, punto.
//
// Misma limitación real que Antigravity, a propósito: solo propone cambios de ARCHIVOS. No sabe
// crear tablas, ni desplegar Edge Functions, ni generar imágenes, ni testear la preview.

const ENGINE = 'Claude Code'

export async function converseClaudeCode({
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
  projectId,
  scope = 'agent',
  toolChoice = undefined,
}) {
  if (!baseURL) {
    throw new Error('A la cuenta de Claude Code le falta la Base URL del bridge.')
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
        '/api/claude',
        apiKey,
        { instruccion: `${system}\n\n${userMessage}`.slice(0, 4000), modelo: model },
        signal,
        ENGINE,
      )
    } else {
      const hasDbConnection = tools.some((t) => t.name === 'propose_db_change')
      const canWrite = tools.some((t) => t.name === 'propose_change')

      const lockToken = await syncWorkspace({ baseURL, apiKey, executeTool, signal, projectId, engineLabel: ENGINE })

      const instruccion = buildCodeAgentInstruccion({ userMessage, history, hasDbConnection, canWrite, system })
      // Siempre "mode: 'tools'": el bridge decide con eso qué tools MCP habilitar
      // (list_files/read_file siempre, propose_change solo si canWrite) — nunca usa el
      // --permission-mode "plan" nativo de Claude Code, que no sirve para un turno headless.
      result = await bridgeFetchJob(
        baseURL,
        '/api/claude/agent',
        apiKey,
        { instruccion, modelo: model, mode: 'tools', lockToken, projectId },
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
              // debajo (Claude Code es un detalle de implementación interno).
              summary: `Cambio en ${proposal.path}`,
            },
          })
        }
        // El archivo real en disco de "claude" no es el repo del proyecto (ya quedó traducido a
        // un propose_change de FlowPro, que sí sigue el flujo de aprobación real, cuando
        // corresponde) — se rechaza en el bridge para que no quede como "aplicado" en su cola.
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
      provider: 'claudecode',
      model,
      scope,
      ...extractTokens(result.usage),
      costUsd: result.cost_usd ?? undefined,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })

    // Mismo hallazgo que con Antigravity (el modelo a veces da por hecho un cambio que no
    // propuso): el bridge lo detecta igual acá — si sigue sin confirmarse, mostrar el texto tal
    // cual mentiría sobre lo que pasó realmente.
    const text = result.unconfirmedChangeClaim
      ? 'No pude confirmar que el cambio se haya propuesto de verdad — probá pedirlo de nuevo, con un poco más de detalle si podés.'
      : result.response || ''

    return { text, usage: { inputTokens: 0, outputTokens: 0, latencyMs: 0 } }
  } catch (err) {
    if (err.name === 'AbortError' || signal?.aborted) throw err
    logAiUsage({
      accountId,
      provider: 'claudecode',
      model,
      scope,
      statusCode: 500,
      error: err.message,
      latencyMs: Date.now() - startedAt,
    })
    throw err
  }
}
