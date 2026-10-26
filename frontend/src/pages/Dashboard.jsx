import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Search, GitBranch, Sparkles, Loader2, Github, FolderGit2, Menu, Bot, MoreHorizontal, Pencil, Copy, Paperclip, FileText, X, Trash2, ArrowRight, Zap } from 'lucide-react'
import Sidebar from '../components/dashboard/Sidebar.jsx'
import DesignDirectionPicker from '../components/DesignDirectionPicker.jsx'
import { api } from '../lib/api.js'
import { setPendingAttachments } from '../lib/attachmentStore.js'
import { useAuth } from '../context/AuthContext.jsx'
import { getProjectDisplayName } from '../lib/projectUtils.js'

function formatTimeAgo(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (isNaN(diffSec) || diffSec < 60) return 'hace un momento';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `hace ${diffHour} h`;
  const diffDay = Math.floor(diffHour / 24);
  return `hace ${diffDay} d`;
}

const QUICK_SUGGESTIONS = ['Un panel SaaS para finanzas', 'Una landing page minimalista', 'Un clon de Twitter estilo moderno', 'Una app tipo Notion con tareas']

const CREATING_STEPS_GITHUB = [
  'Creando el repositorio en GitHub…',
  'Generando el proyecto base…',
  'Configurando la base de datos en Supabase (puede tardar unos minutos)…',
  'Casi listo…',
]
const CREATING_STEPS_VIRTUAL = [
  'Generando el proyecto base…',
  'Configurando la base de datos en Supabase (puede tardar unos minutos)…',
  'Casi listo…',
]

// Miniatura de placeholder por proyecto: un degradado estable (según el id) en vez de un
// ícono repetido siempre igual, para que la grilla se sienta más parecida a una galería real
// de proyectos aunque todavía no generemos capturas de la vista previa.
const THUMB_GRADIENTS = [
  'from-primary/40 to-primary-2/30',
  'from-primary-2/40 to-gold/20',
  'from-gold/30 to-primary/30',
  'from-primary/30 to-gold/25',
]
function thumbGradient(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return THUMB_GRADIENTS[hash % THUMB_GRADIENTS.length]
}

function ProjectCard({ project, onClick, onRemix, remixing, onDelete, deleting, onRename, firstName }) {
  const [imgFailed, setImgFailed] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  
  const showImage = project.thumbnailUrl && !imgFailed

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-surface/40 text-left backdrop-blur-md transition-[transform,border-color,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 active:scale-[0.98] active:duration-75"
    >
      {showImage ? (
        <img
          src={project.thumbnailUrl}
          alt=""
          loading="lazy"
          onError={() => setImgFailed(true)}
          onLoad={() => setImgLoaded(true)}
          className={`h-44 w-full bg-surface object-contain transition-opacity duration-300 [transition-timing-function:var(--ease-spring)] ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : (
        <div className={`flex h-44 items-center justify-center bg-gradient-to-br ${thumbGradient(project.id)}`}>
          {project.storageType === 'github' ? (
            <GitBranch className="size-7 text-slate-950/70" />
          ) : (
            <FolderGit2 className="size-7 text-slate-950/70" />
          )}
        </div>
      )}
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
              {(firstName || 'U')[0].toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="truncate text-sm font-semibold">{getProjectDisplayName(project)}</span>
              <span className="truncate text-xs text-muted">
                {project.storageType === 'virtual' ? 'Sin GitHub' : project.repoFullName}
              </span>
            </div>
          </div>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              className="press flex size-7 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-text transition-colors"
            >
              <MoreHorizontal className="size-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-full z-20 mb-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#1e2330] py-1 shadow-xl">
                <button
                  type="button"
                  disabled={remixing || deleting}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onRemix()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-white/5 disabled:opacity-50"
                >
                  {remixing ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                  Remixar
                </button>
                <button
                  type="button"
                  disabled={remixing || deleting}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onRename()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-text hover:bg-white/5 disabled:opacity-50"
                >
                  <Pencil className="size-3.5" />
                  Cambiar nombre
                </button>
                <button
                  type="button"
                  disabled={remixing || deleting}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuOpen(false)
                    onDelete()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-white/5 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RepoCard({ repo, opening, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={opening}
      className="flex flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-surface/40 text-left backdrop-blur-md transition-[transform,border-color,box-shadow] duration-200 [transition-timing-function:var(--ease-spring)] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10 active:scale-[0.98] active:duration-75 disabled:opacity-60"
    >
      <div className="flex h-44 items-center justify-center bg-white/5">
        {opening ? <Loader2 className="size-6 animate-spin text-primary" /> : <GitBranch className="size-7 text-muted" />}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{repo.fullName}</span>
          {repo.private && <Lock className="size-3 shrink-0 text-muted" />}
        </div>
        {repo.description && <p className="line-clamp-1 text-xs text-muted">{repo.description}</p>}
      </div>
    </button>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [repos, setRepos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('mine') // 'mine' | 'github'
  const [openingRepo, setOpeningRepo] = useState(null)
  const [remixingId, setRemixingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [projectToDelete, setProjectToDelete] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const navigate = useNavigate()

  const [prompt, setPrompt] = useState(() => {
    // Si vino de escribir su idea en la landing antes de loguearse, la recuperamos acá para
    // no hacerlo repetir lo que ya escribió.
    const pending = sessionStorage.getItem('gitflow_pending_prompt')
    if (pending) sessionStorage.removeItem('gitflow_pending_prompt')
    return pending || ''
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const stepTimerRef = useRef(null)
  const [stagedFiles, setStagedFiles] = useState([]) // [{ file, previewUrl }]
  const fileInputRef = useRef(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const dragCounterRef = useRef(0)

  // Selector de dirección de diseño: se muestra entre "el usuario describió su idea" y "se
  // crea el proyecto real" — ver startCreation/proceedToCreate más abajo.
  const [loadingDirections, setLoadingDirections] = useState(false)
  const [designDirections, setDesignDirections] = useState(null)
  const [pendingPrompt, setPendingPrompt] = useState('')

  // Si venía de aceptar una invitación de reseller (InviteAccept.jsx) sin sesión todavía, el
  // login/registro (cualquiera de los 3 métodos) siempre termina acá — retoma el flujo apenas
  // aterriza, en vez de perder la invitación.
  useEffect(() => {
    const pendingInvite = sessionStorage.getItem('gitflow_pending_invite')
    if (pendingInvite) {
      sessionStorage.removeItem('gitflow_pending_invite')
      navigate(`/invite/${pendingInvite}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const ownProjects = await api.listProjects()
        if (cancelled) return
        setProjects(ownProjects)
        if (user?.githubConnected) {
          const ghRepos = await api.repos()
          if (cancelled) return
          setRepos(ghRepos)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user])

  const openRepos = new Set(projects.filter((p) => p.storageType === 'github').map((p) => p.repoFullName))
  const filteredProjects = projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
  const filteredRepos = repos
    .filter((r) => !openRepos.has(r.fullName))
    .filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase()))

  const creatingSteps = user?.githubConnected ? CREATING_STEPS_GITHUB : CREATING_STEPS_VIRTUAL
  const firstName = (user?.name || user?.githubLogin || user?.email || '').split(/[ @]/)[0]

  // Sin esto, adjuntar un archivo sin escribir nada quedaría bloqueado por el "!prompt.trim()"
  // de abajo — un prompt genérico alcanza porque el mensaje real (con los archivos adjuntos) es
  // el que arma el agente ya dentro del chat, este solo nombra el repo/título.
  const hasImage = stagedFiles.some((s) => s.file.type.startsWith('image/'))
  const DEFAULT_ATTACHMENT_PROMPT = hasImage
    ? 'Recrear el diseño de la imagen adjunta como sitio web'
    : 'Usar el contenido de los archivos adjuntos para construir el proyecto'

  const MAX_ATTACHMENTS = 10
  const VALID_EXTENSIONS = new Set([
    '.docx', '.doc', '.xlsx', '.xls', '.csv', '.tsv', '.pdf',
    '.txt', '.md', '.json', '.sql', '.xml', '.yaml', '.yml',
    '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'
  ])
  const isAcceptedFile = (file) => {
    if (!file) return false
    const name = file.name ? file.name.toLowerCase() : ''
    const dotIdx = name.lastIndexOf('.')
    const ext = dotIdx !== -1 ? name.slice(dotIdx) : ''
    if (VALID_EXTENSIONS.has(ext)) return true
    if (file.type && (
      file.type.startsWith('image/') ||
      file.type === 'application/pdf' ||
      file.type.includes('word') ||
      file.type.includes('excel') ||
      file.type.includes('spreadsheet') ||
      file.type.includes('csv') ||
      file.type.startsWith('text/') ||
      file.type === 'application/json'
    )) return true
    return false
  }

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || [])
    if (incoming.length === 0) return
    const invalid = incoming.some((f) => !isAcceptedFile(f))
    if (invalid) {
      setCreateError('Solo se admiten imágenes, documentos (.docx, .pdf), planillas (.xlsx, .csv), código o texto plano (.txt, .json, .sql)')
      return
    }
    setCreateError(null)
    setStagedFiles((prev) => {
      const room = MAX_ATTACHMENTS - prev.length
      if (room <= 0) return prev
      const toAdd = incoming.slice(0, room).map((file) => ({
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }))
      return [...prev, ...toAdd]
    })
  }

  const pickFiles = (e) => {
    addFiles(e.target.files)
    e.target.value = ''
  }

  const removeStagedFile = (index) => {
    setStagedFiles((prev) => {
      const removed = prev[index]
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  // Arrastrar y soltar archivos sobre el cuadro de prompt — mismo patrón que Chat.jsx (un
  // contador en vez de un booleano simple, para no parpadear el overlay al cruzar hijos).
  const onDragEnter = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current += 1
    setIsDraggingFile(true)
  }
  const onDragOver = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
  }
  const onDragLeave = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1)
    if (dragCounterRef.current === 0) setIsDraggingFile(false)
  }
  const onDrop = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingFile(false)
    addFiles(e.dataTransfer.files)
  }

  // Paso 1: el usuario describió su idea. Si adjuntó una imagen de diseño, esa imagen YA es
  // la dirección visual (recrearla) — no tiene sentido ofrecerle 3 alternativas, se crea
  // directo. Si es una idea en texto (o solo trae documentos, sin imagen), se le proponen 2-3
  // direcciones visuales antes de crear nada de verdad.
  const startCreation = async (e) => {
    e.preventDefault()
    const finalPrompt = prompt.trim() || (stagedFiles.length > 0 ? DEFAULT_ATTACHMENT_PROMPT : '')
    if (!finalPrompt || creating) return

    // Bias for action: Redirección optimista inmediata. No preguntamos direcciones de diseño.
    return proceedToCreate(finalPrompt)
  }

  const proceedToCreate = async (finalPrompt, chosenDirection) => {
    setDesignDirections(null)
    setCreating(true)
    setCreateError(null)
    setStepIndex(0)
    stepTimerRef.current = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, creatingSteps.length - 1))
    }, 4000)

    // La dirección elegida viaja como texto agregado al final del prompt inicial — mismo
    // mecanismo que ya usa DEFAULT_IMAGE_PROMPT, sin tocar el esquema de la conversación.
    const enrichedPrompt = chosenDirection
      ? `${finalPrompt}\n\nDirección visual elegida por el usuario: "${chosenDirection.name}" — ${chosenDirection.description}. Usá esa paleta de colores, tipografía y estilo general para todo el proyecto.`
      : finalPrompt

    try {
      const result = await api.createProject(enrichedPrompt, null)
      const rawFiles = stagedFiles.map((s) => s.file)
      setPendingAttachments(result.projectId, rawFiles)
      navigate(`/chat/${result.projectId}`, {
        state: { initialPrompt: result.prompt, initialAttachments: rawFiles },
      })
    } catch (err) {
      setCreateError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      clearInterval(stepTimerRef.current)
      setCreating(false)
    }
  }

  const remixProject = async (project) => {
    if (remixingId) return
    setRemixingId(project.id)
    setError(null)
    try {
      const copy = await api.remixProject(project.id)
      setProjects((prev) => [copy, ...prev])
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setRemixingId(null)
    }
  }

    const confirmDeleteProject = async () => {
    if (!projectToDelete || deletingId) return
    setDeletingId(projectToDelete.id)
    setError(null)
    try {
      await api.deleteProject(projectToDelete.id)
      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id))
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setDeletingId(null)
      setProjectToDelete(null)
    }
  }

  const openRepo = async (repo) => {
    if (openingRepo) return
    setOpeningRepo(repo.fullName)
    setError(null)
    try {
      const project = await api.openProject(repo.fullName)
      navigate(`/chat/${project.id}`)
    } catch (err) {
      setError(err.message)
      setOpeningRepo(null)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar recentProjects={projects.slice(0, 6)} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col bg-bg md:py-3 md:pr-3">
        <header className="flex items-center gap-3 border-b border-white/[0.06] bg-bg/80 px-4 py-3 backdrop-blur-xl md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="press flex size-8 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-text"
          >
            <Menu className="size-5" />
          </button>
          <span className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full brand-gradient">
              <Bot className="size-3.5 text-slate-950" />
            </span>
            <span className="font-semibold tracking-tight">
              Flow<span className="text-brand-gradient">Pro</span>
            </span>
          </span>
        </header>

      <main className="flex-1 overflow-y-auto relative md:rounded-[32px] md:border border-white/10 shadow-2xl bg-[linear-gradient(180deg,#09132c_0%,#335cd5_40%,#db67e6_75%,#ff1493_100%)]">
        <div className="relative overflow-hidden px-4 py-16 text-center sm:px-6 sm:py-32">
          
          

          <div className="relative z-10 mb-8 inline-flex items-center gap-2 rounded-full bg-surface/40 px-4 py-1.5 text-xs font-medium text-text backdrop-blur-md border border-white/10 hover:bg-surface/60 transition-colors cursor-pointer">
            <span className="flex -space-x-1">
              <div className="flex size-5 items-center justify-center rounded-full border-2 border-black bg-blue-500"><Sparkles className="size-3"/></div>
              <div className="flex size-5 items-center justify-center rounded-full border-2 border-black bg-purple-500"><Zap className="size-3"/></div>
            </span>
            Conecta todas tus herramientas &rarr;
          </div>
          <h1 className="relative z-10 text-4xl font-bold tracking-tight text-white sm:text-[44px] drop-shadow-sm">
            {firstName ? `¿Tienes una idea, ${firstName}?` : '¿Tienes una idea?'}
          </h1>
          

          <form onSubmit={startCreation} className="relative z-10 mx-auto mt-10 max-w-3xl text-left">
            <div
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={`group relative rounded-3xl border p-2 shadow-2xl backdrop-blur-xl transition-all duration-300 [transition-timing-function:var(--ease-spring)] focus-within:border-white/30 focus-within:bg-surface-2 focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.05)] ${isDraggingFile ? "border-primary/60 scale-[1.02] bg-surface-2 shadow-[0_0_0_4px_rgba(139,92,246,0.15)]" : "border-white/10 bg-surface hover:border-white/20"}`}
            >
              {isDraggingFile && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-primary/10 text-sm font-semibold text-primary backdrop-blur-sm">
                  <Sparkles className="mr-2 size-5" /> Suelta tus archivos aquí
                </div>
              )}
              
              {stagedFiles.length > 0 && (
                <div className="mb-3 px-3 pt-3 flex flex-wrap gap-2">
                  {stagedFiles.map((s, i) => (
                    <div key={i} className="flex max-w-[200px] items-center gap-2 rounded-xl border border-white/[0.08] bg-black/40 p-1.5 pr-3 shadow-sm backdrop-blur-md transition-colors hover:border-white/[0.15]">
                      {s.previewUrl ? (
                        <img src={s.previewUrl} alt={s.file.name} className="size-8 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                          <FileText className="size-4 text-muted" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] font-medium text-text">{s.file.name}</p>
                      </div>
                      <button type="button" onClick={() => removeStagedFile(i)} disabled={creating} className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-white transition-colors">
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              <div className="relative flex items-end">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (prompt.trim() || stagedFiles.length > 0) startCreation(e)
                    }
                  }}
                  placeholder={hasImage ? 'Describe los detalles, estilo o colores que imaginas...' : 'Describe tu proyecto en detalle... (presiona Enter para enviar)'}
                  disabled={creating}
                  rows={prompt.split('\n').length > 1 || stagedFiles.length > 0 ? 3 : 1}
                  className="w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-muted/70 disabled:opacity-60 overflow-hidden"
                  style={{ minHeight: '52px' }}
                />
                
                <div className="flex shrink-0 items-center gap-2 p-1.5 pb-2 pr-2">
                  <input ref={fileInputRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.txt,.md,.json,.sql" onChange={pickFiles} className="hidden" />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={creating || stagedFiles.length >= MAX_ATTACHMENTS} className="group/btn relative flex size-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-text disabled:opacity-50">
                    <Paperclip className="size-5 transition-transform group-hover/btn:scale-110" />
                  </button>
                  <button type="submit" disabled={creating || loadingDirections || (!prompt.trim() && stagedFiles.length === 0)} className="group/btn relative flex size-10 items-center justify-center rounded-xl brand-gradient text-slate-950 transition-all hover:opacity-90 disabled:opacity-50 disabled:grayscale">
                    {(creating || loadingDirections) ? <Loader2 className="size-5 animate-spin" /> : <ArrowRight className="size-5 transition-transform group-hover/btn:translate-x-0.5" />}
                  </button>
                </div>
              </div>
            </div>
            
            {creating && <p className="mt-3 text-center text-xs font-medium text-primary animate-pulse">{creatingSteps[stepIndex]}</p>}
            {loadingDirections && <p className="mt-3 text-center text-xs font-medium text-primary animate-pulse">Generando propuestas de diseño con IA...</p>}
            {createError && <p className="mt-3 text-center text-xs text-red-400">{createError}</p>}
          </form>

          {/* Resume Last Project Pill (Estándar Lovable) */}
          {projects.length > 0 && !creating && !loadingDirections && (
            <div className="relative z-10 mx-auto mt-4 max-w-xl px-4">
              <div
                onClick={() => navigate(`/chat/${projects[0].id}`)}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/10 px-5 py-3 shadow-lg backdrop-blur-md transition-all hover:border-white/20 hover:bg-white/15 cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="flex items-center gap-2 truncate">
                    <span className="truncate text-sm font-medium text-white group-hover:text-blue-300 transition-colors">
                      {getProjectDisplayName(projects[0])}
                    </span>
                    <span className="shrink-0 size-1.5 rounded-full bg-emerald-400"></span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-white/50">
                    {formatTimeAgo(projects[0].lastEditedAt || projects[0].updated_at || projects[0].updatedAt || projects[0].createdAt)}
                  </span>
                  <ArrowRight className="size-3.5 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white" />
                </div>
              </div>
            </div>
          )}

          {!creating && !loadingDirections && (
            <div className="relative z-10 mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4">
              {QUICK_SUGGESTIONS.map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setPrompt(suggestion)}
                  className="rounded-full border border-white/[0.06] bg-white/[0.03] px-3.5 py-1.5 text-xs text-muted transition-colors hover:border-white/[0.15] hover:bg-white/[0.08] hover:text-text"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {designDirections && (
            <DesignDirectionPicker
              prompt={pendingPrompt}
              directions={designDirections}
              creating={creating}
              onChoose={(direction) => proceedToCreate(pendingPrompt, direction)}
              onSkip={() => proceedToCreate(pendingPrompt)}
            />
          )}

          {user && !user.githubConnected && (
            <a
              href={api.githubLinkUrl()}
              className="relative z-10 mt-5 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-surface/40 px-4 py-1.5 text-xs text-muted backdrop-blur-md hover:border-primary/30 hover:bg-white/5 hover:text-text"
            >
              <Github className="size-3.5" /> Conectar GitHub (opcional)
            </a>
          )}
        </div>

        <div className="mx-auto max-w-5xl rounded-[24px] bg-surface px-6 py-8 shadow-2xl mb-12 border border-white/10 relative z-10">
          {!user?.planActive && !user?.trialActive && (
            <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-gold/20 bg-gold/5 px-4 py-3 text-sm backdrop-blur-md">
              <span>No tienes un plan activo. Podrás explorar tus proyectos, pero necesitas un plan para chatear con la IA.</span>
              <button
                onClick={() => navigate('/account')}
                className="press shrink-0 rounded-md bg-gold px-3 py-1.5 text-xs font-bold text-[#3D2B00]"
              >
                Ver planes
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-full border border-white/10 dark:bg-black/20 bg-bg p-1 text-sm">
              <button
                onClick={() => setTab('mine')}
                className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
                  tab === 'mine' ? 'bg-primary/15 text-primary shadow-sm' : 'text-muted hover:text-text'
                }`}
              >
                Tus proyectos
              </button>
              {user?.githubConnected && (
                <button
                  onClick={() => setTab('github')}
                  className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-colors ${
                    tab === 'github' ? 'bg-primary/15 text-primary shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  Repositorios de GitHub
                  {filteredRepos.length > 0 && (
                    <span className="rounded-full bg-white/10 px-1.5 text-[10px] text-muted">{filteredRepos.length}</span>
                  )}
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-full border border-white/10 dark:bg-black/20 bg-bg py-1.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-white/20 focus:bg-black/40"
              />
            </div>
          </div>

          {loading && <p className="mt-8 text-sm text-muted">Cargando tus proyectos…</p>}

          {error && (
            <div className="mt-8 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
              <p className="font-medium">No se pudieron cargar tus proyectos.</p>
              <p className="mt-1 text-red-300/80">{error}</p>
            </div>
          )}

          {!loading && !error && tab === 'mine' && (
            filteredProjects.length > 0 ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProjects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onClick={() => navigate(`/chat/${p.id}`)}
                    onRemix={() => remixProject(p)}
                    remixing={remixingId === p.id}
                    onDelete={() => setProjectToDelete(p)}
                    deleting={deletingId === p.id}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-10 flex flex-col items-center gap-4 rounded-2xl border border-white/10 dark:bg-surface/30 bg-bg p-12 text-center backdrop-blur-md">
                <div className="flex size-16 items-center justify-center rounded-2xl border border-white/[0.06] bg-primary/10">
                  <Sparkles className="size-7 text-primary" />
                </div>
                <p className="text-sm text-muted">Aún no tienes proyectos. Describe qué quieres construir arriba para crear el primero.</p>
              </div>
            )
          )}

          {!loading && !error && tab === 'github' && (
            filteredRepos.length > 0 ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredRepos.map((repo) => (
                  <RepoCard
                    key={repo.fullName}
                    repo={repo}
                    opening={openingRepo === repo.fullName}
                    onClick={() => openRepo(repo)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-10 text-center text-sm text-muted">No hay repositorios de GitHub sin abrir todavía.</p>
            )
          )}
        </div>
      {projectToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-semibold text-white/90">
              Eliminar proyecto
            </h3>
            <p className="text-[14.5px] text-white/70 leading-relaxed">
              ¿Eliminar <span className="text-white font-medium">"{projectToDelete.name}"</span> de FlowPro? Se borra el historial de chat, cambios, secrets y (si tenía) la base de datos automática. El repositorio de GitHub no se toca.
            </p>
            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                onClick={() => setProjectToDelete(null)}
                disabled={deletingId === projectToDelete.id}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteProject}
                disabled={deletingId === projectToDelete.id}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50 border border-red-500/30"
              >
                {deletingId === projectToDelete.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
      </div>
    </div>
  )
}
