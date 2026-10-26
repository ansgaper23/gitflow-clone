import Anthropic from '@anthropic-ai/sdk'

import { logAiUsage } from '../aiUsageLog.js'



// 5 se quedaba corto para diagnósticos reales: explorar + leer 2-3 archivos + revisar errores +

// probar en la vista previa ya son 6-7 llamadas, y el agente se cortaba a mitad de camino

// prometiendo un paso que nunca llegaba a ejecutar en el mismo turno.

const MAX_ROUNDS = 25



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

  schemaDetails = {},
  toolChoice = undefined,
}) {

  const anthropic = new Anthropic({

    apiKey,

    ...(baseURL ? { baseURL } : {}),

    timeout: 240000,

    maxRetries: 2,

  })

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
  let hadInteractiveCard = false;

  let totalUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

  let truncationRetries = 0;

  const MAX_TRUNCATION_RETRIES = 3;



  const DB_TOOL_NAMES = new Set(['execute_ddl', 'propose_migration', 'read_table_rows', 'list_tables', 'execute_query'])

  let dbBonusRounds = 0

  const MAX_DB_BONUS = 10



  for (let round = 0; round < MAX_ROUNDS + dbBonusRounds; round++) {

    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')



    // Purga Efímera de imágenes Base64 de rondas anteriores (< round)
    // Permite al LLM ver la imagen en la ronda que la solicitó, pero no re-transmite MBs de Base64 en rondas sucesivas
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      if (Array.isArray(msg?.content)) {
        msg.content = msg.content.map((block) => {
          if (block && block.type === 'image' && block.source?.type === 'base64') {
            return { type: 'text', text: '[Imagen visualizada y procesada en ronda anterior de este turno]' };
          }
          return block;
        });
      }
    }

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

          ...((round === 0 && toolChoice) ? { tool_choice: toolChoice } : (toolChoice?.type === 'auto' ? { tool_choice: toolChoice } : {})),

        },

        { signal, timeout: 240000 },

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

    const hasInteractiveCard = toolUses.some(t => 
      t.name === 'ask_question' || 
      t.name === 'ask_questions' || 
      t.name === 'propose_tasks' || 
      t.name === 'roadmap--propose_tasks' ||
      t.name === 'message_user' ||
      t.name === 'user_messaging--message_user'
    );
    if (hasInteractiveCard) {
      hadInteractiveCard = true;
    }



    // Presupuesto independiente: herramientas de base de datos no agotan pasos de React

    if (toolUses.some((t) => DB_TOOL_NAMES.has(t.name)) && dbBonusRounds < MAX_DB_BONUS) {

      dbBonusRounds++;

    }



    messages.push({ role: 'assistant', content: response.content })



    // ── HERRAMIENTAS PARALELAS VS MUTACIONES SERIALIZADAS POR ARCHIVO ──

    const FILE_MUTATION_TOOLS = new Set(['propose_patch', 'replace_file_content', 'propose_change'])

    const isFileMutation = (t) => FILE_MUTATION_TOOLS.has(t.name)

    const getTargetFilePath = (t) => t.input?.file_path || t.input?.path || 'unknown'



    const resultMap = new Map()



    const executeWithGuardrail = async (toolUse) => {

      if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')



      // --- DB GUARDRAIL ---

      if (toolUse.name === 'propose_change') {

        const code = toolUse.input?.new_content || ''

        const fromRegex = /(?:supabase|db)\.from\(['"]([^'"]+)['"]\)([\s\S]*?)(?:;|$)/g

        let match

        while ((match = fromRegex.exec(code)) !== null) {

          const tableName = match[1]

          const chain = match[2]

          const hasMigration = toolUses.some((t) => t.name === 'propose_migration' || t.name === 'propose_db_change')

          const tableExists = !!schemaDetails[tableName]



          if (!tableExists && !hasMigration) {

            throw new Error(`FATAL ERROR: Estás intentando consultar/insertar en la tabla "${tableName}" (db.from('${tableName}')), pero NO EXISTE en la base de datos actual y NO has llamado a propose_migration en este turno para crearla. DEBES emitir el DDL CREATE TABLE usando propose_migration ANTES de programar el frontend.`)

          }



          if (tableExists) {

            const colsInDb = schemaDetails[tableName] || []

            const insertRegex = /\.insert\(\s*(?:\[\s*)?\{\s*([^}]+)\s*\}\s*(?:\]\s*)?\)/

            const insertMatch = chain.match(insertRegex)

            if (insertMatch) {

              const keysPart = insertMatch[1]

              const keyRegex = /([a-zA-Z0-9_]+)\s*:/g

              let kMatch

              while ((kMatch = keyRegex.exec(keysPart)) !== null) {

                const col = kMatch[1]

                if (!colsInDb.includes(col) && !hasMigration) {

                  throw new Error(`ERROR DE CONTRATO: La columna '${col}' no existe en la tabla '${tableName}'. Debes emitir propose_migration con ALTER TABLE ${tableName} ADD COLUMN ${col} [tipo]; antes de usarla en el frontend.`)

                }

              }

            }



            const eqRegex = /\.eq\(\s*['"]([^'"]+)['"]/g

            let eqMatch

            while ((eqMatch = eqRegex.exec(chain)) !== null) {

              const col = eqMatch[1]

              if (!colsInDb.includes(col) && !hasMigration) {

                throw new Error(`ERROR DE CONTRATO: La columna '${col}' no existe en la tabla '${tableName}'. Debes emitir propose_migration con ALTER TABLE ${tableName} ADD COLUMN ${col} [tipo]; antes de usarla en el frontend.`)

              }

            }

          }

        }

      }

      // --- END GUARDRAIL ---



      const result = await executeTool({ name: toolUse.name, input: toolUse.input })

      return result

    }



    // 1. Ejecutar herramientas de lectura / informativas en paralelo con Promise.allSettled

    const readAndOtherTools = toolUses.filter((t) => !isFileMutation(t))

    const fileMutationTools = toolUses.filter((t) => isFileMutation(t))



    await Promise.allSettled(

      readAndOtherTools.map(async (toolUse) => {

        try {

          const result = await executeWithGuardrail(toolUse)

          resultMap.set(toolUse.id, { status: 'fulfilled', toolUse, result })

        } catch (error) {

          error.toolUseId = toolUse.id

          error.toolName = toolUse.name

          resultMap.set(toolUse.id, { status: 'rejected', toolUse, error })

        }

      })

    )



    // 2. Agrupar herramientas de mutación por file_path y ejecutar cada grupo SECUENCIALMENTE

    const mutationsByFile = new Map()

    for (const toolUse of fileMutationTools) {

      const filePath = getTargetFilePath(toolUse)

      if (!mutationsByFile.has(filePath)) {

        mutationsByFile.set(filePath, [])

      }

      mutationsByFile.get(filePath).push(toolUse)

    }



    await Promise.all(

      Array.from(mutationsByFile.values()).map(async (fileQueue) => {

        for (const toolUse of fileQueue) {

          try {

            const result = await executeWithGuardrail(toolUse)

            if (typeof result === 'string' && result.startsWith('Conflicto de parche secuencial')) {

              resultMap.set(toolUse.id, {

                status: 'rejected',

                toolUse,

                error: { toolUseId: toolUse.id, toolName: toolUse.name, message: result },

              })

            } else {

              resultMap.set(toolUse.id, { status: 'fulfilled', toolUse, result })

            }

          } catch (error) {

            error.toolUseId = toolUse.id

            error.toolName = toolUse.name

            resultMap.set(toolUse.id, { status: 'rejected', toolUse, error })

          }

        }

      })

    )



    // 3. Reensamblar resultados en el orden EXACTO original de toolUses

    const toolResults = []

    const directImageBlocks = []

    for (const toolUse of toolUses) {

      const res = resultMap.get(toolUse.id)

      if (res && res.status === 'fulfilled') {

        const raw = res.result

        let contentPayload

        if (Array.isArray(raw?.multimodalBlocks)) {

          // Extraer bloques de imagen para inyección directa en el mensaje 'user'

          const textBlocks = []

          for (const block of raw.multimodalBlocks) {

            if (block.type === 'image' && block.source?.data) {

              directImageBlocks.push({

                type: 'image',

                source: {

                  type: 'base64',

                  media_type: block.source.media_type || 'image/jpeg',

                  data: block.source.data,

                },

              })

            } else if (block.type === 'text' && block.text) {

              textBlocks.push(block.text)

            }

          }

          contentPayload = textBlocks.length > 0 ? textBlocks.join('\n') : (typeof raw.output === 'string' ? raw.output : JSON.stringify(raw.output || raw))

        } else if (Array.isArray(raw?.content)) {

          contentPayload = raw.content

        } else {

          contentPayload = (typeof raw === 'object' && raw !== null && raw.output !== undefined)

            ? (typeof raw.output === 'string' ? raw.output : JSON.stringify(raw.output))

            : (typeof raw === 'string' ? raw : JSON.stringify(raw))

        }

        const isErr = Boolean(raw && (raw.is_error === true || raw.ok === false))

        toolResults.push({

          type: 'tool_result',

          tool_use_id: toolUse.id,

          content: contentPayload,

          ...(isErr ? { is_error: true } : {})

        })

      } else {

        const err = res?.error

        toolResults.push({

          type: 'tool_result',

          tool_use_id: toolUse.id,

          content: `Error ejecutando ${err?.toolName || toolUse.name}: ${err?.message || String(err)}`,

          is_error: true,

        })

      }

    }

    // Inyectar tool_result(s) junto con las imágenes directas en el mensaje 'user'

    // De esta forma, el bridge de Antigravity (agy.flow-pro.online) y la API nativa de Anthropic

    // reciben las imágenes como bloques directos sin descartarlas ni fallar por anidamiento.

    messages.push({ role: 'user', content: [...toolResults, ...directImageBlocks] })



    if (response.stop_reason !== 'tool_use' || hasInteractiveCard) {

        if (response.stop_reason === 'max_tokens') totalUsage.finish_reason = 'length'

        break

      }

  }

  // Si se agotaron las rondas pero el último paso fue tool_use (finalText vacío),
  // ejecutamos 1 llamada de cierre sin tools para garantizar texto explicativo al usuario
  // (EXCEPTO si fue una tarjeta interactiva, donde la tarjeta ya contiene todo y no debe generarse un muro de texto).
  if (!hadInteractiveCard && !finalText && messages.length > 0 && messages[messages.length - 1].role === 'user') {
    try {
      const closingResp = await anthropic.messages.create({
        model: MODEL,
        system,
        messages,
        max_tokens: 1500,
      })
      const closingText = (closingResp.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (closingText) finalText = closingText
    } catch (_) {}
  }

  return { text: finalText, usage: totalUsage }

}

