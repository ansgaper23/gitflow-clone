import AdmZip from 'adm-zip'
import { writeStorageFile } from './flowStorage.js'
import { createBucketIfMissing, uploadToStorage } from './supabaseStorage.js'

// El export tipo "Flow Migrador PRO" (ver lovableBackupImporter.js) deja, junto al manifiesto
// ("storage_manifest.json"/"storage_urls.csv"/"storage_urls.txt", metadata pura), los archivos
// REALES ya descargados bajo "storage/<bucket>/<archivo>" — se usan esos directo, no hace falta
// volver a bajarlos de sus URLs originales (que además podrían haber vencido).
const METADATA_FILENAMES = new Set(['storage_manifest.json', 'storage_urls.csv', 'storage_urls.txt'])

// [{ bucket, path, buffer }] por cada archivo real bajo "storage/<bucket>/<path>" del zip.
export function extractStorageFiles(zipBuffer) {
  const zip = new AdmZip(zipBuffer)
  const files = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const match = /^storage\/([^/]+)\/(.+)$/.exec(entry.entryName)
    if (!match) continue
    const [, bucket, filePath] = match
    if (METADATA_FILENAMES.has(filePath)) continue
    files.push({ bucket, path: filePath, buffer: entry.getData() })
  }
  return files
}

// Total declarado en el manifiesto (si vino) — para poder avisar "se esperaban N, se encontraron
// M" en vez de asumir en silencio que lo que hay en el zip es todo lo que existía.
export function declaredStorageFileCount(zipBuffer) {
  try {
    const zip = new AdmZip(zipBuffer)
    const entry = zip.getEntry('storage/storage_manifest.json')
    if (!entry) return null
    const manifest = JSON.parse(entry.getData().toString('utf-8'))
    return typeof manifest.total_files === 'number' ? manifest.total_files : null
  } catch {
    return null
  }
}

// "bucket/path" -> mimetype real (el manifiesto lo trae por archivo; el archivo físico del zip
// no lleva esa metadata en sí mismo) — mejor esfuerzo, si no está el manifiesto o no encuentra
// la entrada cae a un genérico en el caller, nunca tira.
function readStorageMimeTypes(zipBuffer) {
  try {
    const zip = new AdmZip(zipBuffer)
    const entry = zip.getEntry('storage/storage_manifest.json')
    if (!entry) return new Map()
    const manifest = JSON.parse(entry.getData().toString('utf-8'))
    const map = new Map()
    for (const f of manifest.files || []) {
      if (f.bucket && f.path && f.mimetype) map.set(`${f.bucket}/${f.path}`, f.mimetype)
    }
    return map
  } catch {
    return new Map()
  }
}

// Importa todos los archivos reales encontrados en el zip a Flow Cloud (ver flowStorage.js) —
// nunca tira a mitad de camino: un archivo que falla no frena a los demás, queda contado aparte.
export async function importStorageFiles(databaseName, zipBuffer) {
  const files = extractStorageFiles(zipBuffer)
  const byBucket = new Map()
  let totalBytes = 0
  let failedCount = 0

  for (const f of files) {
    const entry = byBucket.get(f.bucket) || { ok: 0, failed: 0, bytes: 0 }
    try {
      await writeStorageFile(databaseName, f.bucket, f.path, f.buffer)
      entry.ok++
      entry.bytes += f.buffer.length
      totalBytes += f.buffer.length
    } catch (err) {
      entry.failed++
      failedCount++
    }
    byBucket.set(f.bucket, entry)
  }

  return {
    totalFiles: files.length,
    failedCount,
    totalBytes,
    buckets: [...byBucket.entries()].map(([bucket, v]) => ({ bucket, ...v })),
  }
}

// Mismo resultado que importStorageFiles (mismo shape, reusa el mismo formateador de nota en
// dbImport.js) pero para un destino Supabase real (oauth) en vez de Flow Cloud: crea el bucket
// si hace falta y sube cada archivo con la service_role key del proyecto conectado (necesaria
// para saltar RLS al escribir). Antes esto solo estaba resuelto para Flow Cloud — un backup de
// Flow Migrador PRO conectado a un Supabase real perdía los archivos de Storage en silencio.
export async function importStorageFilesToSupabase(projectRef, serviceRoleKey, zipBuffer) {
  const files = extractStorageFiles(zipBuffer)
  const mimeTypes = readStorageMimeTypes(zipBuffer)
  const byBucket = new Map()
  let totalBytes = 0
  let failedCount = 0
  const bucketsEnsured = new Set()

  for (const f of files) {
    const entry = byBucket.get(f.bucket) || { ok: 0, failed: 0, bytes: 0 }
    try {
      if (!bucketsEnsured.has(f.bucket)) {
        await createBucketIfMissing(projectRef, serviceRoleKey, f.bucket)
        bucketsEnsured.add(f.bucket)
      }
      const mimeType = mimeTypes.get(`${f.bucket}/${f.path}`) || 'application/octet-stream'
      await uploadToStorage({ projectRef, serviceRoleKey, bucket: f.bucket, path: f.path, buffer: f.buffer, mimeType })
      entry.ok++
      entry.bytes += f.buffer.length
      totalBytes += f.buffer.length
    } catch (err) {
      entry.failed++
      failedCount++
    }
    byBucket.set(f.bucket, entry)
  }

  return {
    totalFiles: files.length,
    failedCount,
    totalBytes,
    buckets: [...byBucket.entries()].map(([bucket, v]) => ({ bucket, ...v })),
  }
}
