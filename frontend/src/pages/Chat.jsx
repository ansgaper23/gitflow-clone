import { SupabaseConnectCard } from '../components/chat/SupabaseConnectCard.jsx'

import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'

import {Link, useParams, useLocation} from 'react-router-dom'

import { TopHeader } from '../components/TopHeader';

import { ChatInput } from '../components/ChatInput'

import ModeSelector from '../components/ModeSelector'

import AssistantMessage from '../components/AssistantMessage'

import { ThinkingState } from '../components/chat/ThinkingState'

import ReactMarkdown from 'react-markdown'

import { FileCode2, PanelLeftClose,

  ArrowLeft,

  ArrowUp,

  ArrowDown,

  Send,

  Bot,

  Square,

  GitBranch,

  Paperclip,

  Loader2,

  AlertTriangle,

  X,

  FileText,

  Eye,

  EyeOff,

  Compass,

  Hammer,

  FileSearch,

  FilePenLine,

  FolderSearch,

  Database,

  Upload,

  Sparkles,

  Github,

  Bug,

  FileCode,

  MonitorPlay,

  History,

  MousePointerClick,

  Rocket,

  Share2,

  Code2,

  Undo2,

  Play,

  RefreshCw,

  RotateCw,

  ExternalLink,

  Server,

  ListChecks,

  MoreHorizontal,

  Zap,

  Mic,

  MicOff,

  ChevronDown,

  Search,

  ChevronRight,

  ChevronLeft,

  Brain,

  Smartphone,

  Menu,

  MessageSquare,

  Globe,

  PanelLeft,

  Monitor,

  Layers,

  Check

} from 'lucide-react'

import GroupedChangesCard from '../components/GroupedChangesCard.jsx'

import DbChangeCard from '../components/DbChangeCard.jsx'

import EdgeFunctionChangeCard from '../components/EdgeFunctionChangeCard.jsx'

import QuestionCard from '../components/QuestionCard.jsx'

import SecretRequestCard from '../components/SecretRequestCard.jsx'

import DbChoiceCard from '../components/DbChoiceCard.jsx'

import AssetChangeCard from '../components/AssetChangeCard.jsx'

import PreviewPanel, { VIEWPORTS } from '../components/PreviewPanel.jsx'

import PathBar from '../components/PathBar.jsx'

import CodeViewPanel from '../components/CodeViewPanel.jsx'

import DatabaseViewPanel from '../components/DatabaseViewPanel.jsx'

import DiffViewer from '../components/DiffViewer.jsx'

import HistoryPanel from '../components/HistoryPanel.jsx'

import ProjectSettingsPanel from '../components/ProjectSettingsPanel.jsx'

import MorePanel from '../components/MorePanel.jsx'

import TurnApprovalBar from '../components/TurnApprovalBar.jsx'

import {api} from '../lib/api.js'

import {useAuth} from '../context/AuthContext.jsx'

import {useTrialCountdown, formatCountdown} from '../components/TrialCountdown.jsx'

import {useVoiceInput} from '../hooks/useVoiceInput.js'



// .zip también entra por acá: el backend lo abre y usa cada .sql/.backup/.dump que tenga

// adentro (y si alguno resulta ser un dump binario de pg_dump, avisa en vez de importarlo mal).

const SQL_EXT_RE = /\.(sql|backup|dump)$/i



// Word/Excel viejos (.doc/.xls de Office 97-2003) se dejan pasar acá para que el backend

// devuelva su propio mensaje claro ("guardalo como .docx/.xlsx") en vez de bloquearlos ya en el

// cliente con el mensaje genérico de "tipo no soportado".

const DOCUMENT_TYPES = new Set([

  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx

  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx

  'application/msword', // .doc

  'application/vnd.ms-excel', // .xls

])

const MAX_ATTACHMENTS = 5



// Cuántos mensajes trae de entrada (el resto se carga solo si el usuario scrollea hacia

// arriba) — así el editor no espera a bajar una conversación entera de cientos de mensajes

// para mostrar algo.

const MESSAGE_PAGE_SIZE = 30



const STEP_ICONS = { read: FileSearch, edit: FilePenLine, list: FolderSearch, db: Database, asset: Upload, storage: Upload, preview: Bug, test: MonitorPlay, restart: RotateCw, function: Server, question: ListChecks, memory: Brain }



// El orquestador de previews clona con git; si el token de GitHub del usuario ya no es

// válido, git falla con código 128 (o el mensaje de git trae "Authentication failed"/401).

// No hay forma de distinguir esto con un código de error estructurado (viene de un proceso

// git, no de la API de GitHub), así que se detecta por patrón en el texto del error.

function isGithubAuthFailure(errorText) {

  if (!errorText) return false

  return /código 128|authentication failed|invalid username or password|401/i.test(errorText)

}



const PREVIEW_ACTIVE_STATUSES = new Set(['installing', 'starting', 'running'])



function stepLabel(step, live) {

  if (step.type === 'telemetry') return step.label || (live ? 'Procesando...' : 'Procesado');

  switch (step.type) {

    case 'list':

      return live ? 'Explorando el repositorio…' : 'Exploró el repositorio'

    case 'read':

      return live ? `Leyendo ${step.path}…` : `Leyó ${step.path}`

    case 'edit':

      return live ? `Editando ${step.path}…` : `Editó ${step.path}`

    case 'db':

      return live ? 'Preparando cambios en la base de datos…' : 'Preparó un cambio en la base de datos'

    case 'db_check':

      return live ? 'Consultando los datos reales de la base…' : 'Consultó los datos reales de la base'

    case 'db_read':

      return live ? `Leyendo filas de "${step.table}"…` : `Leyó filas de "${step.table}"`

    case 'asset':

      return live ? `Subiendo ${step.path}…` : `Subió ${step.path}`

    case 'image':

      return live ? `Generando una imagen (${step.path})…` : `Generó una imagen (${step.path})`

    case 'storage':

      return live ? `Subiendo a Supabase Storage (${step.bucket})…` : `Subió a Supabase Storage (${step.bucket})`

    case 'preview':

      return live ? 'Revisando errores de la vista previa…' : 'Revisó los errores de la vista previa'

    case 'test':

      return live ? 'Probando la app en la vista previa…' : 'Probó la app en la vista previa'

    case 'restart':

      return live ? 'Reiniciando el servidor de la vista previa…' : 'Reinició el servidor de la vista previa'

      case 'web':

        return live ? 'Analizando página web…' : 'Analizó página web'

    case 'memory':

      return live ? 'Actualizando su memoria del proyecto…' : 'Actualizó su memoria del proyecto'

    default:

      return live ? 'Trabajando…' : 'Realizó una acción'

  }

}



// "list"+"read" (explorar el proyecto) y "edit" (tocar archivos) suelen venir en rachas de

// varios seguidos (leer 4 archivos, editar 3) — se agrupan en una sola línea con contador

// ("Editando archivos (3)") en vez de una línea por archivo, al estilo Lovable. El resto de

// los tipos (BD, asset, preview, test, etc.) son eventos sueltos y no se agrupan.

function groupKey(type) {

  if (type === 'list' || type === 'read') return 'explore'

  if (type === 'edit') return 'edit'

  return null

}



const GROUP_LABELS = {

  explore: { live: 'Explorando el proyecto', done: 'Exploró el proyecto' },

  edit: { live: 'Editando archivos', done: 'Editó archivos' },

}



function groupSteps(visible) {

  const groups = []

  for (const step of visible) {

    const key = groupKey(step.type)

    const last = groups[groups.length - 1]

    if (key && last?.key === key) {

      last.items.push(step)

    } else {

      groups.push({ key, items: [step] })

    }

  }

  return groups

}



// Timeline de lo que la IA fue haciendo en el turno (leer/editar/listar/BD/subir archivo),

// al estilo Lovable: un cuadro chico y colapsable en vez de una lista siempre abierta.

// Mismo componente para la burbuja en vivo (mientras "sending") y para el historial ya

// persistido en cada mensaje del asistente. En vivo arranca abierto (para ver el progreso);

// una vez que el turno termina y pasa a ser historial, arranca cerrado para no ensuciar el chat.



function UsageDropdown({ usage }) {

  const [open, setOpen] = useState(false);

  const ref = useRef(null);

  useEffect(() => {

    function handleClickOutside(event) {

      if (ref.current && !ref.current.contains(event.target)) {

        setOpen(false);

      }

    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);

  }, [ref]);



  if (!usage) return null;



  const totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);

  const timeSecs = ((usage.latencyMs || 0) / 1000).toFixed(1);



  return (

    <div className="relative" ref={ref}>

      <button onClick={() => setOpen(!open)} className="p-1 rounded hover:bg-white/5 text-text-muted transition-colors">

        <MoreHorizontal className="size-4" />

      </button>

      {open && (

        <div className="absolute right-0 mt-1 w-48 rounded-lg border border-white/10 bg-surface/95 backdrop-blur-md p-2 shadow-xl z-10 text-sm">

          <div className="flex items-center gap-2 px-2 py-1.5 text-text/90">

            <History className="size-3.5 text-text-muted" />

            <span>Tiempo: {timeSecs}s</span>

          </div>

          <div className="flex items-center gap-2 px-2 py-1.5 text-text/90">

            <Zap className="size-3.5 text-text-muted" />

            <span>Tokens: {totalTokens}</span>

          </div>

        </div>

      )}

    </div>

  );

}

function ActionSteps({ steps, live }) {

  if (!live) return null;

  const visible = (steps || []).filter((s) => s.type !== 'thinking' && s.type !== 'usage');

  if (visible.length === 0) return null;

  

  const last = visible[visible.length - 1];

  

  return (

    <div className="flex items-center gap-2 mb-1.5 mt-1 text-primary">

      <Loader2 className="size-4 shrink-0 animate-spin" />

      <span className="text-sm font-medium text-primary/90">{stepLabel(last, true)}...</span>

    </div>

  );

}



            function TypingDots() {

  return (

    <span className="flex items-center gap-1">

      <span className="typing-dot size-1.5 rounded-full bg-current" style={{ animationDelay: '0ms' }} />

      <span className="typing-dot size-1.5 rounded-full bg-current" style={{ animationDelay: '150ms' }} />

      <span className="typing-dot size-1.5 rounded-full bg-current" style={{ animationDelay: '300ms' }} />

    </span>

  )

}





const MarkdownComponents = {

  p: ({node, ...props}) => <p className="mb-1 last:mb-0" {...props} />,

  strong: ({node, ...props}) => <strong className="font-semibold text-white" {...props} />,

  em: ({node, ...props}) => <em className="italic" {...props} />,

  code: ({node, inline, ...props}) => inline ? <code className="bg-surface/60 rounded px-1.5 py-0.5 font-mono text-[13px] text-primary" {...props} /> : <code className="block bg-surface/60 rounded-md p-2.5 font-mono text-[13px] text-text overflow-x-auto my-2" {...props} />,

  ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-1.5 space-y-0.5" {...props} />,

  ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-1.5 space-y-0.5" {...props} />,

  li: ({node, ...props}) => <li {...props} />,

  a: ({node, ...props}) => <a className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" {...props} />

}



export default function Chat() {

  const { projectId } = useParams()

  const location = useLocation()

  const { user } = useAuth()

  const trialRemainingMs = useTrialCountdown(user?.trialActive ? user.trialExpiresAt : null)

  const autoSentRef = useRef(false)



  const [project, setProject] = useState(null)

  const [migrating, setMigrating] = useState(false)

  const [migrateError, setMigrateError] = useState(null)

  const [conversationId, setConversationId] = useState(null)

  const [messages, setMessages] = useState([])

  const [changes, setChanges] = useState([])

  const [dbChanges, setDbChanges] = useState([])

  const [assetChanges, setAssetChanges] = useState([])

  const [edgeFunctionChanges, setEdgeFunctionChanges] = useState([])

  const [answeredQuestionIds, setAnsweredQuestionIds] = useState(() => new Set())

  const [stagedFiles, setStagedFiles] = useState([]) // [{ file, previewUrl }]

  const [selectedElement, setSelectedElement] = useState(null)

  const [input, setInput] = useState('')

  const voice = useVoiceInput(

    useCallback((transcript) => setInput((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript)), []),

  )

  const [loading, setLoading] = useState(true)

  const [sending, setSending] = useState(false)



  useEffect(() => {

    const handleSnapshotMessage = (event) => {

      if (event.data?.type === 'FLOWPRO_SNAPSHOT_SUCCESS') {

        setMessages((prev) => {

          const msgs = [...prev];

          for (let i = msgs.length - 1; i >= 0; i--) {

            if (msgs[i].role === 'assistant') {

              msgs[i] = { ...msgs[i], snapshotUrl: event.data.payload };

              break;

            }

          }

          return msgs;

        });

      }

    };

    window.addEventListener('message', handleSnapshotMessage);

    return () => window.removeEventListener('message', handleSnapshotMessage);

  }, []);



  const [error, setError] = useState(null)

  const [activity, setActivity] = useState([])

  // Turno del agente que arrancó SOLO en el servidor (ej. "conectar el código" después de

  // importar un backup, ver dbImport.js#triggerConnectCodeTurn) — a diferencia de "sending"

  // (una request que ESTE cliente disparó y está esperando), acá no hay ninguna promesa propia

  // que esperar: solo un flag ("autoTurn: true" en la respuesta) de que hay un turno corriendo

  // en background y hay que pollear hasta que aparezca su mensaje.

  const [autoTurnActive, setAutoTurnActive] = useState(false)

  const [uploading, setUploading] = useState(false)

  const [dbMismatch, setDbMismatch] = useState(null)

  const [showPreview, setShowPreview] = useState(true)

  const [rightView, setRightView] = useState('preview')



  const [currentPreviewRoute, setCurrentPreviewRoute] = useState('/');

  const [previewRoutes, setPreviewRoutes] = useState([

    { label: "Página de inicio", path: "/" },

    { label: "Dashboard", path: "/dashboard" },

    { label: "Login", path: "/login" },

    { label: "Not Found", path: "/404" }

  ]);



  // Sincronizar ruta desde el iframe

  useEffect(() => {

    const handleMessage = (event) => {

      if (event.data?.type === 'FLOWPRO_ROUTE_CHANGED') {

        setCurrentPreviewRoute(event.data.path);

      }

    };

    window.addEventListener('message', handleMessage);

    return () => window.removeEventListener('message', handleMessage);

  }, []);

 // 'preview' | 'code'

  // En mobile no hay panel dividido (no entran los dos lado a lado) — se muestra uno u otro a

  // pantalla completa, con este selector tipo Lovable para pasar de uno a otro. En desktop no

  // se usa: ahí showPreview + el split resizable siguen mandando como siempre.

  const [mobileView, setMobileView] = useState('chat')

  const [showScrollDown, setShowScrollDown] = useState(false)

  const [inspectOverlay, setInspectOverlay] = useState(null) // { kind: 'code' | 'db', change }

  const [showHistory, setShowHistory] = useState(false)

  const [showSettings, setShowSettings] = useState(false)

  const [showMore, setShowMore] = useState(false)

  const [moreInitialTab, setMoreInitialTab] = useState('functions')

  const [linkCopied, setLinkCopied] = useState(false)

  const [historyKey, setHistoryKey] = useState(0)

  const [undoState, setUndoState] = useState('idle') // 'idle' | 'confirm' | 'loading'

  const [undoError, setUndoError] = useState(null)

  const [mode, setMode] = useState('build')

  const [previewWidthPct, setPreviewWidthPct] = useState(() => {

    const saved = Number(localStorage.getItem('gitflow_preview_width'))

    return saved >= 25 && saved <= 75 ? saved : 45

  })

  const [resizing, setResizing] = useState(false)

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e) => {
      if (!splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const containerWidth = rect.width;
      if (containerWidth === 0) return;
      // Chat is on the left, Preview is on the right. 
      // e.clientX - rect.left is the width of the chat pane.
      // So preview width is containerWidth - chatWidth.
      const previewW = containerWidth - (e.clientX - rect.left);
      let pct = (previewW / containerWidth) * 100;
      if (pct < 20) pct = 20;
      if (pct > 80) pct = 80;
      setPreviewWidthPct(pct);
    };
    const handleUp = () => {
      setResizing(false);
      setPreviewWidthPct((pct) => {
        localStorage.setItem('gitflow_preview_width', pct);
        return pct;
      });
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [resizing]);

  const [chatHidden, setChatHidden] = useState(false)

  const [hasMoreMessages, setHasMoreMessages] = useState(false)

  const [loadingMore, setLoadingMore] = useState(false)



  // Estado del preview en sí (antes vivía adentro de PreviewPanel.jsx) — vive acá ahora para

  // poder dibujar sus controles (viewport, ruta, seleccionar, recargar) en la barra unificada

  // de arriba, junto con Integraciones/Base de datos/Publicar, en vez de en una barra propia.

  const [previewStatus, setPreviewStatus] = useState(null) // null = cargando

  const [previewStarting, setPreviewStarting] = useState(false)

  const [previewError, setPreviewError] = useState(null)

  const [previewReloadKey, setPreviewReloadKey] = useState(0)

  const [previewViewport, setPreviewViewport] = useState('desktop')

  const [autoFixing, setAutoFixing] = useState(false)

  const [previewCurrentPath, setPreviewCurrentPath] = useState('/')

  const [previewPages, setPreviewPages] = useState([])

  const [showPagesDropdown, setShowPagesDropdown] = useState(false)

  const [pageSearch, setPageSearch] = useState('')

  // La ruta que en verdad se ve en el iframe ahora mismo: arranca igual a previewCurrentPath,

  // pero puede divergir si el usuario navega DENTRO de la app (clics, router propio) sin pasar

  // por el selector de página — previewCurrentPath solo cambia cuando forzamos una recarga.

  const [previewDisplayPath, setPreviewDisplayPath] = useState('/')

  const [previewSelectMode, setPreviewSelectMode] = useState(false)

  const bottomRef = useRef(null)

  const mainRef = useRef(null)

  const abortRef = useRef(null)

  const fileInputRef = useRef(null)

  const splitRef = useRef(null)

  const textareaRef = useRef(null)

  const oldestCursorRef = useRef(null)

  const pendingScrollAdjustRef = useRef(null) // scrollHeight de antes de anteponer mensajes viejos

  const skipAutoScrollRef = useRef(false) // true cuando el cambio en `messages` vino de cargar más viejos, no de un mensaje nuevo

  const previewPollRef = useRef(null)

  const previewAutoStartedRef = useRef(false)

  const wakeAttemptRef = useRef(0)

  const previewIframeRef = useRef(null)





  const wasActiveRef = useRef(false)

  useEffect(() => {

    if (sending || autoTurnActive) {

      wasActiveRef.current = true

    } else if (wasActiveRef.current) {

      wasActiveRef.current = false

      setPreviewReloadKey(k => k + 1)

    }

  }, [sending, autoTurnActive])



  useEffect(() => {

    let cancelled = false

    async function init() {

      setLoading(true)

      setError(null)

      try {

        const proj = await api.getProject(projectId)

        if (cancelled) return

        setProject(proj)

        const existing = await api.conversations(projectId)

        const convo = existing[0] || (await api.createConversation(projectId, proj.name))

        if (cancelled) return

        setConversationId(convo.id)

        const data = await api.conversationMessages(convo.id, { limit: MESSAGE_PAGE_SIZE })

        if (cancelled) return

        setMessages(data.messages)

        setChanges(data.changes)

        setDbChanges(data.dbChanges || [])

        setAssetChanges(data.assetChanges || [])

        setEdgeFunctionChanges(data.edgeFunctionChanges || [])

        setHasMoreMessages(Boolean(data.hasMore))

        oldestCursorRef.current = data.oldestCursor

      } catch (err) {

        if (!cancelled) setError(err.message)

      } finally {

        if (!cancelled) setLoading(false)

      }

    }

    init()

    return () => {

      cancelled = true

    }

  }, [projectId])



  // Si se recarga la página (F5) mientras el agente sigue trabajando en el servidor —ya sea un

  // turno que ESTA pestaña había mandado, o uno que arrancó solo (ver runAutoConnectLoop)— el

  // progreso en vivo se perdía: "sending"/"autoTurnActive" son estado de React, no sobreviven un

  // F5, y sin alguno de los dos en true no arranca ningún polling de actividad. Acá se pregunta

  // una vez, apenas se conoce la conversación, si el servidor todavía tiene un turno en curso

  // para ella (progressTracker.js solo tiene una entrada mientras el turno no terminó) y, si la

  // hay, se prende "autoTurnActive" para retomar el mismo polling que ya sabe mostrar la

  // actividad en vivo y cerrarse solo apenas aparezca el mensaje final.

  useEffect(() => {

    if (!conversationId) return

    let cancelled = false

    api

      .conversationActivity(conversationId)

      .then((a) => {

        if (!cancelled && a.updatedAt) setAutoTurnActive(true)

      })

      // .catch(() => {})

    return () => {

      cancelled = true

    }

  }, [conversationId])



  const previewPoll = useCallback(async () => {

    try {

      const s = await api.previewStatus()

      setPreviewStatus(s)

      return s

    } catch {

      /* ignorar fallos puntuales de polling */

      return null

    }

  }, [])



  const previewStart = useCallback(async () => {

    setPreviewStarting(true)

    setPreviewError(null)

    try {

      const s = await api.startPreview(projectId)

      setPreviewStatus(s)

      previewPollRef.current = setTimeout(previewPoll, 2000)

    } catch (err) {

      setPreviewError(err.detail ? `${err.message}: ${err.detail}` : err.message)

    } finally {

      setPreviewStarting(false)

    }

  }, [projectId, previewPoll])



  // Reinicia el estado del preview cada vez que se cambia de proyecto (antes lo lograba el

  // "key={projectId}" en <PreviewPanel>, que la remontaba entera) y dispara el primer poll +

  // auto-arranque. Comparten el mismo ciclo a propósito: si se hicieran por separado, el

  // polling podía capturar el estado "idle" justo antes de que arrancara y quedarse detenido

  // para siempre, sin enterarse nunca de que el preview ya estaba instalándose/corriendo.

  useEffect(() => {

    if (!project) return

    let cancelled = false

    previewAutoStartedRef.current = false

    wakeAttemptRef.current = 0

    setPreviewStatus(null)

    setPreviewError(null)

    setPreviewReloadKey(0)

    setPreviewViewport('desktop')

    setPreviewCurrentPath('/')

    setPreviewDisplayPath('/')

    previewPoll().then((s) => {

      if (cancelled || previewAutoStartedRef.current) return

      previewAutoStartedRef.current = true

      const alreadyActive = s && s.repoFullName === project.repoFullName && PREVIEW_ACTIVE_STATUSES.has(s.status)

      if (!alreadyActive) previewStart()

    })

    return () => {

      cancelled = true

      clearTimeout(previewPollRef.current)

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [projectId, project?.repoFullName])



  useEffect(() => {

    clearTimeout(previewPollRef.current)

    if (!previewStatus) return

    const delay =

      previewStatus.status === 'running' ? 15000 : previewStatus.status === 'idle' || previewStatus.status === 'error' ? 10000 : 3000

    if (delay) previewPollRef.current = setTimeout(previewPoll, delay)

    return () => clearTimeout(previewPollRef.current)

  }, [previewStatus, previewPoll])



  useEffect(() => {

    if (previewStatus?.status === 'running') {

      wakeAttemptRef.current = 0

    }

    if (previewStatus?.status === 'idle' && !previewStarting && wakeAttemptRef.current < 2) {

      wakeAttemptRef.current += 1

      previewStart().catch(() => {})

    }

  }, [previewStatus?.status, previewStarting, previewStart])

  useEffect(() => {

    if (previewStatus?.status === 'error' && isGithubAuthFailure(previewStatus.error)) {

      window.dispatchEvent(new Event('gitflow:github-reauth-required'))

      return

    }



    // Auto-healing silencioso: si falla, intentar arreglar sin preguntar

    if (

      previewStatus?.status === 'error' &&

      previewStatus?.repoFullName === project?.repoFullName &&

      !autoFixing &&

      mode !== 'plan'

    ) {

      setAutoFixing(true)

      api.autoFixPreview(conversationId, previewStatus.error, previewStatus.logsTail)// .catch(() => {})

      // Hacemos poll igual para ir viendo cuando se levante o cambie de estado

      clearTimeout(previewPollRef.current)

      previewPollRef.current = setTimeout(previewPoll, 3000)

    } else if (previewStatus?.status !== 'error') {

      setAutoFixing(false)

    }

  }, [previewStatus, project, conversationId, mode, autoFixing, previewPoll])



  const previewIsThisRepo = previewStatus?.repoFullName === project?.repoFullName

  const previewIsRunningHere = previewStatus?.status === 'running' && previewIsThisRepo



  const previewNavigate = (path) => {

    setPreviewCurrentPath(path)

    setPreviewDisplayPath(path)

    setPreviewReloadKey((k) => k + 1)

  }



  // El script inyectado en el preview (gitflow-selector.js, ver nginx sub_filter) escucha este

  // mensaje para prender/apagar el modo selección, y contesta por postMessage cuando el

  // usuario hace clic en un elemento — acá lo recibimos.

  const previewToggleSelectMode = () => {

    const next = !previewSelectMode

    setPreviewSelectMode(next)

    previewIframeRef.current?.contentWindow?.postMessage({ type: 'gitflow:select-mode', enabled: next }, previewStatus?.url || '*')

  }



  useEffect(() => {

    setPreviewSelectMode(false)

  }, [previewReloadKey])



  useEffect(() => {

    if (!previewStatus?.url) return

    const previewOrigin = new URL(previewStatus.url).origin

    const onMessage = (e) => {

      if (e.origin !== previewOrigin) return

      if (e.data?.type === 'gitflow:selected') {

        setPreviewSelectMode(false)

        setSelectedElement(e.data.payload)

      }

      if (e.data?.type === 'gitflow:navigated' && typeof e.data.path === 'string') {

        setPreviewDisplayPath(e.data.path)

      }

    }

    window.addEventListener('message', onMessage)

    return () => window.removeEventListener('message', onMessage)

  }, [previewStatus?.url])



  // El navegador puede reusar una respuesta cacheada para esta URL exacta del preview (Vite no

  // manda ETag/Last-Modified, así que "Cache-Control: no-cache" no siempre alcanza para forzar

  // una revalidación real) — con el mismo src de siempre, una recarga puede terminar sirviendo

  // el HTML de ANTES de la última vez que se tocó el proyecto. Un parámetro que cambia en cada

  // recarga garantiza que cada navegación del iframe sea siempre una petición nueva.

  // "_pt" es el token que exige nginx (ver auth_request en gitflow-preview-subdomains) para

  // dejar pasar a un proyecto sin publicar — sin esto, cualquiera que adivinara el subdominio

  // podría verlo antes de que el dueño lo publique.

  const previewIframeSrc = previewStatus?.url

    ? `${previewStatus.url}${previewCurrentPath}${previewCurrentPath.includes('?') ? '&' : '?'}t=${Date.now()}${

        previewStatus.previewToken ? `&_pt=${encodeURIComponent(previewStatus.previewToken)}` : ''

      }`

    : ''



  // Mismo criterio para cualquier link que abra el preview FUERA del iframe (pestaña nueva,

  // links del selector de páginas): sin el token, esos también pegarían contra el muro de

  // "no publicado".

  const withPreviewToken = (path) => {

    if (!previewStatus?.url) return ''

    if (!previewStatus.previewToken) return `${previewStatus.url}${path}`

    return `${previewStatus.url}${path}${path.includes('?') ? '&' : '?'}_pt=${encodeURIComponent(previewStatus.previewToken)}`

  }



  // Trae la página anterior (mensajes más viejos) y los antepone — el ajuste de scroll para

  // que no "salte" la pantalla lo hace el useLayoutEffect de abajo, una vez que React ya pintó

  // el contenido nuevo arriba.

  const loadOlderMessages = async () => {

    if (!conversationId || !hasMoreMessages || loadingMore || !oldestCursorRef.current) return

    setLoadingMore(true)

    try {

      const data = await api.conversationMessages(conversationId, { limit: MESSAGE_PAGE_SIZE, before: oldestCursorRef.current })

      pendingScrollAdjustRef.current = mainRef.current?.scrollHeight ?? null

      skipAutoScrollRef.current = true

      setMessages((prev) => [...data.messages, ...prev])

      setChanges((prev) => [...data.changes, ...prev])

      setDbChanges((prev) => [...(data.dbChanges || []), ...prev])

      setAssetChanges((prev) => [...(data.assetChanges || []), ...prev])

      setEdgeFunctionChanges((prev) => [...(data.edgeFunctionChanges || []), ...prev])

      setHasMoreMessages(Boolean(data.hasMore))

      oldestCursorRef.current = data.oldestCursor

    } catch {

      // si falla, el usuario puede seguir scrolleando y se reintenta solo

    } finally {

      setLoadingMore(false)

    }

  }



  const onMessagesScroll = () => {

    const el = mainRef.current

    if (!el) return

    if (el.scrollTop < 200) loadOlderMessages()

    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 150)

  }



  // Compensa el scroll DESPUÉS de que React ya insertó los mensajes viejos arriba, para que el

  // usuario quede mirando exactamente lo mismo que estaba mirando (sin este ajuste, agregar

  // contenido arriba del todo empuja todo hacia abajo y la vista "salta").

  useLayoutEffect(() => {

    if (pendingScrollAdjustRef.current == null) return

    const el = mainRef.current

    if (el) el.scrollTop += el.scrollHeight - pendingScrollAdjustRef.current

    pendingScrollAdjustRef.current = null

  }, [messages])



  useEffect(() => {

    if (skipAutoScrollRef.current) {

      skipAutoScrollRef.current = false

      return

    }

    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })

  }, [messages, changes, sending])



  // Caja de mensaje que crece con el contenido (hasta un máximo, después scrollea) en vez de

  // un input de una sola línea — así un mensaje largo se puede ver y editar completo.

  useEffect(() => {

    const el = textareaRef.current

    if (!el) return

    el.style.height = 'auto'

    el.style.height = `${Math.min(el.scrollHeight, 200)}px`

  }, [input])



  useEffect(() => {

    const initialPrompt = location.state?.initialPrompt

    const initialAttachments = location.state?.initialAttachments

    if (!loading && !autoSentRef.current && initialPrompt && messages.length === 0 && conversationId) {

      autoSentRef.current = true

      send(undefined, initialPrompt, initialAttachments?.length ? initialAttachments : undefined)

    }

    // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [loading, messages.length, conversationId])



  // Al entrar al editor de un repo, la vista previa se muestra sola (estilo Lovable).

  // El auto-arranque en sí corre en el efecto de arriba que resetea el estado del preview por

  // proyecto (busca "previewAutoStartedRef").

  useEffect(() => {

    if (!conversationId) return

    setShowPreview(true)

  }, [conversationId])



  const send = async (e, overrideContent, overrideFiles, dummyMode, agentId) => {
    e?.preventDefault()
    let content = overrideContent ?? input.trim()
    const files = overrideFiles ?? stagedFiles.map((s) => s.file)
    const elementContext = selectedElement

    if ((!content && files.length === 0) || sending || autoTurnActive || !conversationId) return

    // Save previous state for rollback
    const previousInput = input;
    const previousStagedFiles = [...stagedFiles];

    setInput('')
    setStagedFiles([])
    setSelectedElement(null)
    setSending(true)
    setError(null)

    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: 'user', content: content || files.map((f) => `?? ${f.name}`).join(' ') },
    ])

    const controller = new AbortController()
    abortRef.current = controller

    try {

      const onEvent = (event, data) => {
        setActivity(prev => [...prev, data])
      }
      setActivity([])
      const result = files.length > 0
        ? await api.sendMessageWithAttachments(conversationId, content, files, controller.signal, mode, elementContext, agentId, onEvent)
        : await api.sendMessage(conversationId, content, controller.signal, mode, elementContext, agentId, onEvent)
      
      // If the backend returns a DATABASE_BACKUP JSON directly (because it's a migration zip)
      if (result && result.type === 'DATABASE_BACKUP') {
        const appendedMessages = [];
        if (result.userMessage) appendedMessages.push(result.userMessage);
        
        if (result.bypassedCard) {
          appendedMessages.push({
            id: 'supabase-connect-' + Date.now(),
            role: 'assistant',
            content: 'Base de datos migrada automaticamente usando tu conexion de Supabase existente.'
          });
          setMessages(prev => [...prev.filter((m) => !m.id.startsWith('tmp-')), ...appendedMessages]);
          if (typeof fetchPreviewStatus === 'function') fetchPreviewStatus();
        } else {
          appendedMessages.push({
            id: 'supabase-connect-' + Date.now(),
            role: 'assistant',
            type: 'supabase_connect',
            zipExtractPath: result.zipExtractPath,
            initialProjectRef: result.projectRef || '',
            initialAnonKey: result.anonKey || ''
          });
          setMessages(prev => [...prev.filter((m) => !m.id.startsWith('tmp-')), ...appendedMessages]);
        }
        return;
      }

      setMessages((prev) => [...prev.filter((m) => !m.id.startsWith('tmp-')), result?.userMessage, result?.assistantMessage].filter(Boolean))
      if (result.dbChanges?.length) setDbChanges((prev) => [...prev, ...result.dbChanges])
        if (result.changes?.length) setChanges((prev) => [...prev, ...result.changes])
        if (result.assetChanges?.length) setAssetChanges((prev) => [...prev, ...result.assetChanges])
        if (result.edgeFunctionChanges?.length) setEdgeFunctionChanges((prev) => [...prev, ...result.edgeFunctionChanges])
      if (result.autoTurn) setAutoTurnActive(true)
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Error al enviar mensaje')
      setMessages((prev) => prev.filter((m) => !m.id.startsWith('tmp-')))
      
      // Rollback UX: restore text and files so the user doesn't lose them
      setInput(previousInput)
      setStagedFiles(previousStagedFiles)
      throw err;
    } finally {
      setSending(false)
      abortRef.current = null
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('chat-action', { detail: { action: 'snapshot' } }))
      }, 300)
    }
  }

  const handleIncomingFiles = async (fileList) => {

    const files = Array.from(fileList || [])

    if (files.length === 0 || !conversationId) return



    // Redirigir TODOS los archivos ZIP al endpoint polimorfico
    const isDbZip = files.length === 1 && files[0].name.toLowerCase().endsWith('.zip');



    if (isDbZip) {

      if (true) {

        setUploading(true)

        setError(null)

        try {

          const formData = new FormData()

          formData.append('file', files[0])

          const token = localStorage.getItem('gitflow_token');

          const res = await fetch(`/api/projects/${projectId}/upload-file`, {

            method: 'POST',

            headers: { 'Authorization': `Bearer ${token}` },

            body: formData

          })

          const data = await res.json()
          if (!res.ok || !data.success) throw new Error(data.error || 'Error al procesar archivo')
          
          if (data.type === 'DATABASE_BACKUP') {
            if (data.bypassedCard) {
              setMessages(prev => [...prev, {
                id: 'supabase-connect-' + Date.now(),
                role: 'assistant',
                content: 'Base de datos migrada automaticamente usando tu conexion de Supabase existente.'
              }]);
              if (typeof fetchPreviewStatus === 'function') fetchPreviewStatus();
            } else {
              setMessages(prev => [...prev, {
                id: 'supabase-connect-' + Date.now(),
                role: 'assistant',
                type: 'supabase_connect',
                zipExtractPath: data.zipExtractPath,
                initialProjectRef: data.projectRef || '',
                initialAnonKey: data.anonKey || ''
              }]);
            }
          } else {
            setMessages(prev => [...prev, {
              id: 'asset-upload-' + Date.now(),
              role: 'assistant',
              content: `[ASSET] ${data.message || 'Archivo importado con exito'}`
            }]);
          }

        } catch (e) {

          setError(e.message)

        } finally {

          setUploading(false)

        }

      } else {

        await executeDatabaseImport(files[0]);

      }

      return;

    }



    // Import de dump SQL: un solo archivo a la vez, como antes — no se mezcla con adjuntos.

    if (files.length === 1 && SQL_EXT_RE.test(files[0].name)) {

      setUploading(true)

      setError(null)

      try {

        const result = await api.importSqlDump(conversationId, files[0])

        setMessages((prev) => [...prev, result?.userMessage, result?.assistantMessage].filter(Boolean))

        if (result.dbChanges?.length) setDbChanges((prev) => [...prev, ...result.dbChanges])
        if (result.changes?.length) setChanges((prev) => [...prev, ...result.changes])
        if (result.assetChanges?.length) setAssetChanges((prev) => [...prev, ...result.assetChanges])
        if (result.edgeFunctionChanges?.length) setEdgeFunctionChanges((prev) => [...prev, ...result.edgeFunctionChanges])

        if (result.autoTurn) setAutoTurnActive(true)

      } catch (err) {

        if (err.code === 'no_db_connection') {

          // Antes esto era un callejón sin salida: el error decía "conectala primero" sin dar

          // ninguna forma de hacerlo desde acá — se abre directo el panel donde se elige

          // Supabase o la base de datos automática, en vez de un texto sin acción posible.

          setError('Conectá una base de datos para este proyecto y volvé a intentar subir el backup.')

          setMoreInitialTab('integrations')

          setRightView('more')

        } else {

          setError(err.detail ? `${err.message}: ${err.detail}` : err.message)

        }

      } finally {

        setUploading(false)

      }

      return

    }



    const invalid = files.some((f) => !f.type.startsWith('image/') && f.type !== 'application/pdf' && !DOCUMENT_TYPES.has(f.type))

    if (invalid) {

      setError('Solo se pueden adjuntar imágenes, PDF, Word o Excel (para importar una base de datos, soltá un único .sql o .zip)')

      return

    }



    if (stagedFiles.length + files.length > MAX_ATTACHMENTS) {

      setError(`Podés adjuntar hasta ${MAX_ATTACHMENTS} archivos por mensaje`)

    } else {

      setError(null)

    }

    stageFiles(files)

  }



  const onFilePicked = (e) => {

    // Ojo: e.target.files es un FileList VIVO ligado al input — hay que copiarlo a un array

    // ANTES de limpiar e.target.value, porque limpiar el value vacía ese mismo FileList (no

    // crea uno nuevo), y si guardáramos solo la referencia llegaría vacío a handleIncomingFiles.

    const files = Array.from(e.target.files || [])

    e.target.value = ''

    handleIncomingFiles(files)

  }



  // Arrastrar y soltar un archivo en cualquier parte del panel de chat, como pegar/adjuntar

  // pero sin pasar por el selector de archivos. dragEnter/dragLeave se disparan también al

  // pasar sobre hijos (mensajes, botones, etc.), así que se cuenta con un ref en vez de un

  // simple booleano para no parpadear el overlay mientras el cursor cruza esos límites.

  const dragCounterRef = useRef(0)

  const [isDraggingFile, setIsDraggingFile] = useState(false)

  const [isImportingDb, setIsImportingDb] = useState(false)

  const [importStatusStep, setImportStatusStep] = useState('')



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
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingFile(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      window.dispatchEvent(new CustomEvent('chat-staged-drop', { detail: { files: e.dataTransfer.files } }));
    }
  }



  const updateChange = (id, patch) => setChanges((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))



  const appendFollowUp = (msg) => {

    if (msg) setMessages((prev) => [...prev, msg])

  }



  const showFullDiff = (change) => {

    setInspectOverlay({ kind: 'code', change })

    setShowPreview(true)

  }

  const showFullSql = (change) => {

    setInspectOverlay({ kind: 'db', change })

    setShowPreview(true)

  }

  const closeInspectOverlay = (kind, id) => {

    setInspectOverlay((cur) => (cur?.kind === kind && cur.change.id === id ? null : cur))

  }



  const approve = async (id) => {

    const { followUpMessage, ...updated } = await api.approveChange(id)

    updateChange(id, updated)

    appendFollowUp(followUpMessage)

    closeInspectOverlay('code', id)

  }

  const reject = async (id) => {

    const updated = await api.rejectChange(id)

    updateChange(id, updated)

    closeInspectOverlay('code', id)

  }



  // Botón único por turno (solo aparece en una etapa de un plan largo, ver TurnApprovalBar):

  // aplica/rechaza de una todos los cambios de código + BD pendientes de ese mensaje.

  const approveAllForMessage = async (messageId) => {

    const result = await api.approveAllForMessage(messageId)

    if (result.changes?.length) {

      setChanges((prev) => prev.map((c) => result.changes.find((u) => u.id === c.id) || c))

    }

    if (result.dbChanges?.length) {

      setDbChanges((prev) => prev.map((c) => result.dbChanges.find((u) => u.id === c.id) || c))

    }

    appendFollowUp(result.followUpMessage)

  }

  const rejectAllForMessage = async (messageId) => {

    const result = await api.rejectAllForMessage(messageId)

    if (result.changes?.length) {

      setChanges((prev) => prev.map((c) => result.changes.find((u) => u.id === c.id) || c))

    }

    if (result.dbChanges?.length) {

      setDbChanges((prev) => prev.map((c) => result.dbChanges.find((u) => u.id === c.id) || c))

    }

  }



  const updateDbChange = (id, patch) => setDbChanges((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))



  const approveDb = async (id) => {

    const { followUpMessage, ...updated } = await api.approveDbChange(id)

    updateDbChange(id, updated)

    appendFollowUp(followUpMessage)

    closeInspectOverlay('db', id)

  }

  const rejectDb = async (id) => {

    const updated = await api.rejectDbChange(id)

    updateDbChange(id, updated)

    closeInspectOverlay('db', id)

  }



  const answerQuestion = async (messageId, answerText) => {

    setAnsweredQuestionIds((prev) => new Set(prev).add(messageId))

    await send(null, answerText)

  }



  // Elección de Supabase/Flow Cloud para un backup de Lovable (ver DbChoiceCard.jsx) — a

  // diferencia de answerQuestion, NO manda nada al chat como mensaje de usuario: el backend ya

  // hizo el trabajo (armó la base, importó los datos) y esto solo agrega su mensaje de resultado.

  const onDbBackupChoiceDone = (messageId, followUpMessage, opts) => {

    if (opts?.openIntegrations) {

      setMoreInitialTab('integrations')

      setRightView('more')

      return

    }

    setAnsweredQuestionIds((prev) => new Set(prev).add(messageId))

    if (followUpMessage) setMessages((prev) => [...prev, followUpMessage])

    if (opts?.autoTurn) setAutoTurnActive(true)

  }



  const updateEdgeFunctionChange = (id, patch) =>

    setEdgeFunctionChanges((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))



  const showFullFunctionCode = (change) => {

    setInspectOverlay({ kind: 'function', change })

    setShowPreview(true)

  }



  const approveEdgeFunction = async (id) => {

    const { followUpMessage, ...updated } = await api.approveEdgeFunctionChange(id)

    updateEdgeFunctionChange(id, updated)

    appendFollowUp(followUpMessage)

    closeInspectOverlay('function', id)

  }

  const rejectEdgeFunction = async (id) => {

    const updated = await api.rejectEdgeFunctionChange(id)

    updateEdgeFunctionChange(id, updated)

    closeInspectOverlay('function', id)

  }



  const updateAssetChange = (id, patch) => setAssetChanges((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))



  const approveAsset = async (id) => {

    const { followUpMessage, ...updated } = await api.approveAssetChange(id)

    updateAssetChange(id, updated)

    appendFollowUp(followUpMessage)

  }

  const rejectAsset = async (id) => {

    const updated = await api.rejectAssetChange(id)

    updateAssetChange(id, updated)

  }



  // Deshacer rápido: restaura al checkpoint ANTERIOR al más reciente (el más reciente ES el

  // estado actual, producto del último cambio aplicado) — así un solo botón revierte "lo último

  // que hizo la IA (o yo mismo desde la vista de código)" sin tener que abrir el panel completo

  // de Historial y elegir manualmente.

  const undoLastChange = async () => {

    if (undoState === 'loading') return

    if (undoState !== 'confirm') {

      setUndoState('confirm')

      setTimeout(() => setUndoState((s) => (s === 'confirm' ? 'idle' : s)), 4000)

      return

    }

    setUndoState('loading')

    setUndoError(null)

    try {

      const checkpoints = await api.listCheckpoints(projectId)

      if (checkpoints.length < 2) {

        setUndoError('No hay un cambio anterior al que volver todavía.')

        return

      }

      await api.restoreCheckpoint(projectId, checkpoints[1].id)

      setHistoryKey((k) => k + 1)

      window.location.reload()

    } catch (err) {

      setUndoError(err.detail ? `${err.message}: ${err.detail}` : err.message)

    } finally {

      setUndoState('idle')

    }

  }



  const copyShareLink = async () => {

    if (!project?.slug || !project?.publishedAt) {

      // Sin subdominio propio, o todavía sin publicar — el link público no muestra nada hasta

      // que se publique (ver auth_request en nginx), así que no tiene sentido copiar un link

      // muerto: mandamos directo al panel donde puede elegir el subdominio y/o publicar.

      setShowSettings(true)

      return

    }

    try {

      await navigator.clipboard.writeText(`https://${project.slug}.flow-pro.online`)

      setLinkCopied(true)

      setTimeout(() => setLinkCopied(false), 2000)

    } catch {

      /* portapapeles no disponible (permiso denegado, contexto no seguro, etc.) */

    }

  }



  const migrateToGithub = async () => {

    if (migrating) return

    setMigrating(true)

    setMigrateError(null)

    try {

      const result = await api.migrateToGithub(projectId)

      setProject((prev) => ({ ...prev, storageType: result.storageType, repoFullName: result.repoFullName }))

    } catch (err) {

      setMigrateError(err.detail ? `${err.message}: ${err.detail}` : err.message)

    } finally {

      setMigrating(false)

    }

  }



  // Mensajes internos de un turno automático (el prompt gigante de "conectar el código", el

  // ida-y-vuelta de "seguí con la siguiente etapa" — ver conversationTurn.js#runAutoConnectLoop)

  // nunca se muestran: no son conversación real, es implementación de un turno que el usuario

  // nunca escribió ni tiene por qué leer. Solo el mensaje final (ya desoculto en el backend)

    const visibleMessages = messages.filter((m) => !m.hidden)



  return (

    <div className="flex h-screen flex-col overflow-hidden bg-[#0d0d0d]">

      {/* DESKTOP HEADER */}

      <div className="hidden md:flex h-14 items-center justify-between border-b border-white/10 bg-[#161616] px-4 w-full">

        {/* LEFT GROUP */}

        <div className="flex items-center gap-4 flex-shrink min-w-[200px]">

          <Link to="/dashboard" className="flex items-center text-white/50 hover:text-white transition-colors">

            <Menu className="size-5" />

          </Link>

          <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1 rounded-md transition-colors">

            {project?.logoUrl && <img src={project.logoUrl} alt="" className="size-5 shrink-0 rounded object-cover" />}

            <span className="max-w-[16rem] truncate text-[15px] font-semibold text-white/90">

              {project?.name || 'Cargando...'}

            </span>

            <ChevronDown className="size-4 text-white/40" />

          </div>

          <div className="flex items-center gap-1 ml-2">

            <button onClick={() => setShowHistory(true)} title="Historial de cambios" className="flex size-8 shrink-0 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white transition-colors">

              <History className="size-4" />

            </button>

            <button onClick={() => setChatHidden(!chatHidden)} title={chatHidden ? "Mostrar panel izquierdo" : "Ocultar panel izquierdo"} className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${chatHidden ? 'text-[#4F88FF] bg-[#4F88FF]/10' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}>

              <PanelLeftClose className={`size-4 transition-transform ${chatHidden ? 'rotate-180' : ''}`} />

            </button>

          </div>

        </div>



        {/* CENTER GROUP */}

        <div className="flex-1 flex justify-center overflow-x-auto [&::-webkit-scrollbar]:hidden">

          <div className="flex bg-[#222] border border-white/5 p-1 rounded-full items-center shadow-inner shrink-0">

            <button onClick={() => { setRightView('preview'); setShowPreview(true); }} className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${rightView === 'preview' && showPreview ? 'bg-[#3b59b8] text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>

              <Globe className="size-4" /> <span>Vista previa</span>

            </button>

            <button onClick={() => { setRightView('code'); setShowPreview(true); }} className={`flex items-center justify-center px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${rightView === 'code' && showPreview ? 'bg-white/10 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>

              <FileCode2 className="size-4" />

            </button>

            <button onClick={() => { setMoreInitialTab('functions'); setRightView('more'); }} className={`flex items-center justify-center px-4 py-1.5 rounded-full text-[13px] font-medium transition-all ${rightView === 'more' ? 'bg-white/10 text-white shadow-md' : 'text-white/60 hover:text-white hover:bg-white/5'}`}>

              <Layers className="size-4" />

            </button>

          </div>

        </div>



        {/* RIGHT GROUP */}

        <div className="flex items-center justify-end gap-3 flex-shrink min-w-[200px]">

          {rightView === 'preview' && showPreview && project && (

            <>

              <button onClick={() => setPreviewViewport(previewViewport === 'desktop' ? 'mobile' : 'desktop')} className="flex size-8 shrink-0 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white transition-colors" title="Cambiar vista">

                {previewViewport === 'desktop' ? <Monitor className="size-4" /> : <Smartphone className="size-4" />}

              </button>

              <div className="flex relative shrink min-w-[200px]">

                <div className="flex items-center h-8 bg-[#222] border border-white/10 rounded-lg overflow-hidden w-full">

                  <button onClick={() => setPreviewReloadKey((k) => k + 1)} className="flex items-center justify-center w-8 h-full border-r border-white/10 text-white/50 hover:text-white hover:bg-white/5 transition-colors">

                    <RotateCw className="size-3.5" />

                  </button>

                  <div onClick={async () => {

                    setPageSearch(previewCurrentPath)

                    setShowPagesDropdown(!showPagesDropdown)

                    if (!showPagesDropdown) {

                      try {

                        const res = await api.listProjectPages(projectId)

                        if (res?.paths) setPreviewPages(res.paths)

                      } catch(e) {}

                    }

                  }} className="flex-1 h-full px-3 text-[12px] text-white/70 flex items-center justify-between cursor-pointer hover:bg-white/5">

                    <span className="truncate">{previewCurrentPath === '/' ? 'Inicio' : previewCurrentPath}</span>

                    <ChevronDown className="size-3 text-white/40 ml-2 shrink-0" />

                  </div>

                </div>

                {showPagesDropdown && (

                  <div className="absolute top-full left-0 right-0 mt-2 bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 min-w-[260px]">

                    <div className="flex items-center px-3 py-2.5 border-b border-white/5 bg-[#252525]">

                      <Search className="size-4 text-white/40 mr-2 shrink-0" />

                      <input 

                        type="text" 

                        autoFocus

                        onFocus={(e) => e.target.select()}

                        value={pageSearch || ""}

                        onChange={(e) => setPageSearch(e.target.value)}

                        className="flex-1 bg-transparent border-none text-[13px] text-white outline-none placeholder:text-white/40" 

                        placeholder="Buscar ruta..." 

                      />

                      {pageSearch && (

                        <X className="size-3.5 text-white/40 hover:text-white cursor-pointer ml-2 shrink-0" onClick={() => setPageSearch('')} />

                      )}

                    </div>

                    <div className="max-h-64 overflow-y-auto py-1">

                      {previewPages.length === 0 ? (

                        <div className="p-4 text-[13px] text-white/40 text-center flex flex-col items-center gap-2">

                           <RotateCw className="size-4 animate-spin text-[#4F88FF]" />

                           Buscando páginas...

                        </div>

                      ) : (

                        (previewPages || []).filter(p => (p || "").toLowerCase().includes((pageSearch || "").toLowerCase())).map(p => (

                          <div 

                            key={p}

                            className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-white/80 hover:bg-[#2a2a2a] cursor-pointer transition-colors"

                            onClick={() => {

                              previewNavigate(p)

                              setShowPagesDropdown(false)

                            }}

                          >

                            {p === previewCurrentPath ? <Check className="size-4 text-white shrink-0" /> : <div className="size-4 shrink-0" />}

                            <span className="truncate flex-1">{p}</span>

                          </div>

                        ))

                      )}

                    </div>

                  </div>

                )}

              </div>

              <a href={withPreviewToken(previewStatus?.url)} target="_blank" rel="noreferrer" className="flex size-8 shrink-0 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white transition-colors" title="Abrir en pestaña nueva">

                <ExternalLink className="size-4" />

              </a>

            </>

          )}

          <button onClick={copyShareLink} className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/10 text-[13px] font-medium text-white/80 hover:bg-white/5 hover:text-white transition-colors ml-2">

            <Share2 className="size-3.5" /> Compartir

          </button>

          

          <button className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-[13px] font-medium text-white shadow-md hover:opacity-90 transition-opacity ml-1">

            <Zap className="size-3.5 fill-white/20" /> Mejorar plan

          </button>



          <button onClick={() => setShowSettings(true)} className="hidden lg:flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/10 text-[13px] font-medium text-white hover:bg-white/20 transition-colors ml-1">

            Publicar

          </button>

        </div>

      </div>



      {/* MOBILE HEADER (Chat Mode) */}

      {mobileView === 'chat' && (

        <div className="md:hidden flex h-14 items-center justify-between border-b border-white/10 bg-[#161616] px-4 w-full">

          <Link to="/dashboard" className="flex items-center justify-center size-9 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white">

            <Menu className="size-4" />

          </Link>

          

          <div className="flex flex-1 mx-3 items-center justify-center">

            <div className="flex items-center gap-2 cursor-pointer bg-white/5 border border-white/10 px-4 py-1.5 rounded-full shadow-sm max-w-[200px]">

              {project?.logoUrl && <img src={project.logoUrl} alt="" className="size-4 shrink-0 rounded object-cover" />}

              <span className="truncate text-[14px] font-medium text-white/90">{project?.name || 'Cargando...'}</span>

              <ChevronDown className="size-3 text-white/40 shrink-0" />

            </div>

          </div>



          <button onClick={() => { setRightView('preview'); setShowPreview(true); setMobileView('preview'); }} className="flex items-center justify-center size-9 rounded-full bg-white/5 border border-white/10 text-white/70 hover:text-white">

            <ChevronRight className="size-5" />

          </button>

        </div>

      )}



      {/* MOBILE PREVIEW BOTTOM BAR */}

      {mobileView === 'preview' && (

        <div className="md:hidden fixed bottom-6 left-0 right-0 flex justify-center z-50 pointer-events-none px-4">

          <div className="flex items-center gap-2 bg-[#222] border border-white/10 p-1.5 rounded-full shadow-2xl pointer-events-auto">

            <button onClick={() => { setMobileView('chat') }} className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors text-[14px] font-medium shrink-0">

              <ChevronLeft className="size-4" /> Chat

            </button>

            

            <div className="relative shrink min-w-0 max-w-[140px]">

              <div onClick={async () => {

                  setPageSearch(previewCurrentPath)

                  setShowPagesDropdown(!showPagesDropdown)

                  if (!showPagesDropdown) {

                    try {

                      const res = await api.listProjectPages(projectId)

                      if (res?.paths) setPreviewPages(res.paths)

                    } catch(e) {}

                  }

                }} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/5 text-white/70 hover:bg-white/10 transition-colors cursor-pointer w-full">

                <Globe className="size-3.5 shrink-0" />

                <span className="truncate text-[13px] flex-1 text-left">{previewCurrentPath === '/' ? 'Inicio' : previewCurrentPath}</span>

              </div>

              

              {showPagesDropdown && (

                  <div className="absolute bottom-full mb-2 left-0 right-0 mt-2 bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 min-w-[260px]">

                    <div className="flex items-center px-3 py-2.5 border-b border-white/5 bg-[#252525]">

                      <Search className="size-4 text-white/40 mr-2 shrink-0" />

                      <input 

                        type="text" 

                        autoFocus

                        onFocus={(e) => e.target.select()}

                        value={pageSearch || ""}

                        onChange={(e) => setPageSearch(e.target.value)}

                        className="flex-1 bg-transparent border-none text-[13px] text-white outline-none placeholder:text-white/40" 

                        placeholder="Buscar ruta..." 

                      />

                      {pageSearch && (

                        <X className="size-3.5 text-white/40 hover:text-white cursor-pointer ml-2 shrink-0" onClick={() => setPageSearch('')} />

                      )}

                    </div>

                    <div className="max-h-64 overflow-y-auto py-1">

                      {previewPages.length === 0 ? (

                        <div className="p-4 text-[13px] text-white/40 text-center flex flex-col items-center gap-2">

                           <RotateCw className="size-4 animate-spin text-[#4F88FF]" />

                           Buscando páginas...

                        </div>

                      ) : (

                        (previewPages || []).filter(p => (p || "").toLowerCase().includes((pageSearch || "").toLowerCase())).map(p => (

                          <div 

                            key={p}

                            className="flex items-center gap-2 px-3 py-2.5 text-[13px] text-white/80 hover:bg-[#2a2a2a] cursor-pointer transition-colors"

                            onClick={() => {

                              previewNavigate(p)

                              setShowPagesDropdown(false)

                            }}

                          >

                            {p === previewCurrentPath ? <Check className="size-4 text-white shrink-0" /> : <div className="size-4 shrink-0" />}

                            <span className="truncate flex-1">{p}</span>

                          </div>

                        ))

                      )}

                    </div>

                  </div>

                )}

            </div>



            <button onClick={() => { setRightView('code') }} className={`flex items-center justify-center size-9 rounded-full transition-colors shrink-0 ${rightView === 'code' ? 'bg-[#3b59b8] text-white' : 'bg-white/5 text-white/70 hover:text-white'}`}>

              <FileCode2 className="size-4" />

            </button>

          </div>

        </div>

      )}



      

      {showSettings && (

        <ProjectSettingsPanel

          project={project}

          onClose={() => setShowSettings(false)}

          onProjectUpdated={(p) => setProject(p)}

        />

      )}

      {showHistory && (

        <HistoryPanel

          projectId={projectId}

          onClose={() => setShowHistory(false)}

          onRestored={() => setHistoryKey(k => k + 1)}

        />

      )}

      <div ref={splitRef} className={`flex min-h-0 flex-1 ${resizing ? 'select-none' : ''}`}>

      <div

        className={`relative min-w-0 flex-1 flex-col ${mobileView === 'preview' || chatHidden ? 'hidden' : 'flex'} ${chatHidden ? 'md:hidden' : 'md:flex'}`}

        onDragEnter={onDragEnter}

        onDragOver={onDragOver}

        onDragLeave={onDragLeave}

        onDrop={onDrop}

      >

        {isDraggingFile && (

          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/90 backdrop-blur-sm">

            <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary/60 px-10 py-8 text-center">

              <Paperclip className="size-6 text-primary" />

              <p className="text-sm font-medium text-text">Soltá los archivos acá</p>

              <p className="text-xs text-muted">Hasta {MAX_ATTACHMENTS} imágenes/PDF, o un único .sql / .zip para importar</p>

            </div>

          </div>

        )}



      {dbMismatch?.match === false && (

        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">

          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />

          <p>

            El repo parece usar el proyecto Supabase <code className="font-mono">{dbMismatch.repoRef}</code> (detectado

            en <code className="font-mono">{dbMismatch.repoRefSource}</code>), pero conectaste{' '}

            <code className="font-mono">{dbMismatch.connectedRef}</code>. Si no es intencional, es probable que los

            cambios que apruebes no se reflejen en la app real.

          </p>

        </div>

      )}



      <main ref={mainRef} onScroll={onMessagesScroll} className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-4 py-6">

        {loading && <p className="text-sm text-muted">Cargando conversación…</p>}



        {!loading && (loadingMore || hasMoreMessages) && (

          <div className="mb-4 flex justify-center">

            {loadingMore ? (

              <span className="flex items-center gap-1.5 text-xs text-muted">

                <Loader2 className="size-3 animate-spin" /> Cargando mensajes anteriores…

              </span>

            ) : (

              <button

                onClick={loadOlderMessages}

                className="text-xs text-muted underline decoration-dotted hover:text-text"

              >

                Ver mensajes anteriores

              </button>

            )}

          </div>

        )}



        <div className="flex-1 space-y-6">

          {visibleMessages.map((msg, msgIndex) =>

            msg.role === 'user' ? (

              <div key={msg.id} className="flex justify-end w-full py-2 group">

                <div className="flex flex-col items-end gap-1 w-full">

                  <div className="max-w-[85%] sm:max-w-[70%] w-fit min-w-[3rem] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-zinc-800 text-zinc-100 text-[14px] leading-relaxed break-words whitespace-pre-wrap select-text shadow-sm prose prose-invert prose-p:my-0 prose-img:rounded-xl prose-img:max-h-64 prose-img:object-cover">

                    <ReactMarkdown>{msg.content || ''}</ReactMarkdown>

                  </div>

                  <span className="text-xs text-text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100 px-2">

                    {msg.created_at ? (() => { const d = new Date(msg.created_at); return isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); })() : ''}

                  </span>

                </div>

              </div>

            ) : (

              <AssistantMessage

                key={msg.id}

                message={msg}

                telemetry={msg.actions?.filter(a => a.type === 'telemetry')}

                modifiedFiles={Array.from(new Set(changes.filter(c => c.message_id === msg.id).map(c => c.path)))}

                currentProjectPreviewUrl={previewStatus?.url}

              >

                  {msg.actions?.find(a => a.type === 'usage') && (

                    <div className="absolute top-0 right-0 opacity-0 transition-opacity duration-200 group-hover/aimsg:opacity-100 z-10">

                      <UsageDropdown usage={msg.actions.find(a => a.type === 'usage').metadata} />

                    </div>

                  )}

                  

                  

                  {msg.type === 'supabase_connect' && (

                    <SupabaseConnectCard 

                      projectId={projectId}

                      zipExtractPath={msg.zipExtractPath}

                        initialProjectRef={msg.initialProjectRef}

                        initialAnonKey={msg.initialAnonKey}

                        initialServiceRoleKey={msg.initialServiceRoleKey} 

                      onComplete={(data) => {

                        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, type: 'supabase_connect_done', content: 'Base de datos migrada y vinculada a Supabase con éxito.' } : m))

                        if (typeof fetchPreviewStatus === 'function') fetchPreviewStatus();

                      }}

                    />

                  )}

                  {msg.question?.kind === 'db_choice_backup' ? (

                    <DbChoiceCard

                      data={msg.question}

                      answered={answeredQuestionIds.has(msg.id)}

                      onDone={(followUpMessage, opts) => onDbBackupChoiceDone(msg.id, followUpMessage, opts)}

                    />

                  ) : msg.question?.kind === 'ask_secret' ? (

                    <SecretRequestCard

                      data={msg.question}

                      projectId={projectId}

                      answered={answeredQuestionIds.has(msg.id)}

                      onDone={(answerText) => answerQuestion(msg.id, answerText)}

                    />

                  ) : (

                    msg.question && (

                      <QuestionCard

                        data={msg.question}

                        answered={answeredQuestionIds.has(msg.id)}

                        onAnswer={(answerText) => answerQuestion(msg.id, answerText)}

                      />

                    )

                  )}

                  {(() => {

                    const msgChanges = changes.filter((c) => c.message_id === msg.id)

                    const msgDbChanges = dbChanges.filter((c) => c.message_id === msg.id)

                    // Solo hay más de uno pendiente en una etapa de un plan largo (ver

                    // "requires_approval" en agent.js) — un pedido normal ya se aplicó solo,

                    // así que acá nunca hay nada que aprobar.

                    const pendingCount =

                      msgChanges.filter((c) => c.status === 'pending').length +

                      msgDbChanges.filter((c) => c.status === 'pending').length

                    return (

                      <>

                        {msgChanges.length > 0 && (

                            <GroupedChangesCard

                              changes={msgChanges}

                              onShowFull={showFullDiff}

                              isShowingFullId={inspectOverlay?.kind === 'code' ? inspectOverlay.change.id : null}

                            />

                          )}

                        {msgDbChanges.map((c) => (

                          <DbChangeCard

                            key={c.id}

                            change={c}

                            onApprove={approveDb}

                            onReject={rejectDb}

                            onShowFull={showFullSql}

                            isShowingFull={inspectOverlay?.kind === 'db' && inspectOverlay.change.id === c.id}

                            hideActions={pendingCount > 0}

                          />

                        ))}

                        {pendingCount > 0 && (

                          <TurnApprovalBar

                            messageId={msg.id}

                            count={pendingCount}

                            onApprove={approveAllForMessage}

                            onReject={rejectAllForMessage}

                          />

                        )}

                      </>

                    )

                  })()}

                  {assetChanges

                    .filter((c) => c.message_id === msg.id)

                    .map((c) => (

                      <AssetChangeCard key={c.id} change={c} onApprove={approveAsset} onReject={rejectAsset} />

                    ))}

                  {edgeFunctionChanges

                    .filter((c) => c.message_id === msg.id)

                    .map((c) => (

                      <EdgeFunctionChangeCard

                        key={c.id}

                        change={c}

                        onApprove={approveEdgeFunction}

                        onReject={rejectEdgeFunction}

                        onShowFull={showFullFunctionCode}

                        isShowingFull={inspectOverlay?.kind === 'function' && inspectOverlay.change.id === c.id}

                      />

                    ))}

                  

                </AssistantMessage>

            ),

          )}



          {(sending || autoTurnActive) && (() => {

            const STAGE_LABELS = {
              THINKING: "Generando código y estructurando la web...",
              ANALYZING: "Analizando tu web...",
              PLANNING: "Planeando cambios...",
              WRITING_VFS: "Editando código...",
              VALIDATING_BUILD: "Validando vista previa...",
              AUDITING_RUNTIME: "Comprobando errores...",
              HEALING: "Refinando detalles...",
            };
            const latestStep = activity[activity.length - 1];
            let activeStage = "Generando código y estructurando la web...";
            if (latestStep) {
              if (latestStep.type === 'read') activeStage = `Leyendo ${latestStep.path || 'archivo'}...`;
              else if (latestStep.type === 'list') activeStage = "Explorando archivos...";
              else if (latestStep.type === 'edit') activeStage = `Modificando ${latestStep.path || 'código'}...`;
              else if (latestStep.type === 'db') activeStage = "Evaluando base de datos...";
              else if (latestStep.type === 'db_read') activeStage = `Consultando tabla ${latestStep.table || ''}...`;
              else if (latestStep.type === 'function') activeStage = "Configurando Edge Function...";
              else if (latestStep.type === 'image') activeStage = "Generando imagen...";
              else if (latestStep.type === 'asset') activeStage = "Procesando asset...";
              else if (latestStep.type === 'preview') activeStage = "Verificando preview...";
              else if (latestStep.type === 'restart') activeStage = "Reiniciando servidor...";
              else activeStage = latestStep.label || latestStep.message || STAGE_LABELS[latestStep.phase] || "Generando código y estructurando la web...";
            }

            return (

              <div className="w-full pl-0 sm:pl-2 py-2">

                <ThinkingState statusText={activeStage} />

              </div>

            );

          })()}

          <div ref={bottomRef} />

        </div>



        {error && (

          <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">

            {error}{' '}

            {error.toLowerCase().includes('elige un plan') && (

              <Link to="/account" className="underline">

                Ver planes

              </Link>

            )}

          </p>

        )}

      </main>



      <div className="relative w-full">

        {showScrollDown && (

          <div className="absolute -top-10 left-1/2 z-20 -translate-x-1/2">

            <button

              onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}

              className="press flex size-8 items-center justify-center rounded-full border border-white/10 bg-surface shadow-xl text-muted transition-colors hover:bg-white/5 hover:text-text"

            >

              <ArrowDown className="size-4" />

            </button>

          </div>

        )}

        

        

        {/* FILA DE SUGERENCIAS FLOTANTES */}

        {(() => {

          const lastMsg = visibleMessages[visibleMessages.length - 1];

          const activeSuggestions = (!sending && !autoTurnActive && lastMsg?.role === 'assistant' && lastMsg?.suggestions?.length > 0) ? lastMsg.suggestions : [];

          if (activeSuggestions.length === 0) return null;

          return (

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-3 w-full px-4">

              {activeSuggestions.map((text, i) => (

                <button

                  key={i}

                  type="button"

                  onClick={() => send(null, text)}

                  className="whitespace-nowrap px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs text-zinc-300 hover:text-white transition-all duration-150 shrink-0"

                >

                  {text}

                </button>

              ))}

            </div>

          );

        })()}



        

          {isImportingDb && (

            <div className="flex items-center gap-2.5 rounded-full border border-blue-500/20 bg-blue-950/40 px-4 py-2 text-xs text-blue-300 shadow-lg backdrop-blur-md animate-pulse mb-3">

              <div className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />

              <span>{importStatusStep}</span>

            </div>

          )}



          <ChatInput projectId={project?.id || projectId} defaultAgentId={project?.default_agent_id} onSendMessage={(text, files, agentId) => {
            return send(null, text, files.map(f => f.file), null, agentId);
          }}

          onStopGeneration={stop}

          isGenerating={sending || autoTurnActive}

          mode={mode}

          setMode={setMode}

        />



      </div>



      </div>



      {(showPreview || mobileView === 'preview') && (

        <>

          <div

            onPointerDown={(e) => {

              // Si el navegador no reconoce este puntero como "activo" para capturar (nunca

              // debería pasar con un mousedown/touchstart real, pero mejor no confiar en que

              // JAMÁS tire), que no se pierda el arrastre entero por eso — la capa transparente

              // de abajo (ver el "resizing &&" en el panel derecho) sigue funcionando igual sin

              // la captura de puntero.

              try {

                e.currentTarget.setPointerCapture(e.pointerId)

              } catch {}

              setResizing(true)

            }}

            className={`hidden w-2.5 shrink-0 cursor-col-resize touch-none items-center justify-center bg-border/50 hover:bg-primary/50 ${chatHidden ? "md:!hidden" : "md:flex"}`}

          >

            <div className="h-8 w-0.5 rounded-full bg-white/20" />

          </div>

                    <div

            className={`relative w-full shrink-0 md:block md:w-[var(--preview-w)] ${

              mobileView === 'preview' ? 'block' : 'hidden'

            } p-0`}

            style={{ '--preview-w': chatHidden ? '100%' : `${previewWidthPct}%` }}

          >

            <div className="relative h-full w-full overflow-hidden rounded-none md:rounded-xl border-0 md:border md:border-white/10 bg-bg shadow-2xl">

            {/* Mientras se arrastra el separador, tapa el iframe de la vista previa (que tiene

                su propio documento y si no absorbe el mouse por su cuenta, cortando el arrastre)

                — la captura de puntero del separador ya alcanzaría sola en la mayoría de los

                casos, esto es solo un respaldo por si algún navegador no la respeta del todo. */}

            {resizing && <div className="absolute inset-0 z-40 cursor-col-resize" />}

            {project && rightView === 'code' && <CodeViewPanel key={projectId} projectId={projectId} />}

            

            {project && rightView === 'more' && (

              <MorePanel

                key={`more-${projectId}`}

                projectId={projectId}

                repoFullName={project?.repoFullName}

                onMatchResult={setDbMismatch}

                initialTab={moreInitialTab}

                onClose={() => setRightView('preview')}

              />

            )}

            {project && rightView === 'preview' && (

              <PreviewPanel

                status={previewStatus}

                error={previewError}

                repoFullName={project.repoFullName}

                viewport={previewViewport}

                iframeSrc={previewIframeSrc}

                reloadKey={previewReloadKey}

                iframeRef={previewIframeRef}

                selectedElement={selectedElement}

                onClearSelection={() => setSelectedElement(null)}

                onTryFix={() =>

                  send(null, 'La vista previa no arranca por un error de compilación. Revisá el error con "check_preview_errors" y arreglalo.')

                }

                fixing={sending}

              />

            )}



            {inspectOverlay && (

              <div className="absolute inset-0 z-10 flex flex-col bg-surface">

                <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">

                  {inspectOverlay.kind === 'code' ? (

                    <>

                      <FileCode className="size-3.5 shrink-0 text-primary" />

                      <span className="truncate font-mono text-xs text-muted">{inspectOverlay.change.file_path}</span>

                    </>

                  ) : inspectOverlay.kind === 'function' ? (

                    <>

                      <Server className="size-3.5 shrink-0 text-primary" />

                      <span className="truncate font-mono text-xs text-muted">{inspectOverlay.change.slug}</span>

                    </>

                  ) : (

                    <>

                      <Database className="size-3.5 shrink-0 text-primary" />

                      <span className="truncate text-xs text-muted">Cambio en base de datos</span>

                    </>

                  )}

                  <button

                    onClick={() => setInspectOverlay(null)}

                    title="Cerrar y volver a la vista previa"

                    className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-text"

                  >

                    <X className="size-3.5" />

                  </button>

                </div>

                <div className="flex-1 overflow-auto p-3">

                  {inspectOverlay.kind === 'code' ? (

                    <DiffViewer original={inspectOverlay.change.original_content} updated={inspectOverlay.change.new_content} />

                  ) : inspectOverlay.kind === 'function' ? (

                    <>

                      <pre className="overflow-auto rounded-md border border-border bg-black/20 p-3 font-mono text-xs text-primary/90 whitespace-pre-wrap">

                        {inspectOverlay.change.code}

                      </pre>

                      {inspectOverlay.change.result && (

                        <p className="mt-2 rounded-md bg-white/5 p-2 font-mono text-[11px] text-muted">

                          {inspectOverlay.change.result}

                        </p>

                      )}

                    </>

                  ) : (

                    <>

                      <pre className="overflow-auto rounded-md border border-border bg-black/20 p-3 font-mono text-xs text-primary/90 whitespace-pre-wrap">

                        {inspectOverlay.change.sql}

                      </pre>

                      {inspectOverlay.change.result && (

                        <p className="mt-2 rounded-md bg-white/5 p-2 font-mono text-[11px] text-muted">

                          {inspectOverlay.change.result}

                        </p>

                      )}

                    </>

                  )}

                </div>

              </div>

            )}

            </div>

          </div>

        </>

      )}

      </div>

    </div>

  )

}

