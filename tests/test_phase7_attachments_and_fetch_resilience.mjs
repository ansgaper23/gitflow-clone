// tests/test_phase7_attachments_and_fetch_resilience.mjs
// Suite de certificación FASE 7:
// 1. Extracción universal de documentos (.docx, .xlsx, .csv, .pdf, .txt, .sql)
// 2. Inyección estricta en el prompt del agente con prohibición de pedir datos
// 3. Verificación de límites de carga de 50MB en Express y Multer
// 4. Mecanismo de persistencia de adjuntos Home -> Chat (attachmentStore)
// 5. Resiliencia de fetch y supresión de error en F5/unload

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from '../backend/node_modules/adm-zip/adm-zip.js'
import ExcelJS from '../backend/node_modules/exceljs/dist/exceljs.js'

import {
  AttachmentProcessor,
  extractDocxText,
  extractDocxAssets,
  extractXlsxText,
  extractCsvText,
  extractPdfText,
  extractPlainText,
  isExtractableDocument
} from '../backend/src/services/attachmentProcessor.js'

console.log('--- INICIANDO CERTIFICACIÓN FASE 7 ---\n')

async function runTests() {
  let passed = 0
  let failed = 0

  const test = async (name, fn) => {
    try {
      await fn()
      console.log(`✅ [PASS] ${name}`)
      passed++
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message)
      failed++
    }
  }

  // 1. Test CSV / TSV extraction
  await test('CSV / TSV parsea a tabla Markdown con formato limpio', async () => {
    const csvContent = 'ID,Producto,Precio,Stock\n1,Café Colombia,15.50,100\n2,"Té Verde, Especial",8.00,50'
    const markdown = extractCsvText(Buffer.from(csvContent, 'utf-8'))
    assert.ok(markdown.includes('| ID | Producto | Precio | Stock |'), 'Debe incluir encabezado')
    assert.ok(markdown.includes('| 1 | Café Colombia | 15.50 | 100 |'), 'Debe incluir fila 1')
    assert.ok(markdown.includes('Té Verde, Especial'), 'Debe respetar valores con comillas')
  })

  // 2. Test Excel (.xlsx) extraction
  await test('Excel (.xlsx) vuelca hojas estructuradas en Markdown', async () => {
    const wb = new ExcelJS.Workbook()
    const sheet = wb.addWorksheet('Inventario')
    sheet.addRow(['Código', 'Item', 'Cantidad'])
    sheet.addRow(['A001', 'Harina 000', 45])
    sheet.addRow(['A002', 'Levadura Fresca', 120])
    const buffer = await wb.xlsx.writeBuffer()

    const text = await extractXlsxText(Buffer.from(buffer))
    assert.ok(text.includes('### Hoja: "Inventario"'), 'Debe titular la hoja')
    assert.ok(text.includes('| Código | Item | Cantidad |'), 'Debe tener tabla Markdown')
    assert.ok(text.includes('Harina 000'), 'Debe tener datos de filas')
  })

  // 3. Test Word (.docx) extraction con fallback XML
  await test('Word (.docx) extrae texto vía contenedor Zip/XML si mammoth no está disponible', async () => {
    const zip = new AdmZip()
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Especificación del Módulo de Facturación</w:t></w:r></w:p>
        <w:p><w:r><w:t>El sistema debe emitir facturas tipo A y B.</w:t></w:r></w:p>
      </w:body>
    </w:document>`
    zip.addFile('word/document.xml', Buffer.from(docXml, 'utf-8'))
    const docxBuffer = zip.toBuffer()

    const text = await extractDocxText(docxBuffer)
    assert.ok(text.includes('Especificación del Módulo de Facturación'), 'Debe extraer título de párrafo')
    assert.ok(text.includes('El sistema debe emitir facturas tipo A y B'), 'Debe extraer cuerpo del documento')
  })

  // 4. Test PDF extraction
  await test('PDF con texto plano y fallback multimodal', async () => {
    // PDF simulado con stream de texto
    const fakePdfText = 'Requerimientos técnicos del cliente para FlowPro'
    const pdfRaw = `%PDF-1.4
1 0 obj << /Length 60 >>
stream
BT
/F1 12 Tf
(${fakePdfText}) Tj
ET
endstream
endobj
%%EOF`
    const extracted = extractPdfText(Buffer.from(pdfRaw, 'latin1'), 'contrato.pdf')
    assert.ok(extracted.includes(fakePdfText), 'Debe extraer texto de bloques BT...ET')

    // PDF escaneado (sin bloques de texto)
    const emptyPdf = '%PDF-1.4\n1 0 obj << >>\nendobj\n%%EOF'
    const fallback = extractPdfText(Buffer.from(emptyPdf, 'latin1'), 'escaneado.pdf')
    assert.ok(fallback.includes('escaneado.pdf'), 'Debe indicar que está adjunto en formato nativo')
  })

  // 5. Test isExtractableDocument
  await test('isExtractableDocument detecta extensiones y mimes universales', () => {
    assert.ok(isExtractableDocument('reporte.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))
    assert.ok(isExtractableDocument('datos.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
    assert.ok(isExtractableDocument('precios.csv', 'text/csv'))
    assert.ok(isExtractableDocument('dump.sql', 'application/sql'))
    assert.ok(isExtractableDocument('schema.json', 'application/json'))
    assert.ok(isExtractableDocument('nota.txt', 'text/plain'))
    assert.ok(isExtractableDocument('manual.pdf', 'application/pdf'))
    assert.equal(isExtractableDocument('foto.png', 'image/png'), false)
  })

  // 6. Test Express y Multer limits
  await test('Express y Multer están configurados con límite de 50MB', () => {
    const indexPath = path.resolve('backend/src/index.js')
    const indexContent = fs.readFileSync(indexPath, 'utf-8')
    assert.ok(indexContent.includes("express.json({ limit: '50mb' })"), 'express.json debe ser 50mb')
    assert.ok(indexContent.includes("express.urlencoded({ limit: '50mb'"), 'express.urlencoded debe ser 50mb')

    const convoPath = path.resolve('backend/src/routes/conversations.js')
    const convoContent = fs.readFileSync(convoPath, 'utf-8')
    assert.ok(convoContent.includes('limits: { fileSize: 50 * 1024 * 1024 }'), 'multer debe tener 50MB de límite')
    assert.ok(convoContent.includes('MAX_ATTACHMENTS = 10'), 'MAX_ATTACHMENTS debe ser 10')
  })

  // 7. Test Inyección de Documentos en agent.js
  await test('agent.js formatea adjuntos con encabezado íntegro y directiva negativa estricta', () => {
    const agentPath = path.resolve('backend/src/services/agent.js')
    const agentContent = fs.readFileSync(agentPath, 'utf-8')
    assert.ok(agentContent.includes('=== CONTENIDO ÍNTEGRO DEL DOCUMENTO ADJUNTO POR EL USUARIO'), 'Debe tener encabezado formal')
    assert.ok(agentContent.includes('=== FIN DEL DOCUMENTO ADJUNTO ==='), 'Debe tener fin de bloque')
    assert.ok(agentContent.includes('Está ESTRICTAMENTE PROHIBIDO responder preguntando al usuario cómo facilitarte los datos'), 'Debe prohibir pedir datos al usuario')
  })

  // 8. Test attachmentStore en frontend
  await test('attachmentStore guarda y recupera adjuntos en memoria', async () => {
    const storePath = path.resolve('frontend/src/lib/attachmentStore.js')
    assert.ok(fs.existsSync(storePath), 'attachmentStore.js debe existir')
    const { setPendingAttachments, getPendingAttachments, clearPendingAttachments } = await import('../frontend/src/lib/attachmentStore.js')
    
    const mockFiles = [{ name: 'balance.xlsx' }]
    setPendingAttachments('proj-test-123', mockFiles)
    const retrieved = getPendingAttachments('proj-test-123')
    assert.deepEqual(retrieved, mockFiles)
    clearPendingAttachments('proj-test-123')
    assert.equal(getPendingAttachments('proj-test-123'), null)
  })

  // 9. Test api.js resiliente y supresión de unload
  await test('api.js exporta isUnloading y contiene resilientFetch con backoff', () => {
    const apiPath = path.resolve('frontend/src/lib/api.js')
    const apiContent = fs.readFileSync(apiPath, 'utf-8')
    assert.ok(apiContent.includes('export function isUnloading()'), 'Debe exportar isUnloading()')
    assert.ok(apiContent.includes('async function resilientFetch('), 'Debe tener resilientFetch')
    assert.ok(apiContent.includes('delays = [600, 1500]'), 'Debe tener backoff con retrasos')
    assert.ok(apiContent.includes('beforeunload'), 'Debe escuchar beforeunload')
    assert.ok(apiContent.includes('pagehide'), 'Debe escuchar pagehide')
  })

  // 10. Test turn-status endpoint en conversations.js
  await test('conversations.js define ruta GET /:id/turn-status', () => {
    const convoPath = path.resolve('backend/src/routes/conversations.js')
    const convoContent = fs.readFileSync(convoPath, 'utf-8')
    assert.ok(convoContent.includes("conversationsRouter.get('/:id/turn-status'"), 'Debe existir la ruta /:id/turn-status')
    assert.ok(convoContent.includes('activeTurns.has(convo.id)'), 'Debe consultar activeTurns')
  })

  // 11. Test auto-recovery polling y turnStatus en api.js
  await test('api.js implementa recoverTurnFromPolling y expone turnStatus', () => {
    const apiPath = path.resolve('frontend/src/lib/api.js')
    const apiContent = fs.readFileSync(apiPath, 'utf-8')
    assert.ok(apiContent.includes('async function recoverTurnFromPolling('), 'Debe existir recoverTurnFromPolling')
    assert.ok(apiContent.includes('turnStatus: (id) => request(`/conversations/${id}/turn-status`)'), 'Debe exponer turnStatus')
    assert.ok(apiContent.includes('isMessagePost'), 'Debe proteger mutaciones POST contra reintentos ciegos')
  })

  // 12. Test Regla de Oro en agent.js (separación estricta de documentos vs imágenes)
  await test('agent.js aísla documentos, limpia base64 y nunca los envía como imágenes multimodales', () => {
    const agentPath = path.resolve('backend/src/services/agent.js')
    const agentContent = fs.readFileSync(agentPath, 'utf-8')
    assert.ok(agentContent.includes('Regla de Oro para Documentos'), 'Debe declarar la Regla de Oro')
    assert.ok(agentContent.includes('if (a.base64) a.base64 = undefined'), 'Debe limpiar binario pesado de base64')
    assert.ok(agentContent.includes("(a.kind === 'image' || a.mimeType?.startsWith('image/'))"), 'Solo imágenes quedan en attachments')
  })

  // 13. Test Nginx Anti-Timeout & Zero-Buffering
  await test('Nginx gitflow config tiene proxy_buffering off y chunked_transfer_encoding on', () => {
    let nginxPath = path.resolve('infra/nginx/gitflow')
    if (!fs.existsSync(nginxPath) && fs.existsSync('/etc/nginx/sites-available/gitflow')) {
      nginxPath = '/etc/nginx/sites-available/gitflow'
    }
    assert.ok(fs.existsSync(nginxPath), 'Configuración de nginx gitflow debe existir')
    const nginxContent = fs.readFileSync(nginxPath, 'utf-8')
    assert.ok(nginxContent.includes('proxy_buffering off;'), 'Debe desactivar proxy buffering')
    assert.ok(nginxContent.includes('chunked_transfer_encoding on;'), 'Debe activar chunked transfer encoding')
    assert.ok(nginxContent.includes('client_max_body_size 50M;'), 'Debe mantener límite de 50MB')
  })

  // 14. Test Endpoints Desacoplados de Parseo de Adjuntos en conversations.js
  await test('conversations.js expone endpoints rápidos /parse-attachments y /parse-attachments-json', () => {
    const convoPath = path.resolve('backend/src/routes/conversations.js')
    const convoContent = fs.readFileSync(convoPath, 'utf-8')
    assert.ok(convoContent.includes("conversationsRouter.post('/:id/parse-attachments'"), 'Debe existir /parse-attachments')
    assert.ok(convoContent.includes("conversationsRouter.post('/:id/parse-attachments-json'"), 'Debe existir /parse-attachments-json')
    assert.ok(convoContent.includes('attachments: req.body.attachments || []'), 'messages route debe aceptar attachments procesados')
  })

  // 15. Test Desacoplamiento en api.js (Subida JSON/Multipart -> Inicio SSE estándar)
  await test('api.js desacopla la extracción del archivo del stream SSE', () => {
    const apiPath = path.resolve('frontend/src/lib/api.js')
    const apiContent = fs.readFileSync(apiPath, 'utf-8')
    assert.ok(apiContent.includes('/parse-attachments'), 'sendMessageWithAttachments debe llamar primero a /parse-attachments')
    assert.ok(apiContent.includes('/parse-attachments-json'), 'sendMessageWithAttachments debe tener fallback JSON')
    assert.ok(apiContent.includes("streamRequest(`/conversations/${id}/messages`"), 'sendMessageWithAttachments debe iniciar turno vía /messages estándar')
    assert.ok(apiContent.includes('function fileToBase64('), 'Debe tener helper fileToBase64')
  })

  // 16. Test Extracción de Imágenes Incrustadas en .docx (FASE 8)
  await test('[FASE 8] extractDocxAssets: extrae image1.png con publicPath /doc-assets/ y marcador [IMAGEN AQUI]', async () => {
    // Crear un .docx mínimo válido en memoria con word/media/image1.png incrustada
    const { extractDocxAssets } = await import('../backend/src/services/attachmentProcessor.js')

    const zip = new AdmZip()

    // word/document.xml con drawing que referencia imagen
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:t>Logo de la empresa</w:t></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:extent cx="2032000" cy="609600"/>
            <a:graphic>
              <a:graphicData>
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:blipFill>
                    <a:blip r:embed="rId1"/>
                  </pic:blipFill>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p><w:r><w:t>Texto del documento</w:t></w:r></w:p>
  </w:body>
</w:document>`

    // word/_rels/document.xml.rels con relación rId1 -> media/image1.png
    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`

    // Crear imagen PNG mínima válida (1x1 px rojo)
    const minPng = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000' +
      '0090wc3d0000000c4944415408d7636cf8cf000000020001e221bc33' +
      '0000000049454e44ae426082', 'hex'
    )
    // Si hex inválido, usar un buffer simple pero no vacío
    const pngBuffer = minPng.length > 8 ? minPng : Buffer.from('PNG_PLACEHOLDER_DATA_FOR_TEST_12345678901234567890', 'utf-8')

    zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf-8'))
    zip.addFile('word/_rels/document.xml.rels', Buffer.from(relsXml, 'utf-8'))
    zip.addFile('word/media/image1.png', pngBuffer)
    zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, 'utf-8'))

    const docxBuffer = zip.toBuffer()
    const result = extractDocxAssets(docxBuffer)

    assert.ok(result && typeof result === 'object', 'extractDocxAssets debe retornar un objeto')
    assert.ok(Array.isArray(result.extractedAssets), 'Debe incluir extractedAssets array')
    assert.ok(result.extractedAssets.length > 0, `Debe encontrar al menos 1 imagen (encontradas: ${result.extractedAssets.length})`)

    const asset = result.extractedAssets[0]
    assert.ok(asset.fileName === 'image1.png', `fileName debe ser image1.png (obtenido: ${asset.fileName})`)
    assert.ok(asset.publicPath === '/doc-assets/image1.png', `publicPath debe ser /doc-assets/image1.png (obtenido: ${asset.publicPath})`)
    assert.ok(asset.base64 && asset.base64.length > 0, 'base64 debe estar presente')
    assert.ok(asset.mimeType === 'image/png', `mimeType debe ser image/png (obtenido: ${asset.mimeType})`)
    assert.ok(asset.isMultimodal === true, 'Primera imagen debe estar marcada como multimodal')
  })

  // 17. Test Catálogo de Activos en agent.js y prohibición de inventar logos SVG
  await test('[FASE 8] agent.js contiene REGLA OBLIGATORIA de imágenes /doc-assets/ y prohibición de SVG falso', () => {
    const agentPath = path.resolve('backend/src/services/agent.js')
    const agentContent = fs.readFileSync(agentPath, 'utf-8')
    assert.ok(agentContent.includes('IMÁGENES Y LOGOS EXTRAÍDOS DEL DOCUMENTO ADJUNTO'), 'Debe existir sección de catálogo de activos')
    assert.ok(agentContent.includes('/doc-assets/'), 'Debe mencionar ruta /doc-assets/')
    assert.ok(agentContent.includes('NUNCA inventes logos falsos dibujados con SVG'), 'Debe prohibir SVG falso')
    assert.ok(agentContent.includes('no puedes depositar archivos binarios'), 'Debe prohibir la respuesta incorrecta histórica')
    assert.ok(agentContent.includes('extractedAssets'), 'Debe procesar extractedAssets de documentos adjuntos')
    assert.ok(agentContent.includes('isMultimodal'), 'Debe filtrar imágenes para visión multimodal')
  })

  // 18. Test Persistencia Previa en conversationTurn.js y persistExtractedAssets
  await test('[FASE 8] conversationTurn.js persiste doc-assets antes del LLM y AttachmentProcessor.persistExtractedAssets escribe a disco', () => {
    const turnPath = path.resolve('backend/src/services/conversationTurn.js')
    const turnContent = fs.readFileSync(turnPath, 'utf-8')
    assert.ok(turnContent.includes('PERSISTENCIA FÍSICA AUTOMÁTICA DE ACTIVOS'), 'Debe incluir persistencia previa en conversationTurn.js')
    assert.ok(turnContent.includes('public/doc-assets/'), 'Debe persistir en public/doc-assets/')
    assert.ok(turnContent.includes('writeProjectFile'), 'Debe usar writeProjectFile para guardar en project_files')

    // Verificar helper persistExtractedAssets en disco temporal
    const testDir = path.resolve('scratch_test_assets')
    try {
      const written = AttachmentProcessor.persistExtractedAssets([
        { fileName: 'test-logo.png', base64: Buffer.from('test').toString('base64') }
      ], testDir)
      assert.equal(written, 1, 'Debe escribir 1 archivo')
      assert.ok(fs.existsSync(path.join(testDir, 'public', 'doc-assets', 'test-logo.png')), 'Archivo debe existir en disco')
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  console.log(`\n--- RESULTADOS FASE 7 & 8: ${passed} PASARON, ${failed} FALLARON ---`)
  if (failed > 0) process.exit(1)
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas:', err)
  process.exit(1)
})
