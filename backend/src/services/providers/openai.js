import OpenAI from 'openai'
import { logAiUsage } from '../aiUsageLog.js'

const MAX_ROUNDS = 25

export async function converseOpenai({
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
  toolChoice = undefined,
}) {
  const client = new OpenAI({ 
    apiKey, 
    ...(baseURL ? { baseURL } : {}),
    timeout: 240000,
    maxRetries: 2,
  })
  
  const openaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))

  const userContent = []
  if (userMessage) {
    userContent.push({ type: 'text', text: userMessage })
  }
  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}` }
      })
    }
    // Note: PDF logic usually needs to be handled via text extraction or file search API
    // If the backend handles 'document-text' it will be sent as text anyway.
  }

  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent.length > 0 ? userContent : userMessage },
  ]

  let finalText = '';
  let totalUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

  const DB_TOOL_NAMES = new Set(['execute_ddl', 'propose_migration', 'read_table_rows', 'list_tables', 'execute_query'])
  let dbBonusRounds = 0
  const MAX_DB_BONUS = 10

  for (let round = 0; round < MAX_ROUNDS + dbBonusRounds; round++) {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')

    // Purga Efímera de image_url de rondas anteriores (< round)
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      if (Array.isArray(msg?.content)) {
        msg.content = msg.content.map((block) => {
          if (block && block.type === 'image_url') {
            return { type: 'text', text: '[Imagen visualizada y procesada en ronda anterior de este turno]' };
          }
          return block;
        });
      }
    }

    const startedAt = Date.now()
    let response
    try {
      response = await client.chat.completions.create({ 
        model, 
        messages, 
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        ...((round === 0 && toolChoice) ? { tool_choice: toolChoice.type === 'any' ? 'required' : (toolChoice.type === 'tool' ? { type: 'function', function: { name: toolChoice.name } } : toolChoice) } : {}),
      }, { signal })
    } catch (err) {
      logAiUsage({
        accountId,
        provider: 'openai',
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
      provider: 'openai',
      model,
      scope,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })
    totalUsage.inputTokens += (response.usage?.prompt_tokens || 0);
    totalUsage.outputTokens += (response.usage?.completion_tokens || 0);
    totalUsage.latencyMs += (Date.now() - startedAt);

    const choice = response.choices[0]
    const message = choice.message
    finalText = message.content?.trim() || finalText

    const toolCalls = message.tool_calls || []
    if (toolCalls.length === 0) break

    // Presupuesto independiente: herramientas de base de datos no agotan pasos de React
    if (toolCalls.some((t) => DB_TOOL_NAMES.has(t.function?.name)) && dbBonusRounds < MAX_DB_BONUS) {
      dbBonusRounds++;
    }

    messages.push(message)

    // ── HERRAMIENTAS PARALELAS VS MUTACIONES SERIALIZADAS POR ARCHIVO ──
    const FILE_MUTATION_TOOLS = new Set(['propose_patch', 'replace_file_content', 'propose_change'])
    const isFileMutation = (name) => FILE_MUTATION_TOOLS.has(name)
    const getTargetFilePath = (input) => input?.file_path || input?.path || 'unknown'

    const parsedCalls = toolCalls.map((call) => {
      let input = {}
      try {
        input = JSON.parse(call.function.arguments || '{}')
      } catch {
        input = {}
      }
      return { call, input, name: call.function.name, id: call.id }
    })

    const resultMap = new Map()

    const executeOne = async (item) => {
      if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
      const result = await executeTool({ name: item.name, input: item.input })
      return result
    }

    const readAndOther = parsedCalls.filter((c) => !isFileMutation(c.name))
    const fileMutations = parsedCalls.filter((c) => isFileMutation(c.name))

    // 1. Ejecutar herramientas de lectura / informativas en paralelo
    await Promise.allSettled(
      readAndOther.map(async (item) => {
        try {
          const result = await executeOne(item)
          resultMap.set(item.id, { status: 'fulfilled', item, result })
        } catch (error) {
          error.toolUseId = item.id
          error.toolName = item.name
          resultMap.set(item.id, { status: 'rejected', item, error })
        }
      })
    )

    // 2. Agrupar herramientas de mutación por file_path y ejecutarlas secuencialmente
    const mutationsByFile = new Map()
    for (const item of fileMutations) {
      const filePath = getTargetFilePath(item.input)
      if (!mutationsByFile.has(filePath)) {
        mutationsByFile.set(filePath, [])
      }
      mutationsByFile.get(filePath).push(item)
    }

    await Promise.all(
      Array.from(mutationsByFile.values()).map(async (fileQueue) => {
        for (const item of fileQueue) {
          try {
            const result = await executeOne(item)
            if (typeof result === 'string' && result.startsWith('Conflicto de parche secuencial')) {
              resultMap.set(item.id, {
                status: 'rejected',
                item,
                error: { toolUseId: item.id, toolName: item.name, message: result },
              })
            } else {
              resultMap.set(item.id, { status: 'fulfilled', item, result })
            }
          } catch (error) {
            error.toolUseId = item.id
            error.toolName = item.name
            resultMap.set(item.id, { status: 'rejected', item, error })
          }
        }
      })
    )

    // 3. Reensamblar en el orden original
    const directImageUrls = []
    for (const item of parsedCalls) {
      const res = resultMap.get(item.id)
      if (res && res.status === 'fulfilled') {
        const raw = res.result
        const contentStr = (typeof raw === 'object' && raw !== null && raw.output !== undefined)
          ? (typeof raw.output === 'string' ? raw.output : JSON.stringify(raw.output))
          : (typeof raw === 'string' ? raw : JSON.stringify(raw))
        messages.push({
          role: 'tool',
          tool_call_id: item.id,
          content: contentStr,
        })

        // Extraer bloques de imagen multimodal para OpenAI vision
        if (Array.isArray(raw?.multimodalBlocks)) {
          for (const block of raw.multimodalBlocks) {
            if (block.type === 'image' && block.source?.data) {
              const mime = block.source.media_type || 'image/jpeg'
              directImageUrls.push({
                type: 'image_url',
                image_url: {
                  url: `data:${mime};base64,${block.source.data}`,
                },
              })
            }
          }
        }
      } else {
        const err = res?.error
        messages.push({
          role: 'tool',
          tool_call_id: item.id,
          content: `Error ejecutando ${err?.toolName || item.name}: ${err?.message || String(err)}`,
        })
      }
    }

    // Inyectar imágenes resultantes como mensaje de usuario posterior inmediato (estándar OpenAI Vision)
    if (directImageUrls.length > 0) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: '[Visualización directa de imágenes inspeccionadas/recortadas]:' },
          ...directImageUrls,
        ],
      })
    }

    const hasTerminatingTool = parsedCalls.some(c => 
      c.name === 'ask_question' || 
      c.name === 'ask_questions' || 
      c.name === 'propose_tasks' || 
      c.name === 'roadmap--propose_tasks' ||
      c.name === 'message_user' ||
      c.name === 'user_messaging--message_user'
    );
    if (choice.finish_reason !== 'tool_calls' || hasTerminatingTool) break
  }

  return { text: finalText, usage: totalUsage }
}

export async function generateOpenaiImage({ apiKey, baseURL, model, prompt }) {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const response = await client.images.generate({
    model: model || 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    response_format: 'b64_json'
  });
  const b64 = response.data[0].b64_json;
  if (!b64) throw new Error('No se devolvió la imagen codificada en base64.');
  return { mimeType: 'image/png', base64: b64 };
}
