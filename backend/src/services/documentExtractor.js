import mammoth from 'mammoth'
import ExcelJS from 'exceljs'

// Word/Excel no tienen forma multimodal en ninguna API de IA (a diferencia de imagen/PDF, que sí
// soportan Anthropic/Gemini de forma nativa) — se les saca el texto/datos acá y se los suma como
// TEXTO al mensaje del usuario (ver agent.js), no como un adjunto binario que el modelo no podría
// interpretar. Nunca se usa "xlsx" (SheetJS) para esto: tiene 2 CVEs sin fix (prototype pollution
// + ReDoS) explotables justo por la forma del archivo — inaceptable para archivos subidos por
// cualquier usuario. "exceljs" es la alternativa activa sin ese problema.
const MAX_EXTRACTED_CHARS = 20_000
const MAX_ROWS_PER_SHEET = 500

function truncate(text) {
  if (text.length <= MAX_EXTRACTED_CHARS) return text
  return `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[... contenido recortado, el archivo es más largo ...]`
}

async function extractDocxText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer })
  return truncate(value.trim())
}

// Cada hoja se vuelca como filas separadas por "|" (más compacto y legible para la IA que CSV
// con comillas escapadas) — se corta a MAX_ROWS_PER_SHEET filas por hoja para no inflar el
// prompt con una planilla de miles de filas (la IA igual entiende la estructura con una muestra).
async function extractXlsxText(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const parts = []
  for (const sheet of workbook.worksheets) {
    const lines = []
    let rowCount = 0
    sheet.eachRow((row) => {
      if (rowCount >= MAX_ROWS_PER_SHEET) return
      const cells = row.values.slice(1).map((v) => {
        if (v === null || v === undefined) return ''
        if (typeof v === 'object' && 'text' in v) return v.text // rich text
        if (typeof v === 'object' && v instanceof Date) return v.toISOString().slice(0, 10)
        return String(v)
      })
      lines.push(cells.join(' | '))
      rowCount++
    })
    const truncatedNote = sheet.rowCount > MAX_ROWS_PER_SHEET ? `\n[... ${sheet.rowCount - MAX_ROWS_PER_SHEET} filas más, recortado ...]` : ''
    parts.push(`--- Hoja "${sheet.name}" (${sheet.rowCount} filas) ---\n${lines.join('\n')}${truncatedNote}`)
  }
  return truncate(parts.join('\n\n'))
}

const EXTRACTORS = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': extractDocxText,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': extractXlsxText,
}

export function isExtractableDocument(mimeType) {
  return mimeType in EXTRACTORS
}

// Formatos binarios viejos (.doc de Word 97-2003, .xls de Excel 97-2003) — "mammoth" y "exceljs"
// solo leen los formatos .docx/.xlsx (Office Open XML); el binario viejo necesitaría otra
// herramienta (ej. antiword/catdoc) que no está instalada. Mejor avisar claro que fallar
// intentando parsear un binario que no es el formato esperado.
const LEGACY_OFFICE_TYPES = new Set(['application/msword', 'application/vnd.ms-excel'])
export function isLegacyOfficeDocument(mimeType) {
  return LEGACY_OFFICE_TYPES.has(mimeType)
}

export async function extractDocumentText(buffer, mimeType) {
  const extractor = EXTRACTORS[mimeType]
  if (!extractor) throw new Error(`Tipo de documento no soportado: ${mimeType}`)
  return extractor(buffer)
}
