import jwt from 'jsonwebtoken'
import { config } from '../config.js'

// El link público (slug.flow-pro.online) no tiene que funcionar para nadie hasta que el
// usuario publique — pero el dueño sí necesita poder verlo en el panel de Vista previa
// mientras edita. La solución: un token firmado que nginx valida (ver auth_request en
// gitflow-preview-subdomains) antes de dejar pasar a un visitante anónimo al dev server; una
// vez que el proyecto se publica, el build estático se sirve directo, sin pasar por acá.
//
// El token es determinístico dentro de cada bucket de tiempo (mismo slug + mismo bucket =
// mismo string) a propósito: si cambiara en cada respuesta de /preview/status (que el editor
// pollea cada 15s), el iframe de la vista previa recargaría solo cada 15s por el simple hecho
// de que cambió el query param, aunque el contenido sea el mismo.
const BUCKET_MS = 30 * 60 * 1000

export function signPreviewToken(slug) {
  const exp = Math.floor((Math.ceil(Date.now() / BUCKET_MS) * BUCKET_MS + BUCKET_MS) / 1000)
  return jwt.sign({ slug, exp }, config.jwtSecret, { noTimestamp: true })
}

export function verifyPreviewToken(slug, token) {
  if (!slug || !token) return false
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    return payload.slug === slug
  } catch {
    return false
  }
}
