import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { isObsoleteProjectFile } from '../backend/src/services/projectReset.js'
import { extractPdfAssets, AttachmentProcessor } from '../backend/src/services/attachmentProcessor.js'
import { validateUiIntegrity } from '../backend/src/services/uiIntegrityGuard.js'

async function runTests() {
  console.log('=== TEST SUITE: PDF ASSET EXTRACTION & PERSISTENCE & INTEGRITY GUARD ===\n')

  // 1. Test isObsoleteProjectFile protects public/doc-assets/
  console.log('1. Testing projectReset preservation for doc-assets...')
  assert.strictEqual(isObsoleteProjectFile('public/doc-assets/logo.png'), false, 'public/doc-assets/logo.png must NOT be obsolete')
  assert.strictEqual(isObsoleteProjectFile('public/doc-assets/brochure-img-1.png'), false, 'public/doc-assets/ must be preserved')
  assert.strictEqual(isObsoleteProjectFile('doc-assets/sample.png'), false, 'doc-assets/ must be preserved')
  assert.strictEqual(isObsoleteProjectFile('src/components/Navbar.jsx'), true, 'components must be obsolete on hard reset')
  assert.strictEqual(isObsoleteProjectFile('src/App.jsx'), false, 'App.jsx is managed directly')
  console.log('✅ isObsoleteProjectFile correctly protects doc-assets!\n')

  // 2. Test extractPdfAssets interface and fallback resilience
  console.log('2. Testing extractPdfAssets function...')
  const dummyBuffer = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
  const { extractedAssets, renderedPages } = extractPdfAssets(dummyBuffer, 'test-brochure.pdf')
  assert(Array.isArray(extractedAssets), 'extractedAssets must be an array')
  assert(Array.isArray(renderedPages), 'renderedPages must be an array')
  console.log(`✅ extractPdfAssets safely handled dummy PDF without crashing: assets=${extractedAssets.length}, pages=${renderedPages.length}\n`)

  // 3. Test AttachmentProcessor.extractTextFull on PDF
  console.log('3. Testing AttachmentProcessor.extractTextFull on PDF...')
  const fullRes = await AttachmentProcessor.extractTextFull(dummyBuffer, 'test-brochure.pdf', 'application/pdf')
  assert(typeof fullRes.text === 'string', 'fullRes.text must be string')
  assert(Array.isArray(fullRes.extractedAssets), 'fullRes.extractedAssets must be array')
  console.log('✅ AttachmentProcessor.extractTextFull returns structured object for PDF!\n')

  // 4. Test uiIntegrityGuard blocks when servicesData or Navbar are touched but App.jsx is not integrated
  console.log('4. Testing uiIntegrityGuard service integration check...')
  const stagedContent = new Map()
  stagedContent.set('src/data/servicesData.js', 'export const services = [{ id: 1, name: "Consultoría" }];')
  stagedContent.set('src/components/Navbar.jsx', 'export function Navbar() { return <nav>Navbar</nav>; }')
  stagedContent.set('src/App.jsx', 'import React from "react"; export default function App() { return <div>Landing Page</div>; }')

  const proposedChanges = [
    { path: 'src/data/servicesData.js', type: 'create', isNew: true },
    { path: 'src/components/Navbar.jsx', type: 'create', isNew: true },
    { path: 'src/App.jsx', type: 'modify' }
  ]

  const guardResult = await validateUiIntegrity({
    stagedContent,
    proposedChanges,
    proposedDbChanges: [],
    projectFilesList: ['src/App.jsx', 'src/data/servicesData.js', 'src/components/Navbar.jsx'],
    userMessage: 'hazme una web profesional de servicios',
  })

  assert.strictEqual(guardResult.valid, false, 'Guard must reject when servicesData and Navbar are not imported in App.jsx')
  const hasIntegrationError = guardResult.errors.some(e => e.includes('ERROR DE INTEGRACIÓN'))
  assert.strictEqual(hasIntegrationError, true, 'Guard must emit integration error')
  console.log('✅ uiIntegrityGuard correctly rejected unintegrated servicesData and Navbar!\n')

  // 5. Test uiIntegrityGuard passes when App.jsx imports them
  console.log('5. Testing uiIntegrityGuard passes when App.jsx imports servicesData & Navbar...')
  stagedContent.set('src/App.jsx', `
    import React from 'react'
    import { Navbar } from './components/Navbar'
    import { services } from './data/servicesData'

    export default function App() {
      return (
        <div>
          <Navbar />
          <ul>{services.map(s => <li key={s.id}>{s.name}</li>)}</ul>
        </div>
      )
    }
  `)

  const guardResultPassed = await validateUiIntegrity({
    stagedContent,
    proposedChanges,
    proposedDbChanges: [],
    projectFilesList: ['src/App.jsx', 'src/data/servicesData.js', 'src/components/Navbar.jsx'],
    userMessage: 'hazme una web profesional de servicios',
  })

  const hasOrphanOrIntegrationError = guardResultPassed.errors.some(e => e.includes('ERROR DE INTEGRACIÓN') || e.includes('COMPONENTE HUÉRFANO'))
  assert.strictEqual(hasOrphanOrIntegrationError, false, 'Should have no orphan or integration errors when properly mounted')
  console.log('✅ uiIntegrityGuard passes when components are properly wired!\n')

  console.log('🎉 ALL INTEGRATION TESTS PASSED!')
}

runTests().catch(err => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
