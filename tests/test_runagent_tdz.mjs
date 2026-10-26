import assert from 'node:assert'
import { runAgent } from '../backend/src/services/agent.js'

async function testRunAgentInitialization() {
  console.log('Testing runAgent initialization without TDZ errors...')
  
  const mockProject = {
    id: 'test-proj-id',
    repo_full_name: 'test-owner/test-repo',
    branch: 'main'
  }

  try {
    // Run with a casual or query prompt, should execute through prompt preparation and intent classification
    const result = await runAgent({
      agentId: 'test-agent',
      accessToken: 'dummy-token',
      project: mockProject,
      history: [],
      userMessage: 'Hola, ¿cómo estás?',
      signal: new AbortController().signal,
      mode: 'chat',
      onProgress: () => {},
      ownerKey: null,
      rawAttachments: []
    })

    console.log('runAgent response received:', result?.text ? 'OK' : 'EMPTY')
    assert(result, 'Result must exist')
    console.log('✅ runAgent initialized and executed successfully with ZERO TDZ / ReferenceErrors!')
  } catch (err) {
    if (err.message && err.message.includes("Cannot access 'treePaths' before initialization")) {
      console.error('❌ FAILED: treePaths TDZ error still present!')
      process.exit(1)
    }
    // Network errors talking to GitHub/Supabase/LLM are expected in mock, but NOT ReferenceError
    if (err instanceof ReferenceError) {
      console.error('❌ FAILED with ReferenceError:', err)
      process.exit(1)
    }
    console.log('Caught expected external service error (no TDZ):', err.message)
    console.log('✅ runAgent passed TDZ verification!')
  }
}

testRunAgentInitialization().catch(err => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
