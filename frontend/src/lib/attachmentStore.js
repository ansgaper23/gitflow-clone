// frontend/src/lib/attachmentStore.js
// Almacén seguro en memoria para transferir adjuntos seleccionados desde el Home/Dashboard
// hacia Chat.jsx al crear un nuevo proyecto, evitando la pérdida de archivos si el historial
// de React Router no los serializa o al recargar.

const pendingAttachmentsStore = new Map()

export function setPendingAttachments(projectId, files) {
  if (!projectId || !files || !Array.isArray(files)) return
  pendingAttachmentsStore.set(String(projectId), files)
}

export function getPendingAttachments(projectId) {
  if (!projectId) return null
  return pendingAttachmentsStore.get(String(projectId)) || null
}

export function clearPendingAttachments(projectId) {
  if (projectId) {
    pendingAttachmentsStore.delete(String(projectId))
  }
}

export default {
  setPendingAttachments,
  getPendingAttachments,
  clearPendingAttachments
}
