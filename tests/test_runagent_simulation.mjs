import assert from 'node:assert'
import { runAgent } from '../backend/src/services/agent.js'

async function runCompleteAgentSimulation() {
  console.log('=== SIMULATING RUNAGENT FULL EXECUTION PIPELINE ===')

  const mockProject = {
    id: 'test-proj-sim',
    repo_full_name: 'test-owner/test-sim-repo',
    branch: 'main'
  }

  // 1. Test project reset branch
  console.log('1. Testing project reset execution branch...')
  try {
    await runAgent({
      agentId: 'test-agent',
      accessToken: 'dummy-token',
      project: mockProject,
      history: [],
      userMessage: 'borra el proyecto actual',
      signal: new AbortController().signal,
      mode: 'build',
      onProgress: () => {},
      ownerKey: null,
      rawAttachments: []
    })
  } catch (err) {
    assert(!(err instanceof ReferenceError), `ReferenceError caught: ${err.message}`)
  }
  console.log('✅ Project reset branch has no ReferenceErrors!')

  // 2. Test attachment and doc-assets catalog branch
  console.log('2. Testing doc-assets catalog branch...')
  try {
    await runAgent({
      agentId: 'test-agent',
      accessToken: 'dummy-token',
      project: mockProject,
      history: [],
      userMessage: 'haz una web para dar a conocer mis servicios a partir del brochure',
      signal: new AbortController().signal,
      mode: 'build',
      onProgress: () => {},
      ownerKey: null,
      rawAttachments: [
        {
          filename: 'brochure.pdf',
          mimeType: 'application/pdf',
          kind: 'pdf',
          extractedText: 'Empresa de servicios generales SERGESOL SAC',
          extractedAssets: [
            {
              fileName: 'logo.png',
              publicPath: '/doc-assets/logo.png',
              base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
              mimeType: 'image/png',
              contextHint: 'Logo corporativo'
            }
          ]
        }
      ]
    })
  } catch (err) {
    assert(!(err instanceof ReferenceError), `ReferenceError caught: ${err.message}`)
  }
  console.log('✅ Attachment and doc-assets catalog branch has no ReferenceErrors!')

  // 3. Test SQL execution order branch
  console.log('3. Testing SQL execution order branch...')
  try {
    await runAgent({
      agentId: 'test-agent',
      accessToken: 'dummy-token',
      project: mockProject,
      history: [],
      userMessage: 'CREATE TABLE test_table (id serial primary key);',
      signal: new AbortController().signal,
      mode: 'build',
      onProgress: () => {},
      ownerKey: null,
      rawAttachments: []
    })
  } catch (err) {
    assert(!(err instanceof ReferenceError), `ReferenceError caught: ${err.message}`)
  }
  console.log('✅ SQL execution order branch has no ReferenceErrors!')

  console.log('\n🎉 ALL RUNAGENT SIMULATION BRANCHES PASSED WITH ZERO REFERENCEERRORS!')
}

runCompleteAgentSimulation().catch(err => {
  console.error('❌ SIMULATION FAILED:', err)
  process.exit(1)
})
