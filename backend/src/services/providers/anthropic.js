import Anthropic from '@anthropic-ai/sdk'
import { logAiUsage } from '../aiUsageLog.js'

// 5 se quedaba corto para diagnósticos reales: explorar + leer 2-3 archivos + revisar errores +
// probar en la vista previa ya son 6-7 llamadas, y el agente se cortaba a mitad de camino
// prometiendo un paso que nunca llegaba a ejecutar en el mismo turno.
const MAX_ROUNDS = 15

// Interfaz común a todos los proveedores: recibe herramientas en formato
// {name, description, input_schema} y un callback executeTool({name, input})
// que las ejecuta contra el repositorio. Devuelve { text }.
export async function converseAnthropic({
  apiKey,
  baseURL,
  model,
  system,
  tools,
  history,
  userMessage,
  executeTool,
  signal,
  attachments = [],
  accountId,
  scope = 'agent',
  schemaTables = [],
}) {
  const anthropic = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })
  const anthropicTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  const userContent = [{ type: 'text', text: userMessage }]
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      userContent.unshift({
        type: 'image',
        source: { type: 'base64', media_type: attachment.mimeType, data: attachment.base64 },
      })
    } else if (attachment.kind === 'pdf') {
      userContent.unshift({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: attachment.base64 },
      })
    }
  }

  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: attachments.length > 0 ? userContent : userMessage },
  ]

  let finalText = '';
  let totalUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  let truncationRetries = 0;
  const MAX_TRUNCATION_RETRIES = 3;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')

    const startedAt = Date.now()
    let response
    try {
      response = await anthropic.messages.create(
        {
          model,
          max_tokens: 8192,
          system,
          tools: anthropicTools,
          messages,
        },
        { signal },
      )
      console.log("ANTHROPIC RAW RESPONSE stop_reason:", response.stop_reason, "content_blocks:", response.content.length, "output_tokens:", response.usage?.output_tokens);
    } catch (err) {
      logAiUsage({
        accountId,
        provider: 'anthropic',
        model,
        scope,
        statusCode: err.status || 500,
        error: err.message,
        latencyMs: Date.now() - startedAt,
      })
      throw err
    }
    logAiUsage({
      accountId,
      provider: 'anthropic',
      model,
      scope,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      statusCode: 200,
      error: response.stop_reason === 'max_tokens' ? 'MAX TOKENS ALCANZADO - AUTO-RECOVERY ACTIVADO' : null,
      latencyMs: Date.now() - startedAt,
    })
    totalUsage.inputTokens += (response.usage?.input_tokens || 0);
    totalUsage.outputTokens += (response.usage?.output_tokens || 0);
    totalUsage.latencyMs += (Date.now() - startedAt);

    const toolUses = response.content.filter((block) => block.type === 'tool_use')
    const textBlocks = response.content.filter((block) => block.type === 'text')
    finalText = textBlocks.map((b) => b.text).join('\n').trim() || finalText

    // ── AUTO-RECOVERY: cuando el proxy corta la respuesta a mitad de una herramienta ──
    // Google Gemini devuelve content: [] cuando trunca un FunctionCall a medio generar.
    // En vez de rendirnos (como hacíamos antes), inyectamos un mensaje de continuación
    // y dejamos que el modelo reintente con instrucciones de usar bloques más pequeños.
    // Esto es exactamente lo que hacen Lovable, Claude Artifacts y ChatGPT internamente.
    if (response.stop_reason === 'max_tokens' && toolUses.length === 0 && textBlocks.length === 0) {
      truncationRetries++;
      if (truncationRetries > MAX_TRUNCATION_RETRIES) {
        console.log("MAX TRUNCATION RETRIES alcanzado, abortando.");
        totalUsage.finish_reason = 'length';
        break;
      }
      console.log(`AUTO-RECOVERY: truncamiento detectado (intento ${truncationRetries}/${MAX_TRUNCATION_RETRIES}). Reinyectando con instrucciones de chunking.`);
      // Inyectamos un par assistant/user para que el modelo entienda qué pasó
      messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Se cortó mi respuesta anterior por el límite de tokens.' }] })
      messages.push({ role: 'user', content: `[SISTEMA] Tu respuesta anterior fue CORTADA por el límite de tokens del servidor. La herramienta que intentaste usar NO se ejecutó. DEBES cambiar tu estrategia:
1. NO uses "propose_change" para crear archivos grandes. Crea archivos de MÁXIMO 80 líneas.
2. Si necesitas crear algo complejo, divídelo en MÚLTIPLES archivos pequeños (ej. Header.jsx, PlantillaCard.jsx, PlantillasPage.jsx por separado).
3. Usa "propose_patch" para editar archivos existentes (solo envía el fragmento que cambia, no el archivo completo).
4. Haz UN SOLO cambio pequeño ahora, y en las siguientes rondas haces los demás.
Continúa con el pedido original del usuario pero con esta estrategia de bloques pequeños.` })
      continue; // NO break — dejamos que el bucle reintente
    }

    if (toolUses.length === 0) break

    messages.push({ role: 'assistant', content: response.content })

    const toolExecutions = await Promise.allSettled(
      toolUses.map(async (toolUse) => {
        try {
          if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')

          // --- DB GUARDRAIL ---
          if (toolUse.name === 'propose_change') {
            const code = toolUse.input.new_content || ''
            const match = code.match(/(?:supabase|db)\.from\(['"]([^'"]+)['"]\)/)
            if (match) {
              const tableName = match[1]
              const tableExists = schemaTables.some(t => typeof t === 'string' && t.includes(tableName))
              const hasMigration = toolUses.some(t => t.name === 'propose_migration')
              
              if (!tableExists && !hasMigration) {
                 throw new Error(`FATAL ERROR: Estás intentando consultar/insertar en la tabla "${tableName}" (db.from('${tableName}')), pero NO EXISTE en la base de datos actual y NO has llamado a propose_migration en este turno para crearla. DEBES emitir el DDL CREATE TABLE usando propose_migration ANTES de programar el frontend.`)
              }
            }
          }
          // --- END GUARDRAIL ---

          const result = await executeTool({ name: toolUse.name, input: toolUse.input })
          return { toolUse, result }
        } catch (error) {
          error.toolUseId = toolUse.id
          error.toolName = toolUse.name
          throw error
        }
      })
    )

    const toolResults = []
    for (const res of toolExecutions) {
      if (res.status === 'fulfilled') {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: res.value.toolUse.id,
          content: typeof res.value.result === 'string' ? res.value.result : JSON.stringify(res.value.result),
        })
      } else {
        // Manejo defensivo: Informar el error al LLM sin tumbar el turno
        toolResults.push({
          type: 'tool_result',
          tool_use_id: res.reason?.toolUseId,
          content: `Error ejecutando ${res.reason?.toolName || 'herramienta'}: ${res.reason?.message || String(res.reason)}`,
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: toolResults })

    if (response.stop_reason !== 'tool_use') {
      if (response.stop_reason === 'max_tokens') totalUsage.finish_reason = 'length'
      break
    }
  }

  return { text: finalText, usage: totalUsage }
}
