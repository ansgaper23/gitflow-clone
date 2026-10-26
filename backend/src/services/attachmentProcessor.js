// backend/src/services/attachmentProcessor.js
// PROCESADOR Y EXTRACTOR UNIVERSAL DE DOCUMENTOS Y ADJUNTOS (FASE 7 + FASE 8: MULTIMEDIA)
// Soporta: Word (.docx), Excel (.xlsx, .xls), CSV/TSV (.csv), Texto plano/Código (.txt, .md, .json, .sql),
// PDF (.pdf), ZIP (.zip con migraciones DB o assets).
// FASE 8: Extracción completa de imágenes incrustadas en .docx (word/media/*),
//          maquetación estructural (tablas, alineaciones, negritas, fuentes) y catálogo de activos.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import zlib from 'node:zlib'
import sharp from 'sharp'
import AdmZip from 'adm-zip'
import mammoth from 'mammoth'
import ExcelJS from 'exceljs'

const MAX_EXTRACTED_CHARS = 50_000
const MAX_ROWS_PER_SHEET = 300

function truncate(text) {
  if (!text) return ''
  if (text.length <= MAX_EXTRACTED_CHARS) return text
  return `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[... Contenido recortado por longitud máxima (${MAX_EXTRACTED_CHARS} caracteres) ...]`
}

/**
 * Decodifica entidades XML estándar
 */
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

// ─── Extensiones de imagen soportadas ────────────────────────────────────────
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.emf', '.wmf', '.svg'])
const IMAGE_MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.emf': 'image/emf',
  '.wmf': 'image/wmf',
  '.svg': 'image/svg+xml',
}

/**
 * FASE 8 — Extrae imágenes incrustadas de un .docx y retorna un catálogo de activos.
 * Analiza word/media/*, word/_rels/document.xml.rels y word/document.xml
 * para determinar posición (cabecera, cuerpo, pie), dimensiones y alineación.
 *
 * @param {Buffer} buffer  Buffer del archivo .docx
 * @returns {{ extractedAssets: Array, structuralGuide: string }}
 *   extractedAssets: [{ fileName, publicPath, base64, mimeType, widthEmu, heightEmu, widthPx, heightPx, contextHint, isMultimodal }]
 *   structuralGuide: texto Markdown con marcadores [IMAGEN AQUI: /doc-assets/...] y guía de maquetación
 */
export function extractDocxAssets(buffer) {
  const extractedAssets = []
  let structuralGuide = ''

  if (!buffer || buffer.length === 0) return { extractedAssets, structuralGuide }

  try {
    const zip = new AdmZip(buffer)
    const entries = zip.getEntries()

    // ── 1. Extraer todas las imágenes de word/media/* ─────────────────────────
    const mediaEntries = entries.filter(e =>
      !e.isDirectory &&
      e.entryName.startsWith('word/media/')
    )

    const mediaMap = {} // rId -> asset info  (populated after rels parsing)
    const assetByName = {} // fileName -> asset info

    for (const entry of mediaEntries) {
      const fileName = path.basename(entry.entryName)
      const ext = path.extname(fileName).toLowerCase()
      if (!IMAGE_EXTS.has(ext)) continue

      const imgBuffer = entry.getData()
      if (!imgBuffer || imgBuffer.length === 0) continue

      const mimeType = IMAGE_MIME_MAP[ext] || 'image/png'
      // Skip EMF/WMF (Windows metafiles not usable in browsers)
      if (mimeType === 'image/emf' || mimeType === 'image/wmf') continue

      const base64 = imgBuffer.toString('base64')
      const publicPath = `/doc-assets/${fileName}`
      const asset = {
        fileName,
        publicPath,
        base64,
        mimeType,
        sizeBytes: imgBuffer.length,
        widthEmu: 0,
        heightEmu: 0,
        widthPx: 0,
        heightPx: 0,
        contextHint: 'Cuerpo del documento',
        isMultimodal: false, // will be set for first 4 non-svg images
        entryName: entry.entryName, // internal path for rels lookup
      }
      extractedAssets.push(asset)
      assetByName[fileName] = asset
    }

    if (extractedAssets.length === 0) return { extractedAssets, structuralGuide }

    // ── 2. Parsear relaciones word/_rels/document.xml.rels ─────────────────────
    // Map rId -> target (e.g. "media/image1.png")
    const relsEntry = zip.getEntry('word/_rels/document.xml.rels')
    const ridToFileName = {} // rId -> fileName
    if (relsEntry) {
      const relsXml = relsEntry.getData().toString('utf-8')
      const relPattern = /<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g
      let rm
      while ((rm = relPattern.exec(relsXml)) !== null) {
        const rId = rm[1]
        const target = rm[2] // e.g. "media/image1.png"
        const fname = path.basename(target)
        if (assetByName[fname]) {
          ridToFileName[rId] = fname
        }
      }
    }

    // ── 3. Parsear word/document.xml para dimensiones y contexto ──────────────
    const docEntry = zip.getEntry('word/document.xml')
    if (docEntry) {
      const docXml = docEntry.getData().toString('utf-8')

      // Extract inline/anchor drawing blocks with their rId and dimensions
      // Match <w:drawing> ... </w:drawing> blocks
      const drawingPattern = /<w:drawing>([\s\S]*?)<\/w:drawing>/g
      let dm
      while ((dm = drawingPattern.exec(docXml)) !== null) {
        const block = dm[1]

        // Get rId
        const ridMatch = /<a:blip[^>]+r:embed="([^"]+)"/i.exec(block)
        if (!ridMatch) continue
        const rId = ridMatch[1]
        const fname = ridToFileName[rId]
        if (!fname || !assetByName[fname]) continue

        const asset = assetByName[fname]

        // Dimensions (EMU): 1 inch = 914400 EMU, 1px = 9525 EMU at 96dpi
        const cxMatch = /cx="(\d+)"/i.exec(block)
        const cyMatch = /cy="(\d+)"/i.exec(block)
        if (cxMatch) {
          asset.widthEmu = parseInt(cxMatch[1], 10)
          asset.widthPx = Math.round(asset.widthEmu / 9525)
        }
        if (cyMatch) {
          asset.heightEmu = parseInt(cyMatch[1], 10)
          asset.heightPx = Math.round(asset.heightEmu / 9525)
        }

        // Inline vs Anchor
        const isAnchor = block.includes('<wp:anchor')
        // Alignment hint from anchor
        let align = 'centro'
        const posHRef = /simplePos x="(\d+)"/i.exec(block)
        const alignHMatch = /<wp:align>(left|right|center|inside|outside)<\/wp:align>/i.exec(block)
        if (alignHMatch) {
          const a = alignHMatch[1].toLowerCase()
          align = a === 'left' ? 'izquierda' : a === 'right' ? 'derecha' : 'centro'
        }

        asset.contextHint = isAnchor
          ? `Anclado en el documento (alineación: ${align})`
          : 'Cuerpo del documento (inline)'
      }
    }

    // ── 4. Detectar imágenes en cabecera y pie ────────────────────────────────
    // word/header1.xml, word/footer1.xml
    const headerEntry = zip.getEntry('word/header1.xml')
    const footerEntry = zip.getEntry('word/footer1.xml')

    const checkHeaderFooterImages = (xmlEntry, label) => {
      if (!xmlEntry) return
      const xml = xmlEntry.getData().toString('utf-8')
      // Extract rIds referenced in this header/footer
      const ridPattern = /<a:blip[^>]+r:embed="([^"]+)"/gi
      let hm
      while ((hm = ridPattern.exec(xml)) !== null) {
        const rId = hm[1]
        const fname = ridToFileName[rId]
        if (fname && assetByName[fname]) {
          assetByName[fname].contextHint = label
        }
      }
    }
    checkHeaderFooterImages(headerEntry, 'Cabecera del documento (posiblemente logo)')
    checkHeaderFooterImages(footerEntry, 'Pie de página (posiblemente firma/sello)')

    // ── 5. Marcar primeras 4 imágenes no-SVG como multimodal para el LLM ──────
    let multimodalCount = 0
    for (const asset of extractedAssets) {
      if (multimodalCount >= 4) break
      if (asset.mimeType !== 'image/svg+xml') {
        asset.isMultimodal = true
        multimodalCount++
      }
    }

    // ── 6. Generar Guía Estructural de Maquetación enriquecida ───────────────
    // Parse document.xml para texto estructurado con marcadores de imagen
    if (docEntry) {
      structuralGuide = buildDocxStructuralGuide(
        zip.getEntry('word/document.xml').getData().toString('utf-8'),
        extractedAssets,
        ridToFileName
      )
    }

  } catch (err) {
    console.warn('[extractDocxAssets] Error extrayendo activos del docx:', err.message)
  }

  return { extractedAssets, structuralGuide }
}

/**
 * Convierte el word/document.xml en una guía estructural Markdown con:
 * - Marcadores de imagen [IMAGEN AQUI: /doc-assets/xxx]
 * - Alineaciones de párrafo
 * - Negritas, cursivas, subrayados y tamaños de fuente
 * - Tablas con bordes y anchos de columna
 */
function buildDocxStructuralGuide(docXml, extractedAssets, ridToFileName) {
  const lines = []

  // Build quick lookup: rId -> asset
  const ridToAsset = {}
  for (const [rId, fname] of Object.entries(ridToFileName)) {
    const asset = extractedAssets.find(a => a.fileName === fname)
    if (asset) ridToAsset[rId] = asset
  }

  // Process body element
  const bodyMatch = /<w:body>([\s\S]*?)<\/w:body>/i.exec(docXml)
  if (!bodyMatch) {
    // Fallback: strip all XML tags
    return decodeXmlEntities(docXml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  }

  const bodyXml = bodyMatch[1]

  // Split into paragraph, table, and drawing blocks at top level
  // We'll iterate over <w:p>, <w:tbl>, <w:drawing> elements
  const topLevelPattern = /<(w:p|w:tbl)(\s[^>]*)?>[\s\S]*?<\/\1>/g
  let match

  const processedXml = bodyXml

  // Tables
  const tablePattern = /<w:tbl>([\s\S]*?)<\/w:tbl>/g
  let tblMatch
  const tableBlocks = {}
  let tblIdx = 0
  let tableProcessedXml = processedXml
  while ((tblMatch = tablePattern.exec(processedXml)) !== null) {
    tableBlocks[tblIdx] = tblMatch[0]
    tblIdx++
  }

  // Process paragraphs + tables in order
  const elementPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>|<w:tbl>([\s\S]*?)<\/w:tbl>/g
  let el

  while ((el = elementPattern.exec(bodyXml)) !== null) {
    if (el[0].startsWith('<w:tbl')) {
      // Process table
      const tblXml = el[0]
      lines.push(processTable(tblXml))
    } else {
      // Process paragraph
      const paraXml = el[0]
      lines.push(processParagraph(paraXml, ridToAsset))
    }
  }

  return lines.filter(Boolean).join('\n')
}

function processParagraph(paraXml, ridToAsset) {
  // Check alignment
  const alignMatch = /<w:jc\s+w:val="([^"]+)"/i.exec(paraXml)
  const align = alignMatch ? alignMatch[1] : 'left'
  const alignLabel = align === 'center' ? '(centrado)' : align === 'right' ? '(derecha)' : align === 'both' ? '(justificado)' : ''

  // Check if paragraph contains an image drawing
  const drawingMatch = /<w:drawing>([\s\S]*?)<\/w:drawing>/i.exec(paraXml)
  if (drawingMatch) {
    const block = drawingMatch[1]
    const ridMatch = /<a:blip[^>]+r:embed="([^"]+)"/i.exec(block)
    if (ridMatch && ridToAsset[ridMatch[1]]) {
      const asset = ridToAsset[ridMatch[1]]
      const dim = asset.widthPx > 0 ? ` size: ${asset.widthPx}x${asset.heightPx}px` : ''
      return `[IMAGEN AQUI: ${asset.publicPath} - align: ${align}${dim}]`
    }
    return '[IMAGEN AQUI: imagen incrustada]'
  }

  // Extract runs of text with formatting
  const runPattern = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g
  let rMatch
  let paraText = ''

  while ((rMatch = runPattern.exec(paraXml)) !== null) {
    const runXml = rMatch[1]

    // Get text content
    const tMatch = /<w:t[^>]*>([^<]*)<\/w:t>/i.exec(runXml)
    if (!tMatch || !tMatch[1]) continue
    let text = decodeXmlEntities(tMatch[1])

    // Formatting
    const isBold = /<w:b(?:\s|\/|>)/.test(runXml) && !/<w:b\s+w:val="0"/.test(runXml)
    const isItalic = /<w:i(?:\s|\/|>)/.test(runXml) && !/<w:i\s+w:val="0"/.test(runXml)
    const isUnderline = /<w:u\s+w:val="(?!none)/.test(runXml)
    const szMatch = /<w:sz\s+w:val="(\d+)"/.exec(runXml)
    const fontSize = szMatch ? `${Math.round(parseInt(szMatch[1], 10) / 2)}pt` : ''

    if (isBold) text = `**${text}**`
    if (isItalic) text = `_${text}_`
    if (isUnderline) text = `__${text}__`
    if (fontSize && fontSize !== '11pt' && fontSize !== '12pt') text = `[${fontSize}]${text}`

    paraText += text
  }

  paraText = paraText.trim()
  if (!paraText) return ''
  if (alignLabel) return `${paraText} ${alignLabel}`
  return paraText
}

function processTable(tblXml) {
  const rows = []
  const rowPattern = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g
  let rMatch

  while ((rMatch = rowPattern.exec(tblXml)) !== null) {
    const rowXml = rMatch[1]
    const cells = []
    const cellPattern = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g
    let cMatch

    while ((cMatch = cellPattern.exec(rowXml)) !== null) {
      const cellXml = cMatch[1]
      // Extract text from all paragraphs in cell
      const cellText = []
      const paraPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
      let pMatch
      while ((pMatch = paraPattern.exec(cellXml)) !== null) {
        const pText = processParagraph(pMatch[0], {})
        if (pText) cellText.push(pText)
      }
      cells.push(cellText.join(' ').replace(/\|/g, '/') || ' ')
    }

    if (cells.length > 0) rows.push(cells)
  }

  if (rows.length === 0) return ''

  const tableLines = []
  // Header
  tableLines.push(`| ${rows[0].join(' | ')} |`)
  tableLines.push(`| ${rows[0].map(() => '---').join(' | ')} |`)
  for (const row of rows.slice(1)) {
    // Pad row to same width as header
    const paddedRow = rows[0].map((_, i) => row[i] || '')
    tableLines.push(`| ${paddedRow.join(' | ')} |`)
  }

  return tableLines.join('\n')
}

/**
 * Extractor de texto para documentos Word (.docx)
 * Intenta con mammoth y dispone de fallback a lectura de word/document.xml vía AdmZip
 */
export async function extractDocxText(buffer) {
  if (!buffer || buffer.length === 0) return ''

  // 1. Intento primario con mammoth
  try {
    const { value } = await mammoth.extractRawText({ buffer })
    if (value && value.trim().length > 0) {
      return truncate(value.trim())
    }
  } catch (err) {
    console.warn('[extractDocxText] Fallback a AdmZip para Word:', err.message)
  }

  // 2. Fallback quirúrgico: extraer word/document.xml del contenedor ZIP de docx
  try {
    const zip = new AdmZip(buffer)
    const docXmlEntry = zip.getEntry('word/document.xml')
    if (docXmlEntry) {
      const xml = docXmlEntry.getData().toString('utf-8')
      // Convertir párrafos y saltos en líneas
      const textWithLineBreaks = xml
        .replace(/<w:p\b[^>]*>/gi, '\n')
        .replace(/<w:br\b[^>]*>/gi, '\n')
        .replace(/<w:tab\b[^>]*>/gi, '\t')
        .replace(/<[^>]+>/g, '')
      const cleaned = decodeXmlEntities(textWithLineBreaks)
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join('\n')
      if (cleaned.length > 0) {
        return truncate(cleaned)
      }
    }
  } catch (zipErr) {
    console.warn('[extractDocxText] Fallback XML falló:', zipErr.message)
  }

  return '[Documento Word .docx adjuntado (sin texto legible extraído)]'
}

/**
 * Extractor de texto para planillas Excel (.xlsx, .xls)
 * Vuelca cada hoja como tabla Markdown legible para el LLM
 */
export async function extractXlsxText(buffer) {
  if (!buffer || buffer.length === 0) return ''

  try {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)

    const parts = []
    for (const sheet of workbook.worksheets) {
      const rows = []
      let rowCount = 0

      sheet.eachRow((row) => {
        if (rowCount >= MAX_ROWS_PER_SHEET) return
        const cells = row.values.slice(1).map((v) => {
          if (v === null || v === undefined) return ''
          if (typeof v === 'object' && 'text' in v) return String(v.text).replace(/\|/g, '/')
          if (typeof v === 'object' && v instanceof Date) return v.toISOString().slice(0, 10)
          return String(v).replace(/\|/g, '/')
        })
        rows.push(cells)
        rowCount++
      })

      if (rows.length === 0) continue

      // Formatear como tabla Markdown
      const header = rows[0] || []
      const dataRows = rows.slice(1)
      const tableLines = []

      tableLines.push(`| ${header.join(' | ')} |`)
      tableLines.push(`| ${header.map(() => '---').join(' | ')} |`)
      for (const r of dataRows) {
        // Asegurar que la fila tenga la misma cantidad de celdas que el header
        const paddedRow = header.map((_, i) => r[i] || '')
        tableLines.push(`| ${paddedRow.join(' | ')} |`)
      }

      const truncatedNote = sheet.rowCount > MAX_ROWS_PER_SHEET
        ? `\n[... ${sheet.rowCount - MAX_ROWS_PER_SHEET} filas adicionales omitidas en hoja "${sheet.name}" ...]`
        : ''

      parts.push(`### Hoja: "${sheet.name}" (${sheet.rowCount} filas)\n${tableLines.join('\n')}${truncatedNote}`)
    }

    return truncate(parts.join('\n\n'))
  } catch (err) {
    console.warn('[extractXlsxText] Error al procesar Excel:', err.message)
    return `[Archivo Excel adjuntado: error al procesar estructura (${err.message})]`
  }
}

/**
 * Extractor de texto para archivos CSV / TSV
 * Genera una tabla Markdown estructurada
 */
export function extractCsvText(buffer) {
  if (!buffer || buffer.length === 0) return ''

  try {
    const text = buffer.toString('utf-8').trim()
    const lines = text.split(/\r?\n/).filter(Boolean)
    if (lines.length === 0) return ''

    // Detectar delimitador (coma, punto y coma o tabulación)
    const firstLine = lines[0]
    let delimiter = ','
    if ((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length) delimiter = ';'
    else if ((firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length) delimiter = '\t'

    const parseCsvLine = (line) => {
      const pattern = new RegExp(
        `(?:^|${delimiter === '\t' ? '\\t' : delimiter})("\\s*(?:[^"]|"")*\\s*"|[^"${delimiter === '\t' ? '\\t' : delimiter}]*)`,
        'g'
      )
      const values = []
      let match
      while ((match = pattern.exec(line)) !== null) {
        let v = match[1] || ''
        if (v.startsWith('"') && v.endsWith('"')) {
          v = v.slice(1, -1).replace(/""/g, '"')
        }
        values.push(v.trim().replace(/\|/g, '/'))
      }
      return values
    }

    const maxRows = Math.min(lines.length, MAX_ROWS_PER_SHEET)
    const rows = lines.slice(0, maxRows).map(parseCsvLine)
    if (rows.length === 0) return ''

    const header = rows[0]
    const dataRows = rows.slice(1)
    const tableLines = []

    tableLines.push(`| ${header.join(' | ')} |`)
    tableLines.push(`| ${header.map(() => '---').join(' | ')} |`)
    for (const r of dataRows) {
      const paddedRow = header.map((_, i) => r[i] || '')
      tableLines.push(`| ${paddedRow.join(' | ')} |`)
    }

    const truncatedNote = lines.length > MAX_ROWS_PER_SHEET
      ? `\n[... ${lines.length - MAX_ROWS_PER_SHEET} filas adicionales omitidas en CSV ...]`
      : ''

    return truncate(`${tableLines.join('\n')}${truncatedNote}`)
  } catch (err) {
    return `[Archivo CSV adjuntado: error al parsear (${err.message})]`
  }
}

/**
 * Extractor de texto para archivos de texto plano o código (.txt, .md, .json, .sql, etc.)
 */
export function extractPlainText(buffer) {
  if (!buffer || buffer.length === 0) return ''
  try {
    return truncate(buffer.toString('utf-8'))
  } catch {
    return truncate(buffer.toString('latin1'))
  }
}

/**
 * Extractor de texto para archivos PDF (.pdf)
 * Busca bloques de texto en streams descomprimidos con zlib
 */
export function extractPdfText(buffer, filename = 'documento.pdf') {
  if (!buffer || buffer.length === 0) return ''

  try {
    const rawContent = buffer.toString('latin1')
    const extractedWords = []

    // 1. Extraer streams descomprimidos de texto
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g
    let match
    while ((match = streamRegex.exec(rawContent)) !== null) {
      let streamData = Buffer.from(match[1], 'latin1')

      // Verificar si es un stream comprimido con FlateDecode
      const streamStart = rawContent.lastIndexOf('<<', match.index)
      const streamDict = streamStart !== -1 ? rawContent.slice(streamStart, match.index) : ''
      if (streamDict.includes('/FlateDecode')) {
        try {
          streamData = zlib.inflateSync(streamData)
        } catch {
          // Ignorar stream que no se pueda inflar
          continue
        }
      }

      const streamText = streamData.toString('latin1')

      // 2. Extraer cadenas dentro de bloques BT ... ET
      const btBlocks = streamText.match(/BT[\s\S]*?ET/g) || []
      for (const block of btBlocks) {
        // Coincidencias con texto simple (texto) Tj o (texto) '
        const tjMatches = block.match(/\((.*?)\)\s*(?:Tj|'|")/g) || []
        for (const tj of tjMatches) {
          const textMatch = /\((.*?)\)/.exec(tj)
          if (textMatch && textMatch[1]) {
            extractedWords.push(textMatch[1].replace(/\\([()\\])/g, '$1'))
          }
        }

        // Coincidencias con arrays [ (t1) -10 (t2) ] TJ
        const arrayMatches = block.match(/\[(.*?)\]\s*TJ/g) || []
        for (const arr of arrayMatches) {
          const innerT = /\((.*?)\)/g
          let tm
          while ((tm = innerT.exec(arr)) !== null) {
            extractedWords.push(tm[1].replace(/\\([()\\])/g, '$1'))
          }
        }
      }
    }

    const combinedText = extractedWords.join(' ').replace(/\s+/g, ' ').trim()
    if (combinedText.length >= 20) {
      return truncate(combinedText)
    }

    // Fallback: Si no tiene capa de texto seleccionable (ej. PDF escaneado o imágenes rasterizadas)
    return `[Documento PDF: "${filename}" (adjunto en formato nativo para procesamiento visual/multimodal)]`
  } catch (err) {
    return `[Documento PDF: "${filename}" (adjunto en formato nativo; nota: ${err.message})]`
  }
}

/**
 * Lee las dimensiones ancho y alto de un buffer PNG estándar
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number }}
 */
function getPngDimensions(buffer) {
  if (!buffer || buffer.length < 24) return { width: 0, height: 0 }
  // Header PNG: 89 50 4E 47 0D 0A 1A 0A. El chunk IHDR empieza en offset 12, con width en 16 y height en 20
  if (buffer.readUInt32BE(0) === 0x89504E47) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    }
  }
  return { width: 0, height: 0 }
}

/**
 * Optimiza un buffer de imagen para visión multimodal del LLM (Claude, Gemini, OpenAI)
 * Redimensiona a un máximo de 1024x1024 manteniendo aspect ratio y comprime a JPEG q80
 * SALVAGUARDA DE RENDIMIENTO: Evita inyectar buffers PNG crudos de varios MB en el payload de la API
 */
export async function optimizeImageForVision(buffer) {
  if (!buffer || buffer.length === 0) return { base64: '', mimeType: 'image/jpeg' }
  try {
    const resized = await sharp(buffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()
    return {
      base64: resized.toString('base64'),
      mimeType: 'image/jpeg',
    }
  } catch (err) {
    return {
      base64: buffer.toString('base64'),
      mimeType: 'image/png',
    }
  }
}

/**
 * Convierte RGB a HSL
 */
function rgbToHsl(r, g, b) {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const delta = max - min
  const l = (max + min) / 2
  let h = 0
  let s = 0

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
    if (max === rN) {
      h = ((gN - bN) / delta + (gN < bN ? 6 : 0)) / 6
    } else if (max === gN) {
      h = ((bN - rN) / delta + 2) / 6
    } else {
      h = ((rN - gN) / delta + 4) / 6
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  }
}

/**
 * Convierte RGB a formato HEX (#rrggbb)
 */
function rgbToHex(r, g, b) {
  const toHex = (n) => {
    const hex = Math.max(0, Math.min(255, Math.round(n))).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toLowerCase()
}

/**
 * Extrae matemáticamente la paleta de colores corporativa y tono de superficie desde una imagen.
 * 
 * - Muestreo 64x64 con sharp
 * - Filtra píxeles no cromáticos (blancos >240, negros <18, grises |max-min| < 25)
 * - Agrupa píxeles cromáticos en 12 buckets de tono (hue) ponderados por saturación
 * - Extrae color primario dominante, secundario/acento contrastante y variables HSL para Tailwind
 * 
 * @param {Buffer} imageBuffer - Buffer de imagen
 * @returns {Promise<{
 *   primaryHex: string,
 *   primaryHsl: string,
 *   secondaryHex: string,
 *   secondaryHsl: string,
 *   accentHex: string,
 *   accentHsl: string,
 *   surfaceTone: 'light' | 'dark',
 *   neutralDarkHex: string,
 *   neutralDarkHsl: string,
 *   neutralLightHex: string,
 *   neutralLightHsl: string
 * }>}
 */
export async function extractDominantPalette(imageBuffer) {
  if (!imageBuffer || imageBuffer.length === 0) {
    return {
      primaryHex: '#0f172a',
      primaryHsl: '222 47% 11%',
      secondaryHex: '#2563eb',
      secondaryHsl: '221 83% 53%',
      accentHex: '#38bdf8',
      accentHsl: '199 89% 48%',
      surfaceTone: 'light',
      neutralDarkHex: '#0f172a',
      neutralDarkHsl: '222 47% 11%',
      neutralLightHex: '#f8fafc',
      neutralLightHsl: '210 40% 98%',
    }
  }

  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(64, 64, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const buckets = Array.from({ length: 12 }, () => ({
      count: 0,
      weight: 0,
      sumR: 0,
      sumG: 0,
      sumB: 0,
      sumH: 0,
      sumS: 0,
      sumL: 0,
    }))

    let totalSampledPixels = 0
    let totalLuminance = 0

    const channels = info.channels || 4
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = channels >= 4 ? data[i + 3] : 255

      if (a < 128) continue

      totalSampledPixels++
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b
      totalLuminance += luminance

      if (r > 240 && g > 240 && b > 240) continue
      if (r < 18 && g < 18 && b < 18) continue
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      if (maxC - minC < 25) continue

      const hsl = rgbToHsl(r, g, b)
      const bucketIdx = Math.floor(hsl.h / 30) % 12
      const weight = (hsl.s / 100) * (hsl.s / 100)

      const bucket = buckets[bucketIdx]
      bucket.count++
      bucket.weight += weight
      bucket.sumR += r * weight
      bucket.sumG += g * weight
      bucket.sumB += b * weight
      bucket.sumH += hsl.h * weight
      bucket.sumS += hsl.s * weight
      bucket.sumL += hsl.l * weight
    }

    const avgLuminance = totalSampledPixels > 0 ? totalLuminance / totalSampledPixels : 200
    const surfaceTone = avgLuminance < 115 ? 'dark' : 'light'

    const activeBuckets = buckets
      .map((b, idx) => ({ ...b, bucketIndex: idx }))
      .filter(b => b.count > 0 && b.weight > 0)
      .sort((a, b) => b.weight - a.weight)

    if (activeBuckets.length === 0) {
      return {
        primaryHex: '#0f172a',
        primaryHsl: '222 47% 11%',
        secondaryHex: '#2563eb',
        secondaryHsl: '221 83% 53%',
        accentHex: '#38bdf8',
        accentHsl: '199 89% 48%',
        surfaceTone,
        neutralDarkHex: '#0f172a',
        neutralDarkHsl: '222 47% 11%',
        neutralLightHex: '#f8fafc',
        neutralLightHsl: '210 40% 98%',
      }
    }

    const primaryB = activeBuckets[0]
    const pR = Math.round(primaryB.sumR / primaryB.weight)
    const pG = Math.round(primaryB.sumG / primaryB.weight)
    const pB = Math.round(primaryB.sumB / primaryB.weight)
    const pHsl = rgbToHsl(pR, pG, pB)

    let secondaryB = activeBuckets.find(b => {
      const diff = Math.abs(b.bucketIndex - primaryB.bucketIndex)
      const angularDistance = Math.min(diff, 12 - diff) * 30
      return angularDistance >= 35
    })

    let sR, sG, sB, sHsl
    if (secondaryB) {
      sR = Math.round(secondaryB.sumR / secondaryB.weight)
      sG = Math.round(secondaryB.sumG / secondaryB.weight)
      sB = Math.round(secondaryB.sumB / secondaryB.weight)
      sHsl = rgbToHsl(sR, sG, sB)
    } else {
      const shiftedHue = (pHsl.h + 35) % 360
      sHsl = { h: shiftedHue, s: Math.min(100, Math.max(50, pHsl.s)), l: pHsl.l > 50 ? 35 : 65 }
      sR = pR; sG = pG; sB = pB
    }

    let accentB = activeBuckets.find(b => {
      if (b === primaryB || b === secondaryB) return false
      const diffP = Math.min(Math.abs(b.bucketIndex - primaryB.bucketIndex), 12 - Math.abs(b.bucketIndex - primaryB.bucketIndex)) * 30
      return diffP >= 45
    })

    let aHsl, aHex
    if (accentB) {
      const aR = Math.round(accentB.sumR / accentB.weight)
      const aG = Math.round(accentB.sumG / accentB.weight)
      const aB = Math.round(accentB.sumB / accentB.weight)
      aHsl = rgbToHsl(aR, aG, aB)
      aHex = rgbToHex(aR, aG, aB)
    } else {
      const accentHue = (pHsl.h + 180) % 360
      aHsl = { h: accentHue, s: 85, l: 55 }
      aHex = rgbToHex(Math.round(255 - pR), Math.round(255 - pG), Math.round(255 - pB))
    }

    return {
      primaryHex: rgbToHex(pR, pG, pB),
      primaryHsl: `${pHsl.h} ${pHsl.s}% ${pHsl.l}%`,
      secondaryHex: secondaryB ? rgbToHex(sR, sG, sB) : aHex,
      secondaryHsl: `${sHsl.h} ${sHsl.s}% ${sHsl.l}%`,
      accentHex: aHex,
      accentHsl: `${aHsl.h} ${aHsl.s}% ${aHsl.l}%`,
      surfaceTone,
      neutralDarkHex: '#0f172a',
      neutralDarkHsl: '222 47% 11%',
      neutralLightHex: '#f8fafc',
      neutralLightHsl: '210 40% 98%',
    }
  } catch (err) {
    console.warn('[extractDominantPalette] Error extrayendo paleta:', err.message)
    return {
      primaryHex: '#0f172a',
      primaryHsl: '222 47% 11%',
      secondaryHex: '#2563eb',
      secondaryHsl: '221 83% 53%',
      accentHex: '#38bdf8',
      accentHsl: '199 89% 48%',
      surfaceTone: 'light',
      neutralDarkHex: '#0f172a',
      neutralDarkHsl: '222 47% 11%',
      neutralLightHex: '#f8fafc',
      neutralLightHsl: '210 40% 98%',
    }
  }
}

/**
 * FASE 8 — Extrae imágenes embebidas y páginas renderizadas de un PDF usando poppler-utils (pdfimages / pdftoppm)
 * Con filtro estricto de máscaras SMask / Stencil, deduplicación SHA-1, mapeo de texto por página
 * y generación de manifiesto contextual public/doc-assets/manifest.json
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<{ extractedAssets: Array, renderedPages: Array, manifest: Object }>}
 */
export async function extractPdfAssets(buffer, filename = 'documento.pdf') {
  const extractedAssets = []
  const renderedPages = []
  let manifest = { generatedAt: new Date().toISOString(), sourceDocument: filename, assets: [], pages: [] }

  if (!buffer || buffer.length === 0) return { extractedAssets, renderedPages, manifest }

  const cleanBase = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'doc'
  const tempId = `pdf-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const tempDir = path.join(os.tmpdir(), tempId)

  try {
    fs.mkdirSync(tempDir, { recursive: true })
    const pdfPath = path.join(tempDir, 'input.pdf')
    fs.writeFileSync(pdfPath, buffer)

    // 1. Obtener lista de imágenes y tipos usando pdfimages -list (para detectar smask / stencil)
    const imageListMap = new Map() // num -> { page, num, type, width, height, isMask }
    try {
      const listOutput = execSync(`pdfimages -list "${pdfPath}"`, { stdio: 'pipe', timeout: 30000 }).toString('utf-8')
      const lines = listOutput.split(/\r?\n/)
      for (const line of lines) {
        const m = line.trim().match(/^(\d+)\s+(\d+)\s+([a-zA-Z0-9_-]+)\s+(\d+)\s+(\d+)/)
        if (m) {
          const page = parseInt(m[1], 10)
          const num = parseInt(m[2], 10)
          const type = m[3].toLowerCase()
          const width = parseInt(m[4], 10)
          const height = parseInt(m[5], 10)
          const isMask = type === 'smask' || type === 'mask' || type === 'stencil'
          imageListMap.set(num, { page, num, type, width, height, isMask })
        }
      }
    } catch (cmdErr) {
      console.warn('[extractPdfAssets] pdfimages -list no disponible o falló:', cmdErr.message)
    }

    // 2. Extraer texto por página usando pdftotext (separador de páginas: \f)
    let pageTexts = []
    try {
      const fullText = execSync(`pdftotext "${pdfPath}" -`, { stdio: 'pipe', timeout: 30000 }).toString('utf-8')
      pageTexts = fullText.split('\f').map(t => t.trim().replace(/\s+/g, ' '))
    } catch (textErr) {
      try {
        const rawTxt = extractPdfText(buffer, filename)
        pageTexts = [rawTxt]
      } catch (_) {}
    }

    // 3. Extraer imágenes embebidas en el PDF usando pdfimages -png
    try {
      execSync(`pdfimages -png "${pdfPath}" "${path.join(tempDir, 'extracted')}"`, { stdio: 'pipe', timeout: 30000 })
    } catch (cmdErr) {
      console.warn('[extractPdfAssets] pdfimages -png no disponible o falló:', cmdErr.message)
    }

    // 4. Renderizar las primeras 2 páginas completas usando pdftoppm -png -r 120 -f 1 -l 2
    try {
      execSync(`pdftoppm -png -r 120 -f 1 -l 2 "${pdfPath}" "${path.join(tempDir, 'page')}"`, { stdio: 'pipe', timeout: 30000 })
    } catch (cmdErr) {
      console.warn('[extractPdfAssets] pdftoppm no disponible o falló:', cmdErr.message)
    }

    // 5. Procesar archivos generados
    const files = fs.readdirSync(tempDir)
    const seenSha1 = new Set()
    const manifestAssets = []

    // A) Procesar imágenes embebidas extraídas (con filtro de SMask y deduplicación SHA-1)
    const extractedFiles = files.filter(f => f.startsWith('extracted-') && f.endsWith('.png')).sort()
    let assetIndex = 1
    for (const f of extractedFiles) {
      const numMatch = f.match(/extracted-(\d+)\.png$/)
      const num = numMatch ? parseInt(numMatch[1], 10) : null
      const metaFromList = num !== null ? imageListMap.get(num) : null

      // FILTRO DETERMINISTA: Descartar máscaras de transparencia SMask y Stencils
      if (metaFromList && metaFromList.isMask) {
        continue
      }

      const filePath = path.join(tempDir, f)
      const stat = fs.statSync(filePath)
      // Descartar fragmentos basurilla (< 400 bytes)
      if (stat.size < 400) continue

      const imgBuffer = fs.readFileSync(filePath)
      const dims = getPngDimensions(imgBuffer)
      if (dims.width <= 2 && dims.height <= 2) continue

      // DEDUPLICACIÓN SHA-1: Descartar copias binarias idénticas
      const sha1 = crypto.createHash('sha1').update(imgBuffer).digest('hex')
      if (seenSha1.has(sha1)) {
        continue
      }
      seenSha1.add(sha1)

      const pageNum = metaFromList ? metaFromList.page : 1
      const pageText = (pageTexts[pageNum - 1] || '').slice(0, 400)
      const aspectRatio = dims.height > 0 ? Number((dims.width / dims.height).toFixed(2)) : 1.0

      const outName = `${cleanBase}-img-${assetIndex}.png`
      const isBannerOrLogo = dims.width > 0 && dims.height > 0 && (dims.width / dims.height >= 1.2) && (dims.width <= 800) && (dims.height <= 400)
      const contextHint = isBannerOrLogo
        ? 'Logo corporativo / isotipo extraído del PDF'
        : 'Fotografía / gráfico de servicio extraído del PDF'

      const assetRecord = {
        fileName: outName,
        publicPath: `/doc-assets/${outName}`,
        base64: imgBuffer.toString('base64'),
        mimeType: 'image/png',
        sizeBytes: stat.size,
        widthPx: dims.width,
        heightPx: dims.height,
        page: pageNum,
        aspectRatio,
        pageContextText: pageText,
        contextHint,
        isMultimodal: false,
      }

      extractedAssets.push(assetRecord)
      manifestAssets.push({
        fileName: outName,
        publicPath: `/doc-assets/${outName}`,
        page: pageNum,
        width: dims.width,
        height: dims.height,
        aspectRatio,
        sizeBytes: stat.size,
        pageContextText: pageText,
      })
      assetIndex++
    }

    // B) Procesar páginas completas renderizadas (para visión del LLM)
    const manifestPages = []
    const pageFiles = files.filter(f => f.startsWith('page-') && f.endsWith('.png')).sort()
    let pIdx = 1
    for (const pf of pageFiles) {
      const pagePath = path.join(tempDir, pf)
      const pageBuf = fs.readFileSync(pagePath)
      const pageDims = getPngDimensions(pageBuf)
      const pageName = `${cleanBase}-${pf}`
      const pageText = (pageTexts[pIdx - 1] || '').slice(0, 400)
      const aspectRatio = pageDims.height > 0 ? Number((pageDims.width / pageDims.height).toFixed(2)) : 1.0

      const pageRecord = {
        fileName: pageName,
        publicPath: `/doc-assets/${pageName}`,
        base64: pageBuf.toString('base64'),
        mimeType: 'image/png',
        sizeBytes: pageBuf.length,
        widthPx: pageDims.width,
        heightPx: pageDims.height,
        page: pIdx,
        aspectRatio,
        pageContextText: pageText,
        contextHint: `Página ${pIdx} completa renderizada del PDF`,
        isMultimodal: true,
      }

      renderedPages.push(pageRecord)
      manifestPages.push({
        fileName: pageName,
        publicPath: `/doc-assets/${pageName}`,
        page: pIdx,
        width: pageDims.width,
        height: pageDims.height,
        aspectRatio,
        sizeBytes: pageBuf.length,
        pageContextText: pageText,
      })
      pIdx++
    }

    // C) Extracción matemática de paleta de colores corporativa (desde la portada o logotipo)
    let brandPalette = null
    if (renderedPages.length > 0 && renderedPages[0].base64) {
      try {
        const firstPageBuf = Buffer.from(renderedPages[0].base64, 'base64')
        brandPalette = await extractDominantPalette(firstPageBuf)
      } catch (palErr) {
        console.warn('[extractPdfAssets] Error extrayendo paleta dominante de página 1:', palErr.message)
      }
    }
    if (!brandPalette && extractedAssets.length > 0 && extractedAssets[0].base64) {
      try {
        const firstAssetBuf = Buffer.from(extractedAssets[0].base64, 'base64')
        brandPalette = await extractDominantPalette(firstAssetBuf)
      } catch (_) {}
    }

    // D) Construir y agregar manifest.json al catálogo de activos
    manifest = {
      generatedAt: new Date().toISOString(),
      sourceDocument: filename,
      totalImages: extractedAssets.length,
      totalPages: renderedPages.length,
      brandPalette,
      assets: manifestAssets,
      pages: manifestPages,
    }
    const manifestJsonString = JSON.stringify(manifest, null, 2)
    const manifestAsset = {
      fileName: 'manifest.json',
      publicPath: '/doc-assets/manifest.json',
      base64: Buffer.from(manifestJsonString, 'utf-8').toString('base64'),
      mimeType: 'application/json',
      sizeBytes: Buffer.byteLength(manifestJsonString),
      contextHint: 'Manifiesto contextual de imágenes y páginas del documento',
      isMultimodal: false,
      isManifest: true,
    }
    extractedAssets.push(manifestAsset)

    // D) Marcar hasta 4 imágenes prioritarias como multimodales con optimización sharp (<= 1024px)
    let mmCount = 0
    for (const rp of renderedPages) {
      if (mmCount >= 2) break
      const opt = await optimizeImageForVision(Buffer.from(rp.base64, 'base64'))
      rp.base64 = opt.base64
      rp.mimeType = opt.mimeType
      rp.isMultimodal = true
      mmCount++
    }
    for (const ea of extractedAssets) {
      if (mmCount >= 4 || ea.isManifest) break
      const opt = await optimizeImageForVision(Buffer.from(ea.base64, 'base64'))
      ea.base64 = opt.base64
      ea.mimeType = opt.mimeType
      ea.isMultimodal = true
      mmCount++
    }

  } catch (err) {
    console.warn('[extractPdfAssets] Error general procesando activos PDF:', err.message)
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    } catch (_) {}
  }

  return { extractedAssets, renderedPages, manifest }
}

/**
 * Determina si un archivo es un documento o archivo de texto extraíble
 */
export function isExtractableDocument(filename = '', mimeType = '') {
  const ext = path.extname(filename || '').toLowerCase()
  const mime = (mimeType || '').toLowerCase()

  const extractableExtensions = new Set([
    '.docx',
    '.xlsx',
    '.xls',
    '.csv',
    '.tsv',
    '.txt',
    '.md',
    '.json',
    '.sql',
    '.pdf',
    '.xml',
    '.yaml',
    '.yml',
    '.html',
    '.css',
    '.js',
    '.jsx',
    '.ts',
    '.tsx'
  ])

  if (extractableExtensions.has(ext)) return true

  if (
    mime.includes('word') ||
    mime.includes('excel') ||
    mime.includes('spreadsheet') ||
    mime.includes('csv') ||
    mime.includes('pdf') ||
    mime.startsWith('text/') ||
    mime === 'application/json'
  ) {
    return true
  }

  return false
}

/**
 * Clase principal AttachmentProcessor
 */
export class AttachmentProcessor {
  /**
   * Extrae el texto legible de un archivo adjunto.
   * Para .docx también extrae activos multimedia y guía estructural.
   * @param {Buffer|string} bufferOrPath
   * @param {string} filename
   * @param {string} [mimeType]
   * @returns {Promise<{ text: string, extractedAssets: Array, structuralGuide: string }>}
   */
  static async extractTextFull(bufferOrPath, filename = '', mimeType = '') {
    let buffer
    if (Buffer.isBuffer(bufferOrPath)) {
      buffer = bufferOrPath
    } else if (typeof bufferOrPath === 'string') {
      buffer = fs.readFileSync(bufferOrPath)
      if (!filename) filename = path.basename(bufferOrPath)
    } else if (bufferOrPath && bufferOrPath.buffer) {
      buffer = bufferOrPath.buffer
    } else {
      return { text: '', extractedAssets: [], structuralGuide: '' }
    }

    const ext = path.extname(filename).toLowerCase()
    const mime = (mimeType || '').toLowerCase()

    // .docx: también extrae imágenes y guía estructural
    if (ext === '.docx' || mime.includes('wordprocessingml')) {
      const { extractedAssets, structuralGuide } = extractDocxAssets(buffer)
      let text
      if (structuralGuide && structuralGuide.trim().length > 20) {
        // Use the rich structural guide as extracted text when images are present
        text = structuralGuide
      } else {
        text = await extractDocxText(buffer)
      }
      return { text: truncate(text), extractedAssets, structuralGuide }
    }

    // .pdf: extrae texto + imágenes embebidas y páginas renderizadas para visión multimodal
    if (ext === '.pdf' || mime === 'application/pdf') {
      const { extractedAssets, renderedPages, manifest } = await extractPdfAssets(buffer, filename)
      const text = extractPdfText(buffer, filename)
      return {
        text: truncate(text),
        extractedAssets: [...extractedAssets, ...renderedPages],
        manifest,
        structuralGuide: ''
      }
    }

    // All other types: no asset extraction
    const text = await AttachmentProcessor.extractText(bufferOrPath, filename, mimeType)
    return { text, extractedAssets: [], structuralGuide: '' }
  }

  /**
   * Extrae el texto legible de un archivo adjunto
   * @param {Buffer|string} bufferOrPath
   * @param {string} filename
   * @param {string} [mimeType]
   * @returns {Promise<string>}
   */
  static async extractText(bufferOrPath, filename = '', mimeType = '') {
    try {
      let buffer
      if (Buffer.isBuffer(bufferOrPath)) {
        buffer = bufferOrPath
      } else if (typeof bufferOrPath === 'string') {
        buffer = fs.readFileSync(bufferOrPath)
        if (!filename) filename = path.basename(bufferOrPath)
      } else if (bufferOrPath && bufferOrPath.buffer) {
        buffer = bufferOrPath.buffer
      } else {
        return ''
      }

      const ext = path.extname(filename).toLowerCase()
      const mime = (mimeType || '').toLowerCase()

      // 1. Documentos Word (.docx)
      if (ext === '.docx' || mime.includes('wordprocessingml')) {
        return await extractDocxText(buffer)
      }

      // 2. Planillas Excel (.xlsx, .xls)
      if (ext === '.xlsx' || ext === '.xls' || mime.includes('spreadsheet') || mime.includes('excel')) {
        return await extractXlsxText(buffer)
      }

      // 3. Archivos CSV / TSV
      if (ext === '.csv' || ext === '.tsv' || mime.includes('csv')) {
        return extractCsvText(buffer)
      }

      // 4. Archivos PDF (.pdf)
      if (ext === '.pdf' || mime === 'application/pdf') {
        return extractPdfText(buffer, filename)
      }

      // 5. Archivos de texto plano y código fuente
      if (
        ext === '.txt' ||
        ext === '.md' ||
        ext === '.json' ||
        ext === '.sql' ||
        ext === '.xml' ||
        ext === '.yaml' ||
        ext === '.yml' ||
        ext === '.js' ||
        ext === '.jsx' ||
        ext === '.ts' ||
        ext === '.tsx' ||
        ext === '.html' ||
        ext === '.css' ||
        mime.startsWith('text/')
      ) {
        return extractPlainText(buffer)
      }

      return ''
    } catch (err) {
      console.warn(`[AttachmentProcessor] Error extrayendo texto de '${filename}':`, err.message)
      return `[Error al extraer texto de ${filename}: ${err.message}]`
    }
  }

  /**
   * Procesa un archivo adjunto en el contexto del workspace (para ZIPs de migración o assets)
   */
  static async process(file, projectWorkspacePath) {
    if (!file) return null

    const ext = path.extname(file.originalname || file.name || '').toLowerCase()
    const isZip = ext === '.zip'

    if (!isZip) {
      // Para archivos que no son ZIP, extraer texto de forma estándar si corresponde
      return null
    }

    const zipPath = file.path || file.tempFilePath
    const zip = new AdmZip(zipPath || file.buffer)
    const zipEntries = zip.getEntries()

    const ddlNames = ['schema.sql', 'full_schema_structure.sql', 'database.sql', 'dump.sql', 'init.sql']
    let ddlEntry = null

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue
      const entryName = path.basename(entry.entryName).toLowerCase()
      if (ddlNames.includes(entryName) || entryName.endsWith('.sql') || entryName.endsWith('.dump')) {
        ddlEntry = entry
        break
      }
    }

    if (ddlEntry) {
      return {
        type: 'DB_MIGRATION_ZIP',
        name: file.originalname || file.name,
        size: file.size,
        tempFilePath: zipPath,
        detectedDdl: ddlEntry.entryName,
      }
    }

    if (!projectWorkspacePath) {
      return {
        type: 'PROJECT_ASSETS_ZIP',
        name: file.originalname || file.name,
        extractedCount: zipEntries.length,
        manifest: zipEntries.slice(0, 30).map((e) => e.entryName)
      }
    }

    const targetExtractDir = path.join(projectWorkspacePath, 'src', 'assets', 'imported')
    fs.mkdirSync(targetExtractDir, { recursive: true })

    const extractedFiles = []
    zipEntries.forEach((entry) => {
      const targetPath = path.resolve(targetExtractDir, entry.entryName)
      if (!targetPath.startsWith(path.resolve(targetExtractDir))) return

      if (!entry.isDirectory && !entry.entryName.includes('__MACOSX') && !entry.entryName.includes('.DS_Store')) {
        zip.extractEntryTo(entry, targetExtractDir, true, true)
        extractedFiles.push(`src/assets/imported/${entry.entryName}`)
      }
    })

    return {
      type: 'PROJECT_ASSETS_ZIP',
      name: file.originalname || file.name,
      extractedCount: extractedFiles.length,
      manifest: extractedFiles.slice(0, 30)
    }
  }

  /**
   * FASE 8 — Persiste activos extraídos (imágenes de .docx) en el workspace del proyecto.
   * Escribe cada imagen en <workspacePath>/public/doc-assets/<fileName>
   * @param {Array} extractedAssets  Array retornado por extractDocxAssets()
   * @param {string} workspacePath   Ruta del workspace Docker del proyecto
   * @returns {number} Cantidad de archivos escritos
   */
  static persistExtractedAssets(extractedAssets, workspacePath) {
    if (!extractedAssets || extractedAssets.length === 0 || !workspacePath) return 0

    let written = 0
    try {
      const targetDir = path.join(workspacePath, 'public', 'doc-assets')
      fs.mkdirSync(targetDir, { recursive: true })

      for (const asset of extractedAssets) {
        try {
          const filePath = path.join(targetDir, asset.fileName)
          fs.writeFileSync(filePath, Buffer.from(asset.base64, 'base64'))
          written++
        } catch (err) {
          console.warn(`[persistExtractedAssets] Error escribiendo ${asset.fileName}:`, err.message)
        }
      }
    } catch (err) {
      console.warn('[persistExtractedAssets] Error creando directorio doc-assets:', err.message)
    }

    return written
  }
}

export default AttachmentProcessor
