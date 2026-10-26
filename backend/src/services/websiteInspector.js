// backend/src/services/websiteInspector.js
// INSPECTOR DE URLs EN VIVO + EXTRACTOR DE DATOS ESTRATÉGICOS + ESPEJADO DE ACTIVOS (FASE 7 & FASE 9)
// 1. Renderizado DOM Completo con Playwright / Chromium headless (espera networkidle / hidratación #root)
// 2. Extracción de estilos computados (getComputedStyle: theme-color, fuentes, fondos, botones)
// 3. Captura visual multimodal en alta resolución optimizada con sharp para el LLM
// 4. Escaneo profundo de bundles SPA (/assets/index-*.js y /assets/index-*.css)
// 5. Espejado Automático de Activos (Mirroring): descarga Logo oficial, Hero slides, logos de clientes
//    y fotos de proyectos hacia public/doc-assets/ y genera manifest.json local
// 6. Reporte de consultoría estratégica y arquitectura web senior

import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs'
import { extractPdfText, extractDominantPalette } from './attachmentProcessor.js'
import { writeProjectFile } from './projectStorage.js'

const SCRAPE_TIMEOUT_MS = 10000
const ASSET_DOWNLOAD_TIMEOUT_MS = 8000

/**
 * Extrae texto legible de una URL pública usando Jina.ai como proxy de scraping.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function scrapeUrlWithJina(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)
  try {
    const res = await fetch('https://r.jina.ai/' + encodeURIComponent(url), {
      signal: controller.signal,
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'markdown' }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Parsea HTML directo con regex para extraer meta tags
 * @param {string} html
 * @returns {object}
 */
function parseHtmlMeta(html) {
  const getMeta = (pattern) => {
    const m = pattern.exec(html)
    return m ? m[1].trim() : ''
  }
  return {
    title: getMeta(/<title[^>]*>([^<]+)<\/title>/i) || getMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    description: getMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    ogTitle: getMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i),
    ogDescription: getMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
    ogImage: getMeta(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i),
    themeColor: getMeta(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i),
    canonical: getMeta(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i),
    keywords: getMeta(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i),
  }
}

/**
 * Extrae enlaces de navegación del HTML
 */
function extractNavLinks(html) {
  const links = []
  const navMatch = html.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i)
  const searchArea = navMatch ? navMatch[1] : html.slice(0, Math.floor(html.length / 3))
  const anchorMatches = searchArea.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi)
  for (const m of anchorMatches) {
    const href = m[1]
    const text = m[2].trim()
    if (href && text && text.length > 1 && !href.startsWith('javascript') && !href.startsWith('#')) {
      links.push({ href, text })
    }
  }
  return links.slice(0, 20)
}

/**
 * Extrae datos de contacto (teléfono, email, WhatsApp, dirección, RUC) del texto
 * @param {string} text
 * @returns {{ phones: string[], emails: string[], whatsapp: string[], addresses: string[], ruc: string[] }}
 */
export function extractContactData(text) {
  const phones = []
  const emails = []
  const whatsapp = []
  const addresses = []
  const ruc = []

  // RUC Perú (11 dígitos comenzando en 10 o 20)
  const rucMatches = text.match(/\b(?:RUC|R\.U\.C\.?)?\s*([12]\d{10})\b/gi) || []
  for (const r of rucMatches) {
    const num = r.replace(/\D/g, '')
    if (num.length === 11 && !ruc.includes(num)) ruc.push(num)
  }

  // Teléfonos
  const phonePatterns = [
    /(\+?51[-.\s]?9\d{2}[-.\s]?\d{3}[-.\s]?\d{3})/g,
    /(9\d{2}[-.\s]?\d{3}[-.\s]?\d{3})/g,
    /(\(?01\)?[-.\s]?\d{3}[-.\s]?\d{4})/g,
  ]
  for (const pattern of phonePatterns) {
    let match
    const regex = new RegExp(pattern.source, 'g')
    while ((match = regex.exec(text)) !== null) {
      const cleaned = match[1].replace(/\s+/g, ' ').trim()
      if (cleaned.length >= 7 && cleaned.length <= 20 && !phones.includes(cleaned)) {
        phones.push(cleaned)
        const digits = cleaned.replace(/\D/g, '')
        if (/\d{9,}/.test(digits) && /9\d{2}/.test(digits)) {
          const waDigits = digits.length === 9 ? `51${digits}` : digits
          const waUrl = `https://wa.me/${waDigits}`
          if (!whatsapp.includes(waUrl)) whatsapp.push(waUrl)
        }
      }
    }
  }

  // Emails
  const emailPattern = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
  const emailMatches = text.match(emailPattern) || []
  for (const e of emailMatches) {
    const lower = e.toLowerCase()
    if (!emails.includes(e) && !lower.includes('example') && !lower.includes('test')) {
      emails.push(e)
    }
  }

  // Direcciones (heurística)
  const addrPattern = /(?:Av\.|Avda\.|Jr\.|Jr\.?|Calle|Pasaje|Pje\.|Pje)\s*[A-Z][^,\n]{5,60}/gi
  const addrMatches = text.match(addrPattern) || []
  for (const a of addrMatches) {
    const cleaned = a.trim()
    if (!addresses.includes(cleaned)) addresses.push(cleaned)
  }

  return { phones, emails, whatsapp, addresses, ruc }
}

/**
 * Extrae encabezados H1, H2, H3 del texto markdown
 * @param {string} text
 * @returns {{ h1: string[], h2: string[], h3: string[] }}
 */
function extractHeadings(text) {
  const h1 = []
  const h2 = []
  const h3 = []
  const lines = text.split('\n')
  for (const line of lines) {
    const trimmed = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim()
    if (!trimmed) continue
    if (line.startsWith('# ')) h1.push(trimmed)
    else if (line.startsWith('## ')) h2.push(trimmed)
    else if (line.startsWith('### ')) h3.push(trimmed)
  }
  return { h1, h2, h3 }
}

/**
 * Escanea bundles JS/CSS de una SPA para extraer rutas de activos e información oculta
 * @param {string} baseUrl
 * @param {string} html
 * @returns {Promise<object>}
 */
async function scanSpaBundle(baseUrl, html) {
  const foundImages = []
  const scriptMatches = html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)
  const cssMatches = html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/gi)

  const candidateUrls = []
  for (const m of scriptMatches) {
    if (m[1].includes('index') || m[1].includes('app') || m[1].includes('bundle') || m[1].includes('assets')) {
      candidateUrls.push(m[1])
    }
  }
  for (const m of cssMatches) {
    if (m[1].includes('index') || m[1].includes('app') || m[1].includes('assets')) {
      candidateUrls.push(m[1])
    }
  }

  for (const rel of candidateUrls.slice(0, 3)) {
    try {
      const fullUrl = new URL(rel, baseUrl).href
      const controller = new AbortController()
      const to = setTimeout(() => controller.abort(), 6000)
      const res = await fetch(fullUrl, { signal: controller.signal })
      clearTimeout(to)
      if (!res.ok) continue
      const text = await res.text()

      // Buscar rutas de imágenes en el bundle
      const imgRegex = /(?:\/assets\/|assets\/|["']\/)([\w-]+\.(?:png|jpg|jpeg|webp|svg))["']/gi
      let match
      while ((match = imgRegex.exec(text)) !== null) {
        const imgPath = match[0].replace(/["']/g, '').trim()
        if (!foundImages.includes(imgPath)) {
          foundImages.push(imgPath)
        }
      }
    } catch (_) {}
  }

  return { bundleImages: foundImages }
}

/**
 * Descarga y espeja activos multimedia de una URL hacia public/doc-assets/
 * @param {string} baseUrl
 * @param {object} extractedData
 * @param {object} options
 * @returns {Promise<Array<object>>}
 */
export async function mirrorWebsiteAssets(baseUrl, extractedData = {}, options = {}) {
  const { images = [], preloads = [], ogImage = '', themeColor = '#FFD700' } = extractedData
  const mirroredAssets = []
  const downloadedUrls = new Set()

  const resolveUrl = (src) => {
    try {
      return new URL(src, baseUrl).href
    } catch (_) {
      return null
    }
  }

  // 1. Identificar Logo Oficial
  let logoCandidate = preloads.find(p => /logo/i.test(p))
  if (!logoCandidate) {
    const logoImg = images.find(i => /logo/i.test(i.src) || /logo/i.test(i.alt) || /logo/i.test(i.className))
    if (logoImg) logoCandidate = logoImg.src
  }
  if (!logoCandidate && ogImage && /logo/i.test(ogImage)) {
    logoCandidate = ogImage
  }

  const assetQueue = []

  if (logoCandidate) {
    const fullLogo = resolveUrl(logoCandidate)
    if (fullLogo && !downloadedUrls.has(fullLogo)) {
      downloadedUrls.add(fullLogo)
      const ext = path.extname(new URL(fullLogo).pathname) || '.png'
      const baseName = path.basename(new URL(fullLogo).pathname, ext)
      const fileName = baseName.toLowerCase().includes('logo') ? `${baseName}${ext}` : `logo-oficial${ext}`
      assetQueue.push({
        url: fullLogo,
        fileName,
        role: 'logo',
        alt: 'Logo Oficial de la Empresa'
      })
    }
  }

  // 2. Identificar Hero Slides / Banners Principales
  const heroCandidates = images.filter(i =>
    /hero|slide|banner/i.test(i.src) ||
    /hero|slide|banner/i.test(i.alt) ||
    /hero|slide|banner/i.test(i.className) ||
    (i.width >= 800 && i.height >= 400)
  )

  let heroIdx = 1
  for (const img of heroCandidates.slice(0, 4)) {
    const full = resolveUrl(img.src)
    if (full && !downloadedUrls.has(full)) {
      downloadedUrls.add(full)
      const ext = path.extname(new URL(full).pathname) || '.jpg'
      const fileName = `hero-slide-${heroIdx}${ext}`
      assetQueue.push({
        url: full,
        fileName,
        role: 'hero',
        alt: img.alt || `Banner Hero ${heroIdx}`
      })
      heroIdx++
    }
  }

  // 3. Identificar Logos de Clientes / Marcas Asociadas
  const clientCandidates = images.filter(i =>
    (/logo|client|marca|partner/i.test(i.className) ||
     /logo\s+de/i.test(i.alt) ||
     /aceros|sunedu|nestle|cruz|southern|engie/i.test(i.src) ||
     /aceros|sunedu|nestle|cruz|southern|engie/i.test(i.alt)) &&
    !assetQueue.some(q => q.url === resolveUrl(i.src))
  )

  for (const img of clientCandidates.slice(0, 6)) {
    const full = resolveUrl(img.src)
    if (full && !downloadedUrls.has(full)) {
      downloadedUrls.add(full)
      const ext = path.extname(new URL(full).pathname) || '.png'
      const rawName = path.basename(new URL(full).pathname, ext).replace(/[-_][a-zA-Z0-9]{8,}$/, '')
      const fileName = `client-${rawName.toLowerCase()}${ext}`
      assetQueue.push({
        url: full,
        fileName,
        role: 'client',
        alt: img.alt || `Cliente ${rawName}`
      })
    }
  }

  // 4. Identificar Fotos de Proyectos o Servicios Ejecutados
  const projectCandidates = images.filter(i =>
    !downloadedUrls.has(resolveUrl(i.src)) &&
    (i.width >= 300 || i.height >= 200) &&
    !/logo|icon/i.test(i.src)
  )

  let projIdx = 1
  for (const img of projectCandidates.slice(0, 5)) {
    const full = resolveUrl(img.src)
    if (full && !downloadedUrls.has(full)) {
      downloadedUrls.add(full)
      const ext = path.extname(new URL(full).pathname) || '.jpeg'
      const rawName = path.basename(new URL(full).pathname, ext).replace(/[-_][a-zA-Z0-9]{8,}$/, '')
      const fileName = `project-${rawName.toLowerCase()}${ext}`
      assetQueue.push({
        url: full,
        fileName,
        role: 'project',
        alt: img.alt || `Proyecto ${projIdx}`
      })
      projIdx++
    }
  }

  // Descarga concurrente con salvaguarda de timeout
  await Promise.all(
    assetQueue.map(async (item) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), ASSET_DOWNLOAD_TIMEOUT_MS)
        const res = await fetch(item.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FlowPro/2.0' }
        })
        clearTimeout(timeout)
        if (!res.ok) return

        const arrayBuf = await res.arrayBuffer()
        const buffer = Buffer.from(arrayBuf)
        if (buffer.length < 500) return // descarte de imágenes corruptas o vacías

        const mime = res.headers.get('content-type') || (item.fileName.endsWith('.png') ? 'image/png' : 'image/jpeg')
        const publicPath = `/doc-assets/${item.fileName}`

        mirroredAssets.push({
          fileName: item.fileName,
          publicPath,
          base64: buffer.toString('base64'),
          mimeType: mime,
          role: item.role,
          alt: item.alt,
          sourceUrl: item.url,
          sizeBytes: buffer.length
        })
      } catch (err) {
        console.warn(`[mirrorWebsiteAssets] No se pudo descargar ${item.url}:`, err.message)
      }
    })
  )

  // 5. Generar Manifiesto de Activos (public/doc-assets/manifest.json)
  const manifestData = {
    sourceUrl: baseUrl,
    mirroredAt: new Date().toISOString(),
    themeColor,
    totalAssets: mirroredAssets.length,
    assets: mirroredAssets.map(a => ({
      fileName: a.fileName,
      publicPath: a.publicPath,
      role: a.role,
      alt: a.alt,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes
    }))
  }

  const manifestJson = JSON.stringify(manifestData, null, 2)
  mirroredAssets.push({
    fileName: 'manifest.json',
    publicPath: '/doc-assets/manifest.json',
    base64: Buffer.from(manifestJson, 'utf-8').toString('base64'),
    mimeType: 'application/json',
    role: 'manifest',
    alt: 'Catálogo de Recursos Espejados de la URL'
  })

  // 6. Persistencia física en workspaces del VPS si existen
  const previewsBase = '/opt/gitflow-previews'
  if (fs.existsSync(previewsBase)) {
    for (let i = 0; i < 5; i++) {
      const wsPath = path.join(previewsBase, `workspace-${i}`)
      if (fs.existsSync(wsPath)) {
        const targetDir = path.join(wsPath, 'public', 'doc-assets')
        try {
          fs.mkdirSync(targetDir, { recursive: true })
          for (const a of mirroredAssets) {
            fs.writeFileSync(path.join(targetDir, a.fileName), Buffer.from(a.base64, 'base64'))
          }
        } catch (_) {}
      }
    }
  }

  // 7. Persistencia opcional directa en repo si se facilitan project + accessToken
  if (options.project && options.accessToken) {
    try {
      for (const a of mirroredAssets) {
        await writeProjectFile(options.project, options.accessToken, {
          path: `public/doc-assets/${a.fileName}`,
          newContent: a.base64,
          summary: `[FlowPro Asset Mirroring] ${a.role}: ${a.fileName}`,
          contentIsBase64: true
        }).catch(() => {})
      }
    } catch (_) {}
  }

  return mirroredAssets
}

/**
 * Inspecciona una URL pública y devuelve un reporte estructurado completo con
 * Playwright headless, visión multimodal, diseño computado y espejado de activos.
 *
 * @param {string} url - URL pública a inspeccionar
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function inspectWebsiteUrl(url, options = {}) {
  let markdown = ''
  let htmlFallback = ''
  let scrapeError = null
  let screenshotBase64 = null
  let computedDesignSystem = null
  let designPalette = null
  let extractedDomImages = []
  let preloadLinks = []
  let ogImage = ''
  let themeColor = '#FFD700'
  let headings = { h1: [], h2: [], h3: [] }

  // 1. Renderizado visual, DOM completo e hidratación SPA vía Playwright / Chromium headless
  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FlowPro/2.0'
      })
      const page = await context.newPage()
      
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
      } catch (_) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 })
        await page.waitForTimeout(2000)
      }

      htmlFallback = await page.content()

      // Captura de screenshot visual multimodal
      try {
        const rawScreenshot = await page.screenshot({ type: 'png', fullPage: false })
        if (rawScreenshot && rawScreenshot.length > 0) {
          const opt = await sharp(rawScreenshot)
            .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer()
          screenshotBase64 = opt.toString('base64')

          try {
            designPalette = await extractDominantPalette(rawScreenshot)
          } catch (_) {}
        }
      } catch (screenErr) {
        console.warn('[inspectWebsiteUrl] Fallo en captura de screenshot:', screenErr.message)
      }

      // Reverse engineering de estilos computados y extracción del DOM hidratado
      const domData = await page.evaluate(() => {
        const bodyStyle = window.getComputedStyle(document.body)
        const h1 = document.querySelector('h1')
        const h1Style = h1 ? window.getComputedStyle(h1) : null
        const h2 = document.querySelector('h2')
        const h2Style = h2 ? window.getComputedStyle(h2) : null
        const btn = document.querySelector('button, a.btn, a[class*="button"], a[class*="btn"], input[type="submit"]')
        const btnStyle = btn ? window.getComputedStyle(btn) : null
        const nav = document.querySelector('nav, header')
        const navStyle = nav ? window.getComputedStyle(nav) : null

        const images = Array.from(document.querySelectorAll('img')).map(img => ({
          src: img.src,
          alt: img.alt || '',
          className: img.className || '',
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0,
        }))

        const preloads = Array.from(document.querySelectorAll('link[rel*="image"], link[as="image"]')).map(l => l.href)
        const og = document.querySelector('meta[property="og:image"]')?.content || ''
        const theme = document.querySelector('meta[name="theme-color"]')?.content || ''

        const h1s = Array.from(document.querySelectorAll('h1')).map(h => h.innerText.trim()).filter(Boolean)
        const h2s = Array.from(document.querySelectorAll('h2')).map(h => h.innerText.trim()).filter(Boolean)
        const h3s = Array.from(document.querySelectorAll('h3')).map(h => h.innerText.trim()).filter(Boolean)

        return {
          designSystem: {
            bodyBg: bodyStyle.backgroundColor,
            bodyColor: bodyStyle.color,
            fontFamily: bodyStyle.fontFamily,
            h1Font: h1Style ? `${h1Style.fontFamily} (${h1Style.fontSize}, ${h1Style.fontWeight})` : '',
            h1Color: h1Style ? h1Style.color : '',
            h2Font: h2Style ? `${h2Style.fontFamily} (${h2Style.fontSize})` : '',
            buttonBg: btnStyle ? btnStyle.backgroundColor : '',
            buttonColor: btnStyle ? btnStyle.color : '',
            buttonRadius: btnStyle ? btnStyle.borderRadius : '',
            navBg: navStyle ? navStyle.backgroundColor : '',
          },
          images,
          preloads,
          og,
          theme,
          headings: { h1: h1s, h2: h2s, h3: h3s }
        }
      })

      computedDesignSystem = domData.designSystem
      extractedDomImages = domData.images || []
      preloadLinks = domData.preloads || []
      ogImage = domData.og || ''
      themeColor = domData.theme || themeColor
      if (domData.headings?.h1?.length) headings = domData.headings

      await context.close()
    } finally {
      await browser.close()
    }
  } catch (browserErr) {
    console.warn('[inspectWebsiteUrl] Playwright no disponible o falló:', browserErr.message)
  }

  // 2. Scrape con Jina.ai para extraer texto de alta densidad si no tenemos markdown
  try {
    markdown = await scrapeUrlWithJina(url)
  } catch (e) {
    scrapeError = e.message
  }

  // 3. Si falla Jina o devolvió poco texto, usar htmlFallback o fetch HTML directo
  if (!markdown || markdown.length < 100) {
    if (!htmlFallback) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS)
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FlowPro/2.0', 'Accept': 'text/html' }
        })
        htmlFallback = await res.text()
        clearTimeout(timeout)
      } catch (_) {}
    }
    if (htmlFallback) {
      markdown = htmlFallback
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000)
    }
  }

  // 4. Escaneo profundo de SPA Bundles (/assets/index-*.js)
  let bundleImages = []
  if (htmlFallback) {
    try {
      const bundleData = await scanSpaBundle(url, htmlFallback)
      bundleImages = bundleData.bundleImages || []
    } catch (_) {}
  }

  // Combinar imágenes detectadas del DOM y del bundle
  const allImages = [...extractedDomImages]
  for (const bImg of bundleImages) {
    if (!allImages.some(i => i.src.endsWith(bImg))) {
      allImages.push({ src: bImg, alt: 'Activo de la aplicación', width: 800, height: 600 })
    }
  }

  // 5. Espejado de Activos Multimedia (descarga de Logo, Hero, Clientes a public/doc-assets/)
  let extractedAssets = []
  if (options.downloadAssets !== false) {
    try {
      extractedAssets = await mirrorWebsiteAssets(url, {
        images: allImages,
        preloads: preloadLinks,
        ogImage,
        html: htmlFallback,
        themeColor
      }, options)
    } catch (mirrorErr) {
      console.warn('[inspectWebsiteUrl] Error en espejado de activos:', mirrorErr.message)
    }
  }

  // 6. Extraer estructura y datos de contacto
  if (!headings.h1?.length) {
    headings = extractHeadings(markdown || '')
  }
  const contact = extractContactData((markdown || '') + ' ' + (htmlFallback || ''))
  const meta = htmlFallback ? parseHtmlMeta(htmlFallback) : {}
  const navLinks = htmlFallback ? extractNavLinks(htmlFallback) : []

  // 7. Extraer texto principal y keywords
  const bodyLines = (markdown || '').split('\n')
    .filter(l => !l.startsWith('#') && l.trim().length > 20)
    .slice(0, 100)
  const mainText = bodyLines.join(' ').replace(/\*\*/g, '').replace(/\*/g, '').slice(0, 3000)

  const wordFreq = {}
  const words = mainText.toLowerCase().match(/\b[a-záéíóúñ]{4,}\b/g) || []
  const stopWords = new Set([
    'para', 'como', 'esta', 'este', 'esto', 'todos', 'todas', 'sobre', 'donde',
    'cuando', 'porque', 'aunque', 'entre', 'desde', 'hasta', 'durante', 'ademas',
    'tambien', 'solo', 'sino', 'hacia', 'antes', 'despues', 'forma', 'parte',
    'caso', 'cada', 'mismo', 'misma', 'luego', 'ahora', 'asi', 'aqui', 'alli',
    'siempre', 'nunca', 'pero', 'tiene', 'tienen', 'ser', 'han', 'hay', 'fue',
    'son', 'que', 'los', 'las', 'una', 'unos', 'unas', 'por', 'mas', 'puede',
    'pueden', 'tener', 'hecho', 'hacer', 'hecha', 'pues', 'así'
  ])
  for (const w of words) {
    if (!stopWords.has(w)) wordFreq[w] = (wordFreq[w] || 0) + 1
  }
  const topKeywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word)

  // 8. Construir Resumen Estructurado y Catálogo de Activos Locales
  const logoAsset = extractedAssets.find(a => a.role === 'logo')
  const heroAssets = extractedAssets.filter(a => a.role === 'hero')
  const clientAssets = extractedAssets.filter(a => a.role === 'client')
  const projectAssets = extractedAssets.filter(a => a.role === 'project')

  const assetCatalogLines = [
    '📁 CATÁLOGO DE ACTIVOS ESPEJADOS EN /doc-assets/:',
    logoAsset ? `- LOGO OFICIAL: "${logoAsset.publicPath}" (USAR OBLIGATORIAMENTE EN NAVBAR Y FOOTER)` : '- LOGO: No encontrado',
    heroAssets.length ? `- HERO SLIDES: ${heroAssets.map(h => `"${h.publicPath}"`).join(', ')}` : '- HERO SLIDES: No descargadas',
    clientAssets.length ? `- CLIENTES/PARTNERS: ${clientAssets.map(c => `"${c.publicPath}"`).join(', ')}` : '- CLIENTES: No descargados',
    projectAssets.length ? `- PROYECTOS: ${projectAssets.map(p => `"${p.publicPath}"`).join(', ')}` : '- PROYECTOS: No descargados',
    `- MANIFIESTO COMPLETO: "/doc-assets/manifest.json"`
  ]

  const structuredSummary = [
    `=== INSPECCIÓN Y ESPEJADO DE URL: ${url} ===`,
    `Título: ${meta.title || headings.h1[0] || 'Sitio Web'}`,
    `Color Primario (Theme Color): ${themeColor}`,
    `Meta description: ${meta.description || '(sin meta description)'}`,
    `H1: ${headings.h1?.join(' | ') || 'sin H1'}`,
    `H2: ${headings.h2?.slice(0, 6).join(' | ') || 'sin H2'}`,
    ``,
    `DATOS DE CONTACTO:`,
    `• RUC: ${contact.ruc?.join(', ') || 'no detectado'}`,
    `• WhatsApp directo: ${contact.whatsapp?.join(', ') || 'no detectado'}`,
    `• Teléfonos: ${contact.phones?.join(', ') || 'no detectados'}`,
    `• Emails: ${contact.emails?.join(', ') || 'no detectados'}`,
    `• Direcciones: ${contact.addresses?.join(' | ') || 'no detectadas'}`,
    ``,
    `DISEÑO COMPUTADO:`,
    computedDesignSystem ? `• Fuentes: Body ${computedDesignSystem.fontFamily}, H1 ${computedDesignSystem.h1Font}` : '',
    computedDesignSystem ? `• Botones: Fondo ${computedDesignSystem.buttonBg}, Radio ${computedDesignSystem.buttonRadius}` : '',
    designPalette ? `• Paleta: Primario ${designPalette.primaryHex} (${designPalette.primaryHsl}), Secundario ${designPalette.secondaryHex}` : '',
    ``,
    ...assetCatalogLines,
    ``,
    `CONTENIDO TEXTUAL PRINCIPAL:`,
    mainText.slice(0, 1500)
  ].filter(Boolean).join('\n')

  return {
    url,
    title: meta.title || headings.h1[0] || '',
    description: meta.description || meta.ogDescription || '',
    ogImage,
    themeColor,
    headings,
    mainText,
    topKeywords,
    contact,
    navLinks,
    wordCount: (markdown || '').split(/\s+/).length,
    inspectedAt: new Date().toISOString(),
    scrapeMethod: screenshotBase64 ? 'playwright_visual' : 'html_direct',
    screenshotBase64,
    computedDesignSystem,
    designPalette,
    extractedAssets,
    manifest: extractedAssets.find(a => a.role === 'manifest'),
    structuredSummary
  }
}

export async function extractPdfContent(pdfData, filename = 'document.pdf') {
  try {
    const buffer = pdfData instanceof ArrayBuffer ? Buffer.from(pdfData) : Buffer.isBuffer(pdfData) ? pdfData : Buffer.from(pdfData, 'base64')
    return extractPdfText(buffer, filename)
  } catch {
    return ''
  }
}

/**
 * Produce el reporte de consultoría estratégica de nivel senior combinando
 * la inspección de URL + datos del PDF + conocimiento del negocio.
 * @param {object} params
 * @returns {string}
 */
export function buildStrategicConsultingReport({ url, pdfText = '', userMessage = '', inspectedData = {} }) {
  const { title, description, headings, contact, topKeywords, navLinks, wordCount, computedDesignSystem, designPalette, screenshotBase64, extractedAssets = [] } = inspectedData
  const realPhones = (contact?.phones || []).slice(0, 3)
  const realEmails = (contact?.emails || []).slice(0, 3)
  const realWhatsApp = (contact?.whatsapp || []).slice(0, 2)
  const realAddresses = (contact?.addresses || []).slice(0, 2)
  const logoAsset = extractedAssets.find(a => a.role === 'logo')

  return `\
# 🔍 AUDITORÍA ESTRATÉGICA Y REDISEÑO EDITORIAL — ${title || url}

**URL inspeccionada:** ${url}
**Fecha:** ${new Date().toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
**Volumen de contenido:** ~${Math.round(wordCount || 0)} palabras | **Método de Inspección:** ${inspectedData.scrapeMethod || 'playwright_visual'}
**Captura Visual en Vivo:** ${screenshotBase64 ? '✅ Captura 1280x800 renderizada y adjunta para visión multimodal' : '⚠️ Fallback de extracción de texto'}
**Logo Descargado:** ${logoAsset ? `✅ Guardado en \`${logoAsset.publicPath}\`` : '⚠️ Monograma'}

---

## 1. DIAGNÓSTICO DE POSICIONAMIENTO DE MARCA

### Título actual
${title ? `**"${title}"**` : '_Sin título detectable_'}

### Meta descripción (SEO)
${description ? `"${description}"` : '_No tiene meta description. Oportunidad crítica de SEO._'}

### Keywords dominantes del sitio actual
${topKeywords?.length ? topKeywords.map(k => `- ${k}`).join('\n') : '_No se detectaron keywords claras._'}

---

## 2. DATOS REALES EXTRAÍDOS

### Teléfono(s)
${realPhones.length ? realPhones.map(p => `📞 **${p}**`).join('\n') : '_No se detectaron teléfonos en la web._'}

### WhatsApp directo
${realWhatsApp.length ? realWhatsApp.map(w => `💬 **${w}**`).join('\n') : '_No se detectó botón de WhatsApp en la web._'}

### Correo(s)
${realEmails.length ? realEmails.map(e => `✉️ **${e}**`).join('\n') : '_No se detectaron correos._'}

### Dirección(es)
${realAddresses.length ? realAddresses.map(a => `📍 ${a}`).join('\n') : '_No se detectó dirección._'}

### Contenido principal (estructura de encabezados)
${headings?.h1?.length ? `**H1:**\n${headings.h1.map(h => `- ${h}`).join('\n')}\n` : ''}\
${headings?.h2?.length ? `**H2:**\n${headings.h2.map(h => `- ${h}`).join('\n')}\n` : ''}\
${headings?.h3?.length ? `**H3:**\n${headings.h3.map(h => `- ${h}`).join('\n')}\n` : ''}\

${pdfText ? `\
---

## 3. DATOS DEL BROCHURE/PDF ADJUNTO

${pdfText.slice(0, 5000)}${pdfText.length > 5000 ? '\n\n_(contenido truncado a 5000 caracteres)_' : ''}\
` : ''}\

---

## 4. INGENIERÍA INVERSA DE DISEÑO Y AUDITORÍA HEURÍSTICA UI/UX

### Sistema de Diseño Computado del Sitio Actual:
- **Color Primario Dominante:** ${designPalette?.primaryHex || computedDesignSystem?.buttonBg || '(no detectado)'} ${designPalette?.primaryHsl ? `(HSL: ${designPalette.primaryHsl})` : ''}
- **Fuentes:** Body ${computedDesignSystem?.fontFamily || 'sans-serif'}, H1 ${computedDesignSystem?.h1Font || 'sans-serif'}
- **Botones:** Fondo ${computedDesignSystem?.buttonBg || 'auto'}, Radio ${computedDesignSystem?.buttonRadius || 'rounded'}
`
}
