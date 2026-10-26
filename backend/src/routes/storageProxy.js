import { Router } from 'express'
import multer from 'multer'
import mime from 'mime-types'
import { getConnectionByToken, verifyAuthToken } from '../services/dbProxy.js'
import { writeStorageFile, storageFileStream, storageFileStat, deleteStorageFile, listStorageFiles } from '../services/flowStorage.js'

// Storage de Flow Cloud (ver flowStorage.js) — mismo "public_token" que el proxy de base de
// datos (routes/dbProxy.js), la app publicada ya lo tiene guardado. Público a propósito para
// LEER (como un bucket público de Supabase Storage, el caso común): cualquiera con el token del
// proyecto puede pedir un archivo por su ruta exacta, sin poder listar ni adivinar qué hay.
// Escribir/borrar SÍ exige una sesión válida (Bearer del login de _flowpro_users).
export const storageProxyRouter = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }) // 50 MB por archivo

function getBearerToken(req) {
  const header = req.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

async function withConnection(req, res, requireAuth, fn) {
  const conn = await getConnectionByToken(req.params.token)
  if (!conn || !conn.vps_database_name) return res.status(404).json({ error: 'Token inválido o base de datos no encontrada' })

  if (requireAuth) {
    const bearer = getBearerToken(req)
    const userId = bearer ? verifyAuthToken(bearer, conn.auth_secret) : null
    if (!userId) return res.status(401).json({ data: null, error: 'Sesión inválida o vencida' })
  }

  try {
    await fn(conn)
  } catch (err) {
    res.status(500).json({ data: null, error: err.message })
  }
}

// Express 5 (path-to-regexp v7) exige nombrar el wildcard ("*path", no "*" a secas) y lo entrega
// como ARRAY de segmentos, no como string — "avatares/2026/foto.png" llega como
// ["avatares", "2026", "foto.png"], hay que unirlo de vuelta.
storageProxyRouter.get('/:token/:bucket/*path', (req, res) =>
  withConnection(req, res, false, async (conn) => {
    const filePath = req.params.path.join('/')
    const stat = storageFileStat(conn.vps_database_name, req.params.bucket, filePath)
    if (!stat) return res.status(404).json({ data: null, error: 'Archivo no encontrado' })
    const stream = storageFileStream(conn.vps_database_name, req.params.bucket, filePath)
    res.setHeader('Content-Type', mime.lookup(filePath) || 'application/octet-stream')
    res.setHeader('Content-Length', stat.size)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    stream.pipe(res)
  }),
)

storageProxyRouter.get('/:token/:bucket', (req, res) =>
  withConnection(req, res, false, async (conn) => {
    const files = await listStorageFiles(conn.vps_database_name, req.params.bucket)
    res.json({ data: files, error: null })
  }),
)

storageProxyRouter.post('/:token/:bucket/*path', upload.single('file'), (req, res) =>
  withConnection(req, res, true, async (conn) => {
    const filePath = req.params.path.join('/')
    // Multipart con campo "file" — mismo formato que el resto de subidas de FlowPro (multer),
    // ver el cliente "storage" del scaffold en scaffold.js.
    if (!req.file?.buffer?.length) {
      return res.status(400).json({ data: null, error: 'Falta el archivo a subir (campo "file")' })
    }
    const result = await writeStorageFile(conn.vps_database_name, req.params.bucket, filePath, req.file.buffer)
    res.status(201).json({ data: result, error: null })
  }),
)

storageProxyRouter.delete('/:token/:bucket/*path', (req, res) =>
  withConnection(req, res, true, async (conn) => {
    const filePath = req.params.path.join('/')
    await deleteStorageFile(conn.vps_database_name, req.params.bucket, filePath)
    res.json({ data: { path: filePath }, error: null })
  }),
)
