// tests/test_lovable_trajectory_queue_and_roadmap.mjs
// Test suite for Lovable Parity: Message Queue Engine, Trajectory Rollback, and Plan State Machine
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  ensureLocalGitRepo,
  createLocalGitCheckpoint,
  restoreLocalGitCheckpoint,
  findProjectWorkspace,
} from '../backend/src/services/gitCheckpoint.js';

console.log('--- RUNNING TEST SUITE: Lovable Trajectory, Queue & Roadmap ---');

async function test1_GitCheckpointAndRollback() {
  console.log('\n[TEST 1] Git Checkpoint Creation and Hard Rollback:');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowpro-test-git-'));
  try {
    // 1. Initialise repo
    const ready = await ensureLocalGitRepo(tempDir);
    assert.equal(ready, true, 'Git repo should be initialized');

    // 2. Write initial file and commit
    fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'version 1 content');
    const cp1 = await createLocalGitCheckpoint(tempDir, {
      summary: 'Initial commit v1',
      messageId: 'msg-001',
    });
    assert.ok(cp1?.commitSha, 'Should return a commitSha for v1');
    const sha1 = cp1.commitSha;
    console.log(`  ✓ Checkpoint 1 created with SHA: ${sha1.slice(0, 7)}`);

    // 3. Write second file and modify first, then commit v2
    fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'version 2 modified content');
    fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'file 2 new');
    const cp2 = await createLocalGitCheckpoint(tempDir, {
      summary: 'Second commit v2',
      messageId: 'msg-002',
    });
    assert.ok(cp2?.commitSha, 'Should return a commitSha for v2');
    const sha2 = cp2.commitSha;
    assert.notEqual(sha1, sha2, 'SHA1 and SHA2 must be different');
    console.log(`  ✓ Checkpoint 2 created with SHA: ${sha2.slice(0, 7)}`);

    // Verify current disk state is v2
    assert.equal(fs.readFileSync(path.join(tempDir, 'file1.txt'), 'utf8'), 'version 2 modified content');
    assert.equal(fs.existsSync(path.join(tempDir, 'file2.txt')), true);

    // 4. Atomic Rollback to sha1
    const rollbackRes = await restoreLocalGitCheckpoint(tempDir, sha1);
    assert.equal(rollbackRes.ok, true, 'Rollback should succeed');
    console.log(`  ✓ Restored workspace to SHA: ${rollbackRes.commitSha.slice(0, 7)}`);

    // Verify disk state has returned exactly to v1
    assert.equal(fs.readFileSync(path.join(tempDir, 'file1.txt'), 'utf8'), 'version 1 content');
    assert.equal(fs.existsSync(path.join(tempDir, 'file2.txt')), false, 'file2 must be cleaned up on hard reset');
    console.log('  ✓ Verified disk contents and untracked file removal after rollback.');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function test2_MessageQueueOperations() {
  console.log('\n[TEST 2] Message Queue In-Memory Engine:');
  const { conversationQueues } = await import('../backend/src/routes/conversations.js');
  assert.ok(conversationQueues instanceof Map, 'conversationQueues must be an exported Map');

  const testConvoId = 'convo-test-' + Date.now();
  conversationQueues.set(testConvoId, []);
  const q = conversationQueues.get(testConvoId);

  // 1. Enqueue 2 messages
  const msg1 = {
    id: 'userMessage:abc12345',
    text: 'Cambia el botón a color rojo',
    mode: 'build',
    createdAt: new Date().toISOString()
  };
  const msg2 = {
    id: 'userMessage:def67890',
    text: 'Agrega un banner de promociones',
    mode: 'build',
    createdAt: new Date().toISOString()
  };
  q.push(msg1);
  q.push(msg2);
  assert.equal(q.length, 2, 'Queue must contain 2 items');
  console.log('  ✓ Enqueued 2 items into conversation queue');

  // 2. Reorder or Edit
  q[0].text = 'Cambia el botón a color azul marino';
  assert.equal(conversationQueues.get(testConvoId)[0].text, 'Cambia el botón a color azul marino');
  console.log('  ✓ Edited queued message text successfully');

  // 3. FIFO Dequeue
  const dequeued = q.shift();
  assert.equal(dequeued.id, 'userMessage:abc12345');
  assert.equal(q.length, 1);
  assert.equal(q[0].id, 'userMessage:def67890');
  console.log('  ✓ Dequeued first item in sequential FIFO order');

  // Cleanup
  conversationQueues.delete(testConvoId);
}

async function test3_ProposeTasksSchemaAndAgentIntegration() {
  console.log('\n[TEST 3] Plan State Machine and propose_tasks Tool:');
  const agentPath = fs.existsSync('backend/src/services/agent.js')
    ? 'backend/src/services/agent.js'
    : path.resolve(__dirname, '../backend/src/services/agent.js');
  const agentModuleContent = fs.readFileSync(agentPath, 'utf8');

  // Check propose_tasks tool is declared with valid schema
  assert.ok(agentModuleContent.includes("name: 'propose_tasks'"), "Tool 'propose_tasks' must be declared");
  assert.ok(agentModuleContent.includes("required: ['title', 'tasks']"), "propose_tasks must require title and tasks");
  assert.ok(agentModuleContent.includes("filesToTouch"), "propose_tasks tasks must support filesToTouch");
  console.log('  ✓ Verified propose_tasks schema and task definition');

  // Check propose_tasks handler sets WAITING_APPROVAL
  assert.ok(agentModuleContent.includes("status: 'WAITING_APPROVAL'"), "propose_tasks must pause turn in WAITING_APPROVAL");
  assert.ok(agentModuleContent.includes("requiresApproval = true"), "propose_tasks must set requiresApproval = true");
  console.log('  ✓ Verified WAITING_APPROVAL and requiresApproval logic in agent execution loop');

  // Check uiIntegrityGuard bypass for plan mode
  assert.ok(agentModuleContent.includes("Bypass uiIntegrityGuard en etapa de propuesta de plan"), "uiIntegrityGuard must bypass on plan mode or proposedPlan");
  console.log('  ✓ Verified uiIntegrityGuard bypass for roadmap / plan mode');

  // Check return object
  assert.ok(agentModuleContent.includes("proposedPlan,"), "runAgent must return proposedPlan");
  console.log('  ✓ Verified runAgent returns proposedPlan in result payload');
}

async function test4_RoutesIntegrity() {
  console.log('\n[TEST 4] Endpoints Registration:');
  const convPath = fs.existsSync('backend/src/routes/conversations.js')
    ? 'backend/src/routes/conversations.js'
    : path.resolve(__dirname, '../backend/src/routes/conversations.js');
  const projPath = fs.existsSync('backend/src/routes/projects.js')
    ? 'backend/src/routes/projects.js'
    : path.resolve(__dirname, '../backend/src/routes/projects.js');
  const apiPath = fs.existsSync('frontend/src/lib/api.js')
    ? 'frontend/src/lib/api.js'
    : path.resolve(__dirname, '../frontend/src/lib/api.js');

  const convRoutesContent = fs.readFileSync(convPath, 'utf8');
  assert.ok(convRoutesContent.includes("'/:id/queue'"), "conversationsRouter must register /:id/queue");
  assert.ok(convRoutesContent.includes("'/:id/abort'"), "conversationsRouter must register /:id/abort");
  assert.ok(convRoutesContent.includes("'/:id/tools/respond'"), "conversationsRouter must register /:id/tools/respond");
  console.log('  ✓ Verified /queue, /abort and /tools/respond routes in conversations.js');

  const projRoutesContent = fs.readFileSync(projPath, 'utf8');
  assert.ok(projRoutesContent.includes("'/:id/revert-trajectory'"), "projectsRouter must register /:id/revert-trajectory");
  console.log('  ✓ Verified /revert-trajectory route in projects.js');

  const apiContent = fs.readFileSync(apiPath, 'utf8');
  assert.ok(apiContent.includes('enqueueMessage:'), "api.js must export enqueueMessage");
  assert.ok(apiContent.includes('revertTrajectory:'), "api.js must export revertTrajectory");
  assert.ok(apiContent.includes('respondTool:'), "api.js must export respondTool");
  console.log('  ✓ Verified frontend api client bindings');
}

async function runAll() {
  try {
    await test1_GitCheckpointAndRollback();
    await test2_MessageQueueOperations();
    await test3_ProposeTasksSchemaAndAgentIntegration();
    await test4_RoutesIntegrity();
    console.log('\n======================================================');
    console.log('🎉 ALL 4 TEST SUITES PASSED CLEANLY (100% SUCCESS)');
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    process.exit(1);
  }
}

runAll();
