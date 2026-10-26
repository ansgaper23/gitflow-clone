// backend/src/services/gitCheckpoint.js
// GESTOR DE CHECKPOINTS GIT LOCALES Y ROLLBACK ATÓMICO (FLOWPRO)

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)

/**
 * Ejecuta un comando de Git de forma segura dentro del directorio de trabajo especificado.
 */
async function runGit(cwd, args) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    return { ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() }
  } catch (err) {
    return { ok: false, error: err.message, stderr: (err.stderr || '').trim() }
  }
}

/**
 * Garantiza que el directorio del proyecto tenga un repositorio Git local inicializado
 * y configurado con un autor por defecto para permitir commits atómicos.
 */
export async function ensureLocalGitRepo(workdir) {
  if (!workdir || !fs.existsSync(workdir)) return false

  const gitDir = path.join(workdir, '.git')
  if (!fs.existsSync(gitDir)) {
    const initRes = await runGit(workdir, ['init', '-b', 'main'])
    if (!initRes.ok) return false
  }

  // Asegurar autor y configuración mínima
  await runGit(workdir, ['config', 'user.name', 'FlowPro Agent'])
  await runGit(workdir, ['config', 'user.email', 'agent@flow-pro.online'])
  await runGit(workdir, ['config', 'commit.gpgsign', 'false'])

  // Crear .gitignore si no existe para no versionar node_modules ni caches
  const gitignorePath = path.join(workdir, '.gitignore')
  if (!fs.existsSync(gitignorePath)) {
    const defaultIgnores = 'node_modules\n.vite\ndist\n*.log\nenv-*.list\n'
    try { fs.writeFileSync(gitignorePath, defaultIgnores) } catch (_) {}
  }

  return true
}

/**
 * Crea un checkpoint Git local instantáneo del estado actual del workspace.
 */
export async function createLocalGitCheckpoint(workdir, { conversationId, messageId, summary, isPreTurn = false } = {}) {
  if (!workdir || !fs.existsSync(workdir)) return null

  const ready = await ensureLocalGitRepo(workdir)
  if (!ready) return null

  // Agregar todos los cambios al stage
  await runGit(workdir, ['add', '-A'])

  // Comprobar si hay cambios pendientes
  const statusRes = await runGit(workdir, ['status', '--porcelain'])
  if (statusRes.ok && !statusRes.stdout.trim()) {
    // No hay cambios respecto al último commit: obtener SHA actual
    const shaRes = await runGit(workdir, ['rev-parse', 'HEAD'])
    if (shaRes.ok && shaRes.stdout) {
      return { commitSha: shaRes.stdout.trim(), isClean: true }
    }
  }

  const prefix = isPreTurn ? '[PRE-TURN]' : '[CHECKPOINT]'
  const tag = messageId ? ` (${String(messageId).slice(0, 8)})` : (conversationId ? ` (${String(conversationId).slice(0, 8)})` : '')
  const cleanSummary = (summary || 'Instant snapshot').replace(/["\n\r]/g, ' ').slice(0, 100)
  const commitMsg = `FlowPro ${prefix}${tag}: ${cleanSummary}`

  const commitRes = await runGit(workdir, ['commit', '-m', commitMsg, '--no-verify', '--allow-empty'])
  if (!commitRes.ok) {
    console.warn('[GitCheckpoint] Warning al crear commit local:', commitRes.stderr || commitRes.error)
  }

  const shaRes = await runGit(workdir, ['rev-parse', 'HEAD'])
  const commitSha = shaRes.ok ? shaRes.stdout.trim() : null

  return { commitSha, isClean: false }
}

/**
 * Restaura instantáneamente el workspace local al commit SHA especificado (git reset --hard).
 */
export async function restoreLocalGitCheckpoint(workdir, commitSha) {
  if (!workdir || !fs.existsSync(workdir) || !commitSha) {
    return { ok: false, error: 'Faltan parámetros de restauración o el directorio no existe.' }
  }

  const ready = await ensureLocalGitRepo(workdir)
  if (!ready) {
    return { ok: false, error: 'No se pudo inicializar o verificar el repositorio Git local.' }
  }

  // 1. Reset forzoso al SHA
  const resetRes = await runGit(workdir, ['reset', '--hard', commitSha])
  if (!resetRes.ok) {
    return { ok: false, error: resetRes.stderr || resetRes.error }
  }

  // 2. Limpieza de archivos no versionados
  await runGit(workdir, ['clean', '-fd'])

  return { ok: true, commitSha }
}

/**
 * Localiza el directorio físico de trabajo para un proyecto dado.
 * Busca en los slots de preview /opt/gitflow-previews/workspace-0..9
 * o en el fallback /opt/gitflow-app/workspace/:id.
 */
export function findProjectWorkspace(project) {
  if (!project) return null
  const previewsBase = '/opt/gitflow-previews'
  if (fs.existsSync(previewsBase)) {
    for (let i = 0; i < 10; i++) {
      const ws = path.join(previewsBase, `workspace-${i}`)
      if (fs.existsSync(ws)) {
        try {
          const cfg = fs.readFileSync(path.join(ws, '.git', 'config'), 'utf-8')
          if (project.repo_full_name && cfg.includes(project.repo_full_name)) {
            return ws
          }
        } catch (_) {}
      }
    }
  }
  const appWs = `/opt/gitflow-app/workspace/${project.id}`
  if (fs.existsSync(appWs)) return appWs
  return null
}

// Aliases para máxima compatibilidad con orquestador y quickEdit
export const commitCheckpoint = (workdir, turnId, message) =>
  createLocalGitCheckpoint(workdir, { conversationId: turnId, summary: message })
export const restoreCheckpoint = restoreLocalGitCheckpoint
export const ensureGitRepo = ensureLocalGitRepo

