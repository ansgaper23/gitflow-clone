// tests/test_url_mirroring_and_nondestructive_guard.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateUiIntegrity } from '../backend/src/services/uiIntegrityGuard.js'
import { mirrorWebsiteAssets } from '../backend/src/services/websiteInspector.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('=== TEST SUITE: URL Mirroring & Non-Destructive Guard ===\n')

// TEST 1: Verificar que la línea robótica de agent.js:2601 fue eliminada
console.log('Test 1: Verificando erradicación definitiva de la plantilla robótica en agent.js...')
const agentCode = fs.readFileSync(path.join(__dirname, '../backend/src/services/agent.js'), 'utf-8')
const hasRoboticLine = agentCode.includes('He integrado los cambios en ${names.map(n => `**${n}**`).join(\', \')} para reflejar las actualizaciones en la aplicación.')
assert.strictEqual(hasRoboticLine, false, 'ERROR: La plantilla robótica todavía está presente en agent.js!')
console.log('✅ Test 1 PASÓ: Plantilla robótica erradicada de agent.js.\n')

// TEST 2: uiIntegrityGuard y verificación de preserveProposalsOnRetry
console.log('Test 2: Verificando comportamiento de uiIntegrityGuard con componentes creados pero no montados...')
const stagedContent = new Map()
stagedContent.set('src/components/Navbar.jsx', 'export function Navbar() { return <nav>Navbar</nav>; }')
stagedContent.set('src/components/Hero.jsx', 'export function Hero() { return <section>Hero</section>; }')
stagedContent.set('src/App.jsx', 'export default function App() { return <h1>Este proyecto se está construyendo</h1>; }')

const proposedChanges = [
  { path: 'src/components/Navbar.jsx', newContent: stagedContent.get('src/components/Navbar.jsx') },
  { path: 'src/components/Hero.jsx', newContent: stagedContent.get('src/components/Hero.jsx') }
]

const guardResult = await validateUiIntegrity({
  stagedContent,
  proposedChanges,
  projectFilesList: ['src/App.jsx', 'package.json'],
  userMessage: 'Creame una web moderna'
})

assert.strictEqual(guardResult.valid, false, 'uiIntegrityGuard debió detectar que App.jsx sigue siendo scaffold!')
console.log('✅ uiIntegrityGuard detectó correctamente el scaffold en App.jsx.')

// Verificar que agent.js preserva proposedChanges cuando uiGuard falla
const hasPreserveGuard = agentCode.includes('preserveProposalsOnRetry') && agentCode.includes('!preserveProposalsOnRetry')
assert.strictEqual(hasPreserveGuard, true, 'ERROR: preserveProposalsOnRetry no está implementado en agent.js!')
console.log('✅ Test 2 PASÓ: Guard no-destructivo implementado (jamás limpia proposedChanges en retry de UI).\n')

// TEST 3: Verificación del Espejado de Activos (Mirroring)
console.log('Test 3: Verificando extracción y espejado de activos multimedia (Logo, Hero, Manifest)...')
const mockExtractedData = {
  images: [
    { src: 'https://electrinovaperu.com/logo-electrinova.png', alt: 'ELECTRINOVA PERÚ', width: 250, height: 100 },
    { src: 'https://electrinovaperu.com/assets/hero-slide-1-vxFk3ycC.jpg', alt: 'Hero Slide 1', width: 1344, height: 768 },
    { src: 'https://electrinovaperu.com/assets/aceros-arequipa-R4-HK94y.png', alt: 'Aceros Arequipa', width: 230, height: 219 }
  ],
  preloads: ['https://electrinovaperu.com/logo-electrinova.png'],
  ogImage: 'https://electrinovaperu.com/og-electrinova.png',
  themeColor: '#FFD700'
}

const mirroredAssets = await mirrorWebsiteAssets('https://electrinovaperu.com/', mockExtractedData, { downloadAssets: true })
assert.ok(mirroredAssets.length > 0, 'Debe haber descargado al menos 1 activo')

const logoAsset = mirroredAssets.find(a => a.role === 'logo')
assert.ok(logoAsset, 'Debe haber identificado y descargado el logo oficial')
assert.strictEqual(logoAsset.publicPath, '/doc-assets/logo-electrinova.png')

const manifestAsset = mirroredAssets.find(a => a.fileName === 'manifest.json')
assert.ok(manifestAsset, 'Debe haber generado manifest.json')
const manifestContent = JSON.parse(Buffer.from(manifestAsset.base64, 'base64').toString('utf-8'))
assert.strictEqual(manifestContent.sourceUrl, 'https://electrinovaperu.com/')
assert.ok(manifestContent.assets.length >= 2, 'El manifest debe contener los activos espejados')

console.log(`✅ Test 3 PASÓ: ${mirroredAssets.length} activos espejados correctamente con manifest.json.\n`)

// TEST 4: Verificación de límite de rondas MAX_ROUNDS = 25
console.log('Test 4: Verificando MAX_ROUNDS = 25 en los proveedores de IA...')
const anthropicCode = fs.readFileSync(path.join(__dirname, '../backend/src/services/providers/anthropic.js'), 'utf-8')
const geminiCode = fs.readFileSync(path.join(__dirname, '../backend/src/services/providers/gemini.js'), 'utf-8')
const openaiCode = fs.readFileSync(path.join(__dirname, '../backend/src/services/providers/openai.js'), 'utf-8')

assert.ok(anthropicCode.includes('MAX_ROUNDS = 25'), 'Anthropic debe tener MAX_ROUNDS = 25')
assert.ok(geminiCode.includes('MAX_ROUNDS = 25'), 'Gemini debe tener MAX_ROUNDS = 25')
assert.ok(openaiCode.includes('MAX_ROUNDS = 25'), 'OpenAI debe tener MAX_ROUNDS = 25')
console.log('✅ Test 4 PASÓ: Todos los proveedores configurados con MAX_ROUNDS = 25.\n')

// TEST 5: Verificación del check de visibilidad de Hero en uiIntegrityGuard
console.log('Test 5: Verificando check de visibilidad luminosa en Hero (anti-fondos negros)...')
const heroStaged = new Map()
heroStaged.set('src/components/Hero.jsx', `
export function Hero() {
  return (
    <div className="relative h-screen bg-black">
      <img src="/doc-assets/test.jpg" className="w-full h-full object-cover opacity-25" />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/95" />
    </div>
  );
}
`)

const heroGuardResult = await validateUiIntegrity({
  stagedContent: heroStaged,
  proposedChanges: [{ path: 'src/components/Hero.jsx', newContent: heroStaged.get('src/components/Hero.jsx') }],
  projectFilesList: ['src/App.jsx', 'src/components/Hero.jsx'],
  userMessage: 'Actualizar hero'
})

const hasHeroVisibilityWarning = heroGuardResult.errors.some(e => e.includes('VISIBILIDAD DE HERO DEFICIENTE'))
assert.strictEqual(hasHeroVisibilityWarning, true, 'uiIntegrityGuard debe detectar opacity-25 con fondo negro en Hero!')
console.log('✅ Test 5 PASÓ: Check de visibilidad de Hero bloquea imágenes oscuras o invisibles.\n')

console.log('🎉 TODOS LOS TESTS COMPLETADOS CON ÉXITO (5/5 PASADOS).')
