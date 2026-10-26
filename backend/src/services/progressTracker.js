// Registro en memoria de las acciones que el agente va haciendo en el turno actual
// (leer archivo, editar, listar, etc.), por conversación. El frontend hace polling
// mientras espera respuesta para mostrar la lista en vivo (estilo Lovable). Al terminar
// el turno, la lista final se persiste en el mensaje del asistente (columna `actions`)
// y este tracker se limpia — es puramente transitorio para la espera.
const progress = new Map() // conversationId -> { steps: [{type, path?, bucket?}], updatedAt }

export function resetProgress(conversationId) {
  progress.set(conversationId, { steps: [], updatedAt: Date.now() })
}

export function addStep(conversationId, step) {
  const entry = progress.get(conversationId) || { steps: [], updatedAt: Date.now() }
  entry.steps.push(step)
  entry.updatedAt = Date.now()
  progress.set(conversationId, entry)
}

export function getProgress(conversationId) {
  return progress.get(conversationId) || null
}

export function clearProgress(conversationId) {
  progress.delete(conversationId)
}
