import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

// "Storage" de Flow Cloud: no existe ningún equivalente a Supabase Storage para la base
// automática del VPS — este es el primer servicio de archivos que tiene. Guarda todo en disco,
// un directorio por base (usa "vps_database_name", el mismo identificador único que ya usa
// vpsPostgres.js para la base de Postgres de ese proyecto — no hace falta una columna nueva).
// Deliberadamente simple para v1: TODO bucket es público de lectura (sin buckets privados/URLs
// firmadas todavía) — cubre el caso común (imágenes/archivos que la app muestra directo), que es
// el mismo que ya asumía "storage.objects" público en la mayoría de los proyectos migrados.
const STORAGE_ROOT = process.env.FLOW_STORAGE_DIR || '/opt/gitflow-storage'

// Nombre de bucket/base válido sin comillar (mismo criterio que el resto del proyecto para
// identificadores) — el "path" de un archivo es más permisivo (subcarpetas), pero nunca puede
// escaparse del bucket ("..", absoluto, etc.) hacia otra parte del disco.
const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/

function assertSafeName(name, label) {
  if (!SAFE_NAME_RE.test(name)) throw new Error(`${label} inválido: "${name}"`)
}

// Normaliza y valida un path de archivo dentro de un bucket — rechaza cualquier intento de
// escapar el directorio del bucket (path traversal) antes de tocar el filesystem.
function safeFilePath(databaseName, bucket, filePath) {
  assertSafeName(databaseName, 'Nombre de base')
  assertSafeName(bucket, 'Nombre de bucket')
  const cleaned = String(filePath || '').replace(/^\/+/, '')
  if (!cleaned || cleaned.includes('\0')) throw new Error('Ruta de archivo inválida')
  const bucketDir = path.join(STORAGE_ROOT, databaseName, bucket)
  const fullPath = path.join(bucketDir, cleaned)
  if (!fullPath.startsWith(bucketDir + path.sep) && fullPath !== bucketDir) {
    throw new Error('Ruta de archivo inválida (fuera del bucket)')
  }
  return fullPath
}

export async function writeStorageFile(databaseName, bucket, filePath, buffer) {
  const fullPath = safeFilePath(databaseName, bucket, filePath)
  await fsp.mkdir(path.dirname(fullPath), { recursive: true })
  await fsp.writeFile(fullPath, buffer)
  const stat = await fsp.stat(fullPath)
  return { path: filePath, sizeBytes: stat.size }
}

export function storageFileStream(databaseName, bucket, filePath) {
  const fullPath = safeFilePath(databaseName, bucket, filePath)
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null
  return fs.createReadStream(fullPath)
}

export function storageFileStat(databaseName, bucket, filePath) {
  const fullPath = safeFilePath(databaseName, bucket, filePath)
  if (!fs.existsSync(fullPath)) return null
  const stat = fs.statSync(fullPath)
  return stat.isFile() ? stat : null
}

export async function deleteStorageFile(databaseName, bucket, filePath) {
  const fullPath = safeFilePath(databaseName, bucket, filePath)
  await fsp.rm(fullPath, { force: true })
}

// Lista archivos de un bucket (recursivo) — devuelve paths relativos al bucket, estilo
// "supabase.storage.from(bucket).list()" pero siempre recursivo (más simple, alcanza para lo
// que necesita un import/listado; no pagina).
export async function listStorageFiles(databaseName, bucket) {
  assertSafeName(databaseName, 'Nombre de base')
  assertSafeName(bucket, 'Nombre de bucket')
  const bucketDir = path.join(STORAGE_ROOT, databaseName, bucket)
  const results = []
  async function walk(dir, prefix) {
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel)
      } else {
        const stat = await fsp.stat(path.join(dir, entry.name))
        results.push({ path: rel, sizeBytes: stat.size, updatedAt: stat.mtime.toISOString() })
      }
    }
  }
  await walk(bucketDir, '')
  return results
}

// Borra TODOS los archivos de una base (todos sus buckets) — usado cuando se borra la conexión
// de Flow Cloud del proyecto, igual que dropVpsDatabase para la base de Postgres.
export async function dropAllStorage(databaseName) {
  if (!databaseName) return
  assertSafeName(databaseName, 'Nombre de base')
  await fsp.rm(path.join(STORAGE_ROOT, databaseName), { recursive: true, force: true })
}
