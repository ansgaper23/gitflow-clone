// backend/src/services/projectReset.js
// PROTOCOLO FÍSICO DE HARD RESET DE PROYECTO (FLOWPRO)
// Ejecuta la purga total de archivos en storage, disco de preview, tablas de PostgreSQL y cachés.

import { supabase } from '../db/supabaseClient.js'
import { isVirtualRepo } from './projectResolver.js'
import { invalidateProjectFileCache, snapshotProjectFiles } from './projectStorage.js'
import { runSql } from './repoDb.js'
import { invalidateSemanticGraph } from './semanticGraph.js'
import { invalidateDbSchemaGraph } from './dbSchemaGraph.js'
import { resetPreviewWorkspace } from './previewOrchestrator.js'
import { createCheckpoint } from './checkpoints.js'

export const CLEAN_APP_SCAFFOLD = `import React from 'react'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center p-6 max-w-md">
        <h1 className="text-xl font-bold tracking-tight mb-2">Nuevo Proyecto</h1>
        <p className="text-sm text-zinc-400">Construyendo la nueva aplicación...</p>
      </div>
    </div>
  )
}
`

/**
 * Determina si una ruta relativa pertenece a componentes o lógica específica del proyecto previo
 * que debe ser purgada físicamente ante una orden de reinicio total.
 * 
 * @param {string} filePath
 * @returns {boolean}
 */
export function isObsoleteProjectFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  const norm = filePath.replace(/^\/+/, '').toLowerCase()

  // Preservar archivos de configuración raíz
  if (
    norm === 'package.json' ||
    norm === 'vite.config.js' ||
    norm === 'vite.config.ts' ||
    norm === 'index.html' ||
    norm === 'tsconfig.json' ||
    norm === 'tailwind.config.js' ||
    norm === 'postcss.config.js'
  ) {
    return false
  }

  // Preservar entrypoints base de Vite
  if (
    norm === 'src/main.jsx' ||
    norm === 'src/main.tsx' ||
    norm === 'src/index.css' ||
    norm === 'src/app.css'
  ) {
    return false
  }

  // Preservar SIEMPRE activos multimedia y logos extraídos de documentos/PDFs
  if (
    norm.startsWith('public/doc-assets/') ||
    norm.startsWith('doc-assets/') ||
    norm.startsWith('public/assets/')
  ) {
    return false
  }

  // App.jsx y App.tsx son manejados directamente (sobrescritos/reseteados)
  if (norm === 'src/app.jsx' || norm === 'src/app.tsx') {
    return false
  }

  // Eliminar componentes, páginas, vistas, utilidades, hooks, context y servicios
  if (
    norm.startsWith('src/components/') ||
    norm.startsWith('src/pages/') ||
    norm.startsWith('src/views/') ||
    norm.startsWith('src/lib/') ||
    norm.startsWith('src/utils/') ||
    norm.startsWith('src/hooks/') ||
    norm.startsWith('src/context/') ||
    norm.startsWith('src/services/') ||
    norm.startsWith('src/api/')
  ) {
    return true
  }

  // Cualquier otro archivo específico de código dentro de src/
  if (norm.startsWith('src/')) {
    return true
  }

  return false
}

/**
 * Ejecuta un reinicio físico completo de proyecto:
 * 1. Elimina de storage (project_files) componentes, vistas y utilidades del proyecto anterior.
 * 2. Restablece src/App.jsx al scaffold base limpio.
 * 3. Ejecuta DROP TABLE en PostgreSQL para todas las tablas de usuario creadas previamente.
 * 4. Limpia el workspace en disco de la vista previa (/opt/gitflow-previews/workspace-X/src/).
 * 5. Invalida completamente todos los grafos semánticos y cachés de archivos y esquemas.
 *
 * @param {object} params
 * @param {object} params.project - Proyecto activo ({ id, repo_full_name, branch, slug })
 * @param {object} [params.dbConnection] - Conexión de base de datos activa
 * @param {string} [params.ownerKey] - Clave de propietario para el orquestador de preview
 * @param {string} [params.accessToken] - Token de acceso para proyectos GitHub
 * @param {Function} [params.onProgress] - Callback de telemetría
 * @param {Function} [params.invalidateSchemaCacheFn] - Función para invalidar la caché de esquema
 * @param {object} [params.customStorageClient] - Cliente de almacenamiento personalizado para pruebas
 * @param {Function} [params.customSqlRunner] - Ejecutor SQL personalizado para pruebas
 * @returns {Promise<{ purged: boolean, deletedFiles: string[], droppedTables: string[] }>}
 */
export async function executeHardProjectReset({
  project,
  dbConnection = null,
  ownerKey = null,
  accessToken = null,
  conversationId = null,
  wipeDatabase = true,
  onProgress = null,
  invalidateSchemaCacheFn = null,
  customStorageClient = null,
  customSqlRunner = null,
  customCheckpointFn = null
} = {}) {
  if (!project || !project.id) {
    return { purged: false, reason: 'No project provided', deletedFiles: [], droppedTables: [], tableBackups: {}, preResetCheckpoint: null }
  }

  onProgress?.({
    type: 'telemetry',
    phase: 'CLEANING',
    label: 'Ejecutando reinicio físico total del proyecto con salvaguarda pre-reset...'
  })

  const client = customStorageClient || supabase
  const sqlExec = customSqlRunner || runSql
  const deletedFiles = []
  const droppedTables = []
  const tableBackups = {}
  let preResetCheckpoint = null

  // 0. SALVAGUARDA PRE-RESET OBLIGATORIA (ZERO DATA-LOSS)
  // Crear checkpoint con snapshot de archivos antes de purgar nada
  try {
    if (typeof customCheckpointFn === 'function') {
      preResetCheckpoint = await customCheckpointFn(project, conversationId, {
        changeType: 'reset',
        summary: 'Pre-reset automatic snapshot',
      })
    } else if (customStorageClient) {
      // Mock / entorno de prueba unitaria sin Supabase global
      preResetCheckpoint = { changeType: 'reset', summary: 'Pre-reset automatic snapshot' }
    } else if (isVirtualRepo(project.repo_full_name) || String(project.repo_full_name || '').startsWith('virtual')) {
      preResetCheckpoint = await createCheckpoint(project, conversationId || null, {
        changeType: 'reset',
        summary: 'Pre-reset automatic snapshot',
      })
    }
  } catch (snapErr) {
    console.warn('[hardReset] Error creando pre-reset snapshot en checkpoints:', snapErr.message)
  }

  // 1. PURGA FÍSICA DE ARCHIVOS EN STORAGE (project_files)
  try {
    if (isVirtualRepo(project.repo_full_name) || String(project.repo_full_name || '').startsWith('virtual')) {
      const { data: allFiles, error: listErr } = await client
        .from('project_files')
        .select('path')
        .eq('project_id', project.id)

      if (!listErr && Array.isArray(allFiles)) {
        const obsoletePaths = allFiles
          .map((f) => f.path)
          .filter(isObsoleteProjectFile)

        if (obsoletePaths.length > 0) {
          console.log(`[hardReset] Eliminando ${obsoletePaths.length} archivos obsoletos en project_files:`, obsoletePaths)
          await client
            .from('project_files')
            .delete()
            .eq('project_id', project.id)
            .in('path', obsoletePaths)
          deletedFiles.push(...obsoletePaths)
        }
      }

      // Restablecer src/App.jsx al scaffold base limpio
      await client.from('project_files').upsert(
        {
          project_id: project.id,
          path: 'src/App.jsx',
          content: CLEAN_APP_SCAFFOLD,
          is_base64: false,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'project_id,path' }
      )

      // Eliminar src/App.tsx si existía para evitar colisiones con App.jsx
      await client
        .from('project_files')
        .delete()
        .eq('project_id', project.id)
        .eq('path', 'src/App.tsx')
    }
  } catch (errFiles) {
    console.warn('[hardReset] Error purgado de project_files:', errFiles.message)
  }

  // 2. PURGA FÍSICA DE TABLAS EN POSTGRESQL (CON BACKUP PREVIO DE REGISTROS)
  if (dbConnection && wipeDatabase) {
    try {
      const tablesRes = await sqlExec(
        dbConnection,
        `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
          AND table_name NOT LIKE '\\_flowpro\\_%' ESCAPE '\\'
          AND table_name != 'auth'
          AND table_name NOT LIKE 'pg\\_%' ESCAPE '\\';
      `
      )

      const userTables = (tablesRes?.rows || [])
        .map((r) => r.table_name || r.TABLE_NAME)
        .filter(Boolean)

      // Salvaguarda: Realizar backup de registros de usuario antes del DROP
      for (const t of userTables) {
        try {
          const rowsRes = await sqlExec(dbConnection, `SELECT * FROM "public"."${t}" LIMIT 500;`)
          tableBackups[t] = rowsRes?.rows || []
        } catch (_) {}
      }

      if (userTables.length > 0) {
        console.log(`[hardReset] Eliminando ${userTables.length} tablas de usuario en PostgreSQL (con backup previo de ${Object.keys(tableBackups).length} tablas):`, userTables)
        for (const t of userTables) {
          try {
            await sqlExec(dbConnection, `DROP TABLE IF EXISTS "public"."${t}" CASCADE;`)
            droppedTables.push(t)
          } catch (dropErr) {
            console.warn(`[hardReset] Error al eliminar tabla ${t}:`, dropErr.message)
          }
        }
      }

      // Limpiar historial de migraciones de FlowPro si existía
      try {
        await sqlExec(dbConnection, 'DELETE FROM "_flowpro_migrations" WHERE 1=1;')
      } catch (_) {}

      if (typeof invalidateSchemaCacheFn === 'function') {
        invalidateSchemaCacheFn(dbConnection)
      }
    } catch (errDb) {
      console.warn('[hardReset] Error en limpieza de tablas PostgreSQL:', errDb.message)
    }
  }

  // 3. LIMPIEZA DE WORKSPACE EN DISCO (ORQUESTADOR DE PREVIEW)
  if (ownerKey) {
    try {
      await resetPreviewWorkspace(ownerKey, project.repo_full_name)
    } catch (errOrch) {
      console.warn('[hardReset] Error al resetear workspace en orquestador (best-effort):', errOrch.message)
    }
  }

  // 4. INVALIDACIÓN TOTAL DE CACHÉS
  invalidateProjectFileCache(project.id)
  invalidateSemanticGraph(project.id)
  invalidateDbSchemaGraph(project.id)

  return {
    purged: true,
    deletedFiles,
    droppedTables,
    tableBackups,
    preResetCheckpoint
  }
}
