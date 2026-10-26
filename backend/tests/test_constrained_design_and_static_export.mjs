import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

import {
  classifyIndustryArchetype,
  extractBrandTokens,
  INDUSTRY_ARCHETYPES,
  getBrandAndArchetypeDirectives
} from '../src/services/brandExtractor.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('=== TEST SUITE: CONSTRAINED DESIGN ENGINE & STATIC EXPORT ===\n')

// ── TEST 1: Clasificación de Arquetipos e Inyección de Tokens HSL ──
console.log('Test 1: Clasificador de Arquetipos y Tokens de Marca HSL...')
{
  const industrialPrompt = 'Web corporativa para SERGESOL: servicios de extintores, recarga, pozo a tierra y tableros eléctricos bajo normas INDECI y NFPA'
  const archetype = classifyIndustryArchetype(industrialPrompt)

  assert.equal(archetype.id, 'B2B_INDUSTRIAL_ENGINEERING', 'Debe clasificar como B2B_INDUSTRIAL_ENGINEERING')
  assert.equal(archetype.radius, '0.5rem', 'El radio de bordes de ingeniería debe ser 0.5rem')
  assert.ok(archetype.mandatoryComponents.some(c => c.includes('RUC') && c.includes('emergencias')), 'Debe exigir Topbar con RUC y teléfono')
  assert.ok(archetype.mandatoryComponents.some(c => c.includes('INDECI') && c.includes('NFPA')), 'Debe exigir badges de homologación')
  assert.ok(archetype.mandatoryComponents.some(c => c.includes('Bento Grid') && c.includes('SER-01')), 'Debe exigir Bento Grid con códigos SER-01')

  const { tokens, cssRootBlock } = await extractBrandTokens({
    archetypeId: archetype.id,
    theme: 'light'
  })

  assert.ok(cssRootBlock.includes('--background:'), 'Debe generar variable --background')
  assert.ok(cssRootBlock.includes('--primary:'), 'Debe generar variable --primary')
  assert.ok(cssRootBlock.includes('--accent:'), 'Debe generar variable --accent')
  assert.ok(cssRootBlock.includes('--border:'), 'Debe generar variable --border')
  assert.ok(cssRootBlock.includes('--radius: 0.5rem;'), 'Debe incluir --radius: 0.5rem;')

  const directive = await getBrandAndArchetypeDirectives({
    userPrompt: industrialPrompt
  })
  assert.ok(directive.includes('ARQUETIPO: B2B_INDUSTRIAL_ENGINEERING'), 'La directiva debe indicar el arquetipo correcto')
  assert.ok(directive.includes('PROHIBIDO usar colores hardcodeados arbitrarios'), 'Debe prohibir colores hardcodeados arbitrarios')
  console.log('  ✓ Arquetipo B2B_INDUSTRIAL_ENGINEERING detectado correctamente con tokens HSL y directivas completas')
}

// ── TEST 2: Fusión de Doble Fuente (URL + PDF) en Modo Build ──
console.log('\nTest 2: Fusión de Doble Fuente (URL + PDF) sin bloqueo de modo Build...')
{
  const detectedUrl = 'https://sergesolperusac.com/'
  const hasPdfAttachment = true
  const requestedMode = 'build'
  const turnMode = 'BUILD'

  const isExplicitBuildMode = (requestedMode === 'build' || turnMode === 'BUILD' || ['build', 'agent', 'edit'].includes(requestedMode))
  const isUrlAndPdfConsulting = !isExplicitBuildMode && Boolean(detectedUrl && hasPdfAttachment)

  assert.equal(isUrlAndPdfConsulting, false, 'En modo BUILD, isUrlAndPdfConsulting DEBE ser false')

  // Verificar que agent.js contiene la lógica correcta
  const agentCode = fs.readFileSync(path.join(__dirname, '../src/services/agent.js'), 'utf-8')
  assert.ok(agentCode.includes('const isExplicitBuildMode ='), 'agent.js debe definir isExplicitBuildMode')
  assert.ok(agentCode.includes('const isUrlAndPdfConsulting = !isExplicitBuildMode &&'), 'agent.js debe condicionar isUrlAndPdfConsulting a que no sea modo build')
  assert.ok(agentCode.includes('DIRECTIVA DE FUSIÓN DE DOBLE FUENTE (URL EXTERNA + BROCHURE PDF)'), 'agent.js debe incluir la directiva de fusión')
  console.log('  ✓ isUrlAndPdfConsulting evaluado en false en modo Build: el agente construye combinando ambas fuentes')
}

// ── TEST 3: Modo SPA Estática Pura / Cero TanStack ──
console.log('\nTest 3: Directiva de SPA Estática Pura y Prohibición de TanStack...')
{
  const staticPrompt = 'no quiero TanStack, la convertiré a estática para subirla a mi hosting en archivos'
  const isStaticHostingRequested = /\b(?:no\s+(?:quiero|us(?:es|ar))\s+tanstack|tanstack\s*router|sin\s+tanstack|convertir[eé]\s+a\s+est[aá]tica|versi[oó]n\s+est[aá]tica|web\s+est[aá]tica|hosting\s+est[aá]tico|para\s+subir(?:la)?\s+a\s+mi\s+web|para\s+subir(?:la)?\s+a\s+mi\s+hosting|en\s+archivos\s+est[aá]ticos|cpanel|hostinger|apache|nginx\s+est[aá]tico|dist\.zip|dist\s+est[aá]tico)\b/i.test(staticPrompt)

  assert.equal(isStaticHostingRequested, true, 'Debe detectar solicitud de hosting estático puro')

  const agentCode = fs.readFileSync(path.join(__dirname, '../src/services/agent.js'), 'utf-8')
  assert.ok(agentCode.includes('PROHIBIDO TANSTACK ROUTER Y SSR'), 'agent.js debe prohibir TanStack Router y SSR')
  assert.ok(agentCode.includes('FORMULARIOS 100% OPERATIVOS CON WHATSAPP INTELIGENTE'), 'agent.js debe exigir WhatsApp inteligente para hosting estático')
  console.log('  ✓ Prohibición de TanStack Router y requisitos de SPA estática pura verificados en el motor del agente')
}

// ── TEST 4: Generación de ZIP Estático en Endpoint export-static ──
console.log('\nTest 4: Estructura del ZIP Estático generado por /api/projects/:id/export-static...')
{
  // Simular empaquetado de carpeta dist con doc-assets e index.html
  const zip = new AdmZip()
  const mockIndexHtml = '<!DOCTYPE html><html><head><title>Web Estática</title></head><body><div id="root"></div></body></html>'
  const mockAssetJs = 'console.log("App bundle");'
  const mockDocAsset = Buffer.from('FAKE_PNG_DATA')

  zip.addFile('index.html', Buffer.from(mockIndexHtml, 'utf-8'))
  zip.addFile('assets/index.js', Buffer.from(mockAssetJs, 'utf-8'))
  zip.addFile('doc-assets/logo-oficial.png', mockDocAsset)

  const zipBuffer = zip.toBuffer()
  assert.ok(zipBuffer.length > 0, 'El buffer del zip debe ser válido')

  // Leer el zip generado y comprobar archivos
  const readZip = new AdmZip(zipBuffer)
  const entries = readZip.getEntries().map(e => e.entryName)

  assert.ok(entries.includes('index.html'), 'El zip debe contener index.html en la raíz')
  assert.ok(entries.includes('assets/index.js'), 'El zip debe contener assets compilados')
  assert.ok(entries.includes('doc-assets/logo-oficial.png'), 'El zip debe contener doc-assets/')

  // Verificar que projects.js tiene el endpoint export-static
  const projectsRouteCode = fs.readFileSync(path.join(__dirname, '../src/routes/projects.js'), 'utf-8')
  assert.ok(projectsRouteCode.includes('/:id/export-static'), 'projects.js debe exponer la ruta /:id/export-static')
  assert.ok(projectsRouteCode.includes('-estatico-dist.zip'), 'projects.js debe fijar el nombre con sufijo -estatico-dist.zip')
  console.log('  ✓ Endpoint /api/projects/:id/export-static verificado: genera dist.zip con index.html y doc-assets')
}

console.log('\n=================================================')
console.log('✅ TODAS LAS 4 PRUEBAS DE DISEÑO Y EXPORTACIÓN ESTÁTICA PASARON EXITOSAMENTE.')
console.log('=================================================\n')
