import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import {
  Folder, FolderOpen, File, Loader2, Save, AlertTriangle,
  Download, GitBranch, Plus, Trash2, Search, X, ChevronUp, ChevronDown, RefreshCw
} from 'lucide-react'
import { api } from '../lib/api.js'

// Extensiones que no tiene sentido mostrar como texto
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|woff2?|ttf|eot|mp4|mp3|wav)$/i

// Palabras clave para resaltado ligero por sintaxis
const KEYWORDS = new Set([
  'import', 'export', 'from', 'default', 'as', 'const', 'let', 'var', 'function',
  'return', 'async', 'await', 'class', 'extends', 'if', 'else', 'switch', 'case',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'typeof',
  'instanceof', 'void', 'delete', 'this', 'super', 'interface', 'type', 'enum',
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete',
  'create', 'table', 'drop', 'alter', 'primary', 'key', 'references', 'join',
  'null', 'undefined', 'true', 'false'
])

// Resaltador de sintaxis ligero basado en tokens para JS/JSX/TS/TSX/CSS/JSON/SQL/HTML
function tokenizeLine(line) {
  if (!line) return [{ text: ' ', type: 'plain' }]

  const tokens = []
  let i = 0
  const len = line.length

  while (i < len) {
    // Comentarios // o --
    if ((line[i] === '/' && line[i + 1] === '/') || (line[i] === '-' && line[i + 1] === '-')) {
      tokens.push({ text: line.slice(i), type: 'comment' })
      break
    }
    // Strings con comillas dobles, simples o backticks
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i]
      let str = quote
      i++
      while (i < len) {
        if (line[i] === '\\' && i + 1 < len) {
          str += line[i] + line[i + 1]
          i += 2
          continue
        }
        str += line[i]
        if (line[i] === quote) {
          i++
          break
        }
        i++
      }
      tokens.push({ text: str, type: 'string' })
      continue
    }
    // Etiquetas JSX / HTML: <Tag o </Tag o />
    if (line[i] === '<' && (line[i + 1] === '/' || /[a-zA-Z]/.test(line[i + 1]))) {
      let tag = '<'
      i++
      if (line[i] === '/') {
        tag += '/'
        i++
      }
      while (i < len && /[a-zA-Z0-9_.-]/.test(line[i])) {
        tag += line[i]
        i++
      }
      tokens.push({ text: tag, type: 'tag' })
      continue
    }
    // Números
    if (/\d/.test(line[i]) && (i === 0 || /[\s,([{:;=+\-*/%]/.test(line[i - 1]))) {
      let num = ''
      while (i < len && /[\d.a-fA-Fx]/.test(line[i])) {
        num += line[i]
        i++
      }
      tokens.push({ text: num, type: 'number' })
      continue
    }
    // Identificadores y palabras clave
    if (/[a-zA-Z_$]/.test(line[i])) {
      let word = ''
      while (i < len && /[a-zA-Z0-9_$]/.test(line[i])) {
        word += line[i]
        i++
      }
      if (KEYWORDS.has(word.toLowerCase())) {
        tokens.push({ text: word, type: 'keyword' })
      } else if (i < len && line[i] === '(') {
        tokens.push({ text: word, type: 'function' })
      } else {
        tokens.push({ text: word, type: 'plain' })
      }
      continue
    }
    // Caracteres restantes (operadores, espacios, signos)
    tokens.push({ text: line[i], type: 'plain' })
    i++
  }

  return tokens
}

// Construye árbol jerárquico a partir de rutas planas
function buildTree(paths) {
  const root = { folders: new Map(), files: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      if (!node.folders.has(name)) node.folders.set(name, { folders: new Map(), files: [] })
      node = node.folders.get(name)
    }
    node.files.push({ name: parts[parts.length - 1], path })
  }
  return root
}

function TreeNode({ node, depth, selectedPath, onSelect, onDeleteFile, collapsed, toggleFolder, prefix }) {
  const folders = [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      {folders.map(([name, child]) => {
        const folderPath = prefix ? `${prefix}/${name}` : name
        const isCollapsed = collapsed.has(folderPath)
        return (
          <div key={folderPath}>
            <button
              type="button"
              onClick={() => toggleFolder(folderPath)}
              className="press group flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs text-muted hover:bg-white/5 hover:text-text transition-colors"
              style={{ paddingLeft: `${depth * 12 + 6}px` }}
            >
              <div className="flex items-center gap-1.5 truncate">
                {isCollapsed ? <Folder className="size-3.5 shrink-0 text-amber-400/80" /> : <FolderOpen className="size-3.5 shrink-0 text-amber-400" />}
                <span className="truncate">{name}</span>
              </div>
            </button>
            {!isCollapsed && (
              <TreeNode
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onDeleteFile={onDeleteFile}
                collapsed={collapsed}
                toggleFolder={toggleFolder}
                prefix={folderPath}
              />
            )}
          </div>
        )
      })}
      {files.map((f) => (
        <div
          key={f.path}
          className={`group flex items-center justify-between rounded px-1.5 py-0.5 text-xs transition-colors ${
            selectedPath === f.path ? 'bg-primary/20 text-primary font-medium' : 'text-muted hover:bg-white/5 hover:text-text'
          }`}
          style={{ paddingLeft: `${depth * 12 + 20}px` }}
        >
          <button
            type="button"
            onClick={() => onSelect(f.path)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left truncate"
          >
            <File className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">{f.name}</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteFile(f.path)
            }}
            title="Eliminar archivo"
            className="opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-red-400 transition-opacity"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
    </>
  )
}

export default function CodeViewPanel({
  projectId,
  project,
  revisionKey = 0,
  onMigrateToGithub,
  migrating = false
}) {
  const [paths, setPaths] = useState(null)
  const [error, setError] = useState(null)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [selectedPath, setSelectedPath] = useState(null)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loadingFile, setLoadingFile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileError, setFileError] = useState(null)

  // Anti-colisión / Reactividad con Agente IA
  const [hasCollision, setHasCollision] = useState(false)
  const lastRevRef = useRef(revisionKey)

  // Búsqueda en archivo
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)

  // Modales de CRUD en árbol
  const [showNewModal, setShowNewModal] = useState(false) // 'file' | 'folder' | null
  const [newItemPath, setNewItemPath] = useState('')
  const [deleteConfirmPath, setDeleteConfirmPath] = useState(null)
  const [crudLoading, setCrudLoading] = useState(false)

  // Refs de sincronización de scroll para el editor
  const textareaRef = useRef(null)
  const preRef = useRef(null)
  const gutterRef = useRef(null)

  const isVirtual = Boolean(
    project?.storageType === 'virtual' ||
    project?.storage_type === 'virtual' ||
    project?.repo_full_name?.startsWith('virtual-') ||
    project?.repoFullName?.startsWith('virtual-')
  )

  const isBinary = selectedPath && BINARY_EXT_RE.test(selectedPath)
  const dirty = selectedPath && !isBinary && content !== originalContent

  const fetchPaths = useCallback(async () => {
    try {
      const data = await api.listProjectFiles(projectId)
      setPaths(data.paths || [])
    } catch (err) {
      setError(err.message)
    }
  }, [projectId])

  useEffect(() => {
    setPaths(null)
    setError(null)
    setSelectedPath(null)
    setContent('')
    setOriginalContent('')
    setHasCollision(false)
    fetchPaths()
  }, [projectId, fetchPaths])

  // Detección de actualización reactiva (IA / Auto-fix / Quick-Edit)
  useEffect(() => {
    if (lastRevRef.current !== revisionKey) {
      lastRevRef.current = revisionKey
      fetchPaths()

      if (selectedPath) {
        if (!dirty) {
          // Si no hay cambios locales sucios, recargar la versión más reciente en vivo
          api.readProjectFile(projectId, selectedPath)
            .then((data) => {
              setContent(data.content || '')
              setOriginalContent(data.content || '')
            })
            .catch(() => {})
        } else {
          // Si hay cambios locales sin guardar, alertar al usuario para evitar sobreescritura accidental
          setHasCollision(true)
        }
      }
    }
  }, [revisionKey, selectedPath, dirty, projectId, fetchPaths])

  const tree = useMemo(() => buildTree(paths || []), [paths])

  const toggleFolder = (path) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectFile = (path) => {
    if (path === selectedPath) return
    setSelectedPath(path)
    setFileError(null)
    setHasCollision(false)
    setShowSearch(false)
    setSearchQuery('')

    if (BINARY_EXT_RE.test(path)) {
      setContent('')
      setOriginalContent('')
      return
    }

    setLoadingFile(true)
    api
      .readProjectFile(projectId, path)
      .then((data) => {
        setContent(data.content || '')
        setOriginalContent(data.content || '')
      })
      .catch((err) => setFileError(err.detail ? `${err.message}: ${err.detail}` : err.message))
      .finally(() => setLoadingFile(false))
  }

  const save = async () => {
    if (!selectedPath || content === originalContent || saving) return
    setSaving(true)
    setFileError(null)
    try {
      await api.saveProjectFile(projectId, selectedPath, content)
      setOriginalContent(content)
      setHasCollision(false)
    } catch (err) {
      setFileError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  // Sincronización de scroll entre textarea, pre y gutter de números
  const handleScroll = (e) => {
    const { scrollTop, scrollLeft } = e.target
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop
      preRef.current.scrollLeft = scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop
    }
  }

  // Interceptar tecla Tab y atajos Ctrl+S / Ctrl+F
  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      save()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      setShowSearch(true)
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      const start = e.target.selectionStart
      const end = e.target.selectionEnd
      const updated = content.substring(0, start) + '  ' + content.substring(end)
      setContent(updated)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2
        }
      }, 0)
    }
  }

  // Búsqueda en el archivo actual
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim() || !content) return []
    const indices = []
    const lowerContent = content.toLowerCase()
    const lowerQuery = searchQuery.toLowerCase()
    let pos = lowerContent.indexOf(lowerQuery)
    while (pos !== -1) {
      indices.push(pos)
      pos = lowerContent.indexOf(lowerQuery, pos + lowerQuery.length)
    }
    return indices
  }, [searchQuery, content])

  const jumpToMatch = (idx) => {
    if (!searchMatches.length || !textareaRef.current) return
    const boundedIdx = (idx + searchMatches.length) % searchMatches.length
    setSearchMatchIndex(boundedIdx)
    const matchPos = searchMatches[boundedIdx]
    textareaRef.current.focus()
    textareaRef.current.setSelectionRange(matchPos, matchPos + searchQuery.length)
  }

  // Descargar ZIP completo del proyecto
  const handleDownloadZip = async () => {
    try {
      await api.downloadProjectZip(projectId, project?.slug || 'flowpro-project')
    } catch (err) {
      alert(`Error al descargar ZIP: ${err.message}`)
    }
  }

  // Crear archivo o carpeta
  const handleCreateItem = async (e) => {
    e.preventDefault()
    if (!newItemPath.trim()) return
    setCrudLoading(true)
    try {
      let finalPath = newItemPath.trim().replace(/\\/g, '/')
      if (showNewModal === 'folder') {
        finalPath = finalPath.replace(/\/+$/, '') + '/.gitkeep'
      }
      await api.createProjectFile(projectId, finalPath, '')
      setShowNewModal(null)
      setNewItemPath('')
      await fetchPaths()
      if (showNewModal === 'file') {
        selectFile(finalPath)
      }
    } catch (err) {
      alert(`Error al crear: ${err.message}`)
    } finally {
      setCrudLoading(false)
    }
  }

  // Eliminar archivo
  const handleDeleteItem = async () => {
    if (!deleteConfirmPath) return
    setCrudLoading(true)
    try {
      await api.deleteProjectFile(projectId, deleteConfirmPath)
      if (selectedPath === deleteConfirmPath) {
        setSelectedPath(null)
        setContent('')
        setOriginalContent('')
      }
      setDeleteConfirmPath(null)
      await fetchPaths()
    } catch (err) {
      alert(`Error al eliminar: ${err.message}`)
    } finally {
      setCrudLoading(false)
    }
  }

  const lines = useMemo(() => content.split('\n'), [content])

  return (
    <div className="flex h-full w-full bg-[#0a0d14] text-[#ededed]">
      {/* SIDEBAR: Explorador de Archivos */}
      <div className="flex w-64 shrink-0 flex-col border-r border-white/[0.08] bg-[#0c101b]/60 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-3 py-2 bg-white/[0.02]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Archivos</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowNewModal('file'); setNewItemPath('') }}
              className="p-1 rounded text-muted hover:text-text hover:bg-white/10 transition-colors"
              title="Nuevo archivo"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              onClick={() => { setShowNewModal('folder'); setNewItemPath('') }}
              className="p-1 rounded text-muted hover:text-text hover:bg-white/10 transition-colors"
              title="Nueva carpeta"
            >
              <Folder className="size-3.5" />
            </button>
            <button
              onClick={fetchPaths}
              className="p-1 rounded text-muted hover:text-text hover:bg-white/10 transition-colors"
              title="Recargar árbol"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 font-mono">
          {!paths && !error && (
            <p className="flex items-center gap-1.5 px-2 py-3 text-xs text-muted">
              <Loader2 className="size-3.5 animate-spin" /> Leyendo estructura…
            </p>
          )}
          {error && <p className="p-2 text-xs text-red-400">{error}</p>}
          {paths && (
            <TreeNode
              node={tree}
              depth={0}
              selectedPath={selectedPath}
              onSelect={selectFile}
              onDeleteFile={(p) => setDeleteConfirmPath(p)}
              collapsed={collapsed}
              toggleFolder={toggleFolder}
              prefix=""
            />
          )}
        </div>
      </div>

      {/* ÁREA PRINCIPAL: Editor de Código Ligero */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#080b12]">
        {!selectedPath ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
              <File className="size-6 text-muted/60" />
            </div>
            <span>Selecciona un archivo del explorador para verlo y editarlo.</span>
          </div>
        ) : (
          <>
            {/* Cabecera del Editor */}
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-[#0c101b]/80 px-4 py-2 backdrop-blur-md">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate font-mono text-xs font-medium text-text">{selectedPath}</span>
                {dirty && <span className="size-2 rounded-full bg-amber-400 shrink-0" title="Cambios no guardados" />}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {/* Botón Búsqueda */}
                <button
                  onClick={() => setShowSearch(!showSearch)}
                  className={`p-1.5 rounded text-xs transition-colors ${showSearch ? 'bg-primary/20 text-primary' : 'text-muted hover:text-text hover:bg-white/10'}`}
                  title="Buscar en archivo (Ctrl+F)"
                >
                  <Search className="size-3.5" />
                </button>

                {/* Botón Descargar ZIP */}
                <button
                  onClick={handleDownloadZip}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted hover:text-text border border-white/[0.08] hover:bg-white/5 transition-colors"
                  title="Descargar proyecto completo en archivo .ZIP"
                >
                  <Download className="size-3.5" />
                  <span>Descargar ZIP</span>
                </button>

                {/* Botón Exportar a GitHub (si es proyecto virtual) */}
                {isVirtual && onMigrateToGithub && (
                  <button
                    onClick={onMigrateToGithub}
                    disabled={migrating}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-muted hover:text-text border border-white/[0.08] hover:bg-white/5 disabled:opacity-50 transition-colors"
                    title="Exportar proyecto virtual a repositorio privado de GitHub"
                  >
                    {migrating ? <Loader2 className="size-3.5 animate-spin text-primary" /> : <GitBranch className="size-3.5 text-emerald-400" />}
                    <span>{migrating ? 'Sincronizando…' : 'Exportar a GitHub'}</span>
                  </button>
                )}

                {/* Botón Guardar */}
                {!isBinary && (
                  <button
                    onClick={save}
                    disabled={!dirty || saving}
                    className="flex items-center gap-1.5 rounded-md bg-[#3b59b8] hover:bg-[#486bd9] px-3 py-1 text-xs font-semibold text-white shadow-sm disabled:opacity-40 transition-all"
                    title="Guardar cambios (Ctrl+S)"
                  >
                    {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                    <span>{saving ? 'Guardando…' : dirty ? 'Guardar' : 'Guardado'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Banner de Búsqueda Rápida */}
            {showSearch && (
              <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] bg-[#121624] px-4 py-1.5 text-xs">
                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <Search className="size-3.5 text-muted shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setSearchMatchIndex(0)
                    }}
                    placeholder="Buscar en este archivo…"
                    className="w-full bg-transparent outline-none text-text placeholder:text-muted/40 font-mono text-xs"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted">
                    {searchMatches.length ? `${searchMatchIndex + 1} de ${searchMatches.length}` : 'Sin coincidencias'}
                  </span>
                  <button onClick={() => jumpToMatch(searchMatchIndex - 1)} disabled={!searchMatches.length} className="p-1 rounded hover:bg-white/10 text-muted disabled:opacity-40">
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button onClick={() => jumpToMatch(searchMatchIndex + 1)} disabled={!searchMatches.length} className="p-1 rounded hover:bg-white/10 text-muted disabled:opacity-40">
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button onClick={() => setShowSearch(false)} className="p-1 rounded hover:bg-white/10 text-muted">
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Banner de Colisión / Anti-Sobreescritura */}
            {hasCollision && (
              <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                  <span>El Agente IA o un cambio externo actualizó este archivo mientras tenías ediciones sin guardar.</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      const data = await api.readProjectFile(projectId, selectedPath)
                      setContent(data.content || '')
                      setOriginalContent(data.content || '')
                      setHasCollision(false)
                    }}
                    className="rounded bg-amber-500/20 hover:bg-amber-500/30 px-2 py-0.5 text-xs font-semibold text-amber-300"
                  >
                    Cargar versión nueva de IA
                  </button>
                  <button
                    onClick={() => setHasCollision(false)}
                    className="rounded border border-white/10 px-2 py-0.5 text-xs text-muted hover:text-text"
                  >
                    Mantener mis cambios
                  </button>
                </div>
              </div>
            )}

            {fileError && (
              <p className="flex items-center gap-1.5 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
                <AlertTriangle className="size-3.5 shrink-0" /> {fileError}
              </p>
            )}

            {/* Contenedor del Editor */}
            <div className="relative flex min-h-0 flex-1 overflow-hidden">
              {isBinary ? (
                <div className="p-6 text-sm text-muted">
                  Este tipo de archivo binario no se puede editar como texto plano.
                </div>
              ) : loadingFile ? (
                <div className="flex items-center gap-2 p-6 text-xs text-muted">
                  <Loader2 className="size-4 animate-spin text-primary" /> Cargando contenido…
                </div>
              ) : (
                <div className="flex h-full w-full overflow-hidden">
                  {/* Gutter con números de línea sincronizados */}
                  <div
                    ref={gutterRef}
                    className="w-12 shrink-0 select-none border-r border-white/[0.06] bg-[#070a10] py-3 pr-3 text-right font-mono text-xs text-muted/30 overflow-hidden"
                  >
                    {lines.map((_, i) => (
                      <div key={i} style={{ height: '20px', lineHeight: '20px' }}>
                        {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Capa de Edición y Resaltado de Sintaxis */}
                  <div className="relative flex-1 h-full overflow-hidden">
                    {/* Capa de Fondo: Resaltado de Sintaxis */}
                    <pre
                      ref={preRef}
                      aria-hidden="true"
                      className="absolute inset-0 m-0 pointer-events-none p-3 font-mono text-xs leading-[20px] whitespace-pre overflow-hidden text-slate-200"
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: '12px',
                        lineHeight: '20px',
                        tabSize: 2
                      }}
                    >
                      {lines.map((line, lIdx) => {
                        const tokens = tokenizeLine(line)
                        return (
                          <div key={lIdx} style={{ height: '20px', lineHeight: '20px' }}>
                            {tokens.map((token, tIdx) => {
                              let cls = 'text-slate-300'
                              if (token.type === 'comment') cls = 'text-zinc-500 italic'
                              else if (token.type === 'string') cls = 'text-emerald-400'
                              else if (token.type === 'keyword') cls = 'text-indigo-400 font-semibold'
                              else if (token.type === 'number') cls = 'text-amber-400'
                              else if (token.type === 'tag') cls = 'text-sky-400 font-medium'
                              else if (token.type === 'function') cls = 'text-blue-300'
                              return <span key={tIdx} className={cls}>{token.text}</span>
                            })}
                          </div>
                        )
                      })}
                    </pre>

                    {/* Capa de Primer Plano: Textarea Editable */}
                    <textarea
                      ref={textareaRef}
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      onScroll={handleScroll}
                      onKeyDown={handleKeyDown}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoComplete="off"
                      className="absolute inset-0 m-0 h-full w-full resize-none p-3 font-mono text-xs leading-[20px] bg-transparent text-transparent caret-sky-400 outline-none whitespace-pre overflow-auto z-10 selection:bg-sky-500/30"
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: '12px',
                        lineHeight: '20px',
                        tabSize: 2
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal para Crear Archivo o Carpeta */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateItem} className="w-full max-w-md rounded-xl border border-white/10 bg-[#121624] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-text mb-2">
              {showNewModal === 'file' ? 'Crear Nuevo Archivo' : 'Crear Nueva Carpeta'}
            </h3>
            <p className="text-xs text-muted mb-4">
              Ingresa la ruta relativa del {showNewModal === 'file' ? 'archivo' : 'directorio'}:
            </p>
            <input
              type="text"
              value={newItemPath}
              onChange={(e) => setNewItemPath(e.target.value)}
              placeholder={showNewModal === 'file' ? 'src/components/NuevoComponente.jsx' : 'src/helpers'}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-text outline-none focus:border-primary/60 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewModal(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-text"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!newItemPath.trim() || crudLoading}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#3b59b8] hover:bg-[#486bd9] text-white disabled:opacity-40"
              >
                {crudLoading ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal para Confirmar Eliminación */}
      {deleteConfirmPath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-red-500/20 bg-[#141018] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-red-300 mb-2">¿Eliminar archivo?</h3>
            <p className="text-xs text-muted mb-4">
              Se eliminará <span className="font-mono text-text font-medium">{deleteConfirmPath}</span> del proyecto. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmPath(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-text"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteItem}
                disabled={crudLoading}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-40"
              >
                {crudLoading ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
