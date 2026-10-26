import { useState, useEffect } from 'react'
import { Bot, Sparkles, Monitor, Tablet, Smartphone, MousePointerClick, X, Loader2, Wrench, AlertTriangle, RotateCw, Type, Palette, Check, Wand2 } from 'lucide-react'
import { mutateTailwindClasses } from '../lib/tailwindMutator.js'

const ACTIVE_STATUSES = new Set(['installing', 'starting', 'running'])

// null = ocupa todo el panel (comportamiento actual). Con ancho/alto fijos, el iframe se
// centra dentro del panel simulando el tamaño real del dispositivo (como las devtools).
export const VIEWPORTS = {
  desktop: { label: 'Escritorio', icon: Monitor, size: null },
  tablet: { label: 'Tablet', icon: Tablet, size: { width: 768, height: 1024 } },
  mobile: { label: 'Móvil', icon: Smartphone, size: { width: 390, height: 844 } },
}

const PHASE_LABEL = {
  installing: 'Instalando dependencias',
  starting: 'Iniciando el servidor de desarrollo',
}

function BuildingPreview({ phase, subtitle }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="relative flex size-20 items-center justify-center">
        <span className="animate-preview-ring absolute inset-0 rounded-full border border-primary/40" />
        <span className="animate-preview-ring absolute inset-0 rounded-full border border-primary/40" style={{ animationDelay: '0.6s' }} />
        <span className="relative flex size-16 items-center justify-center rounded-2xl brand-gradient text-slate-950 shadow-lg">
          <Bot className="animate-preview-float size-8" />
          <Sparkles className="absolute -right-1.5 -top-1.5 size-4 text-white drop-shadow" />
        </span>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">{phase}…</p>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>

      <div className="h-1 w-44 overflow-hidden rounded-full bg-white/10">
        <div className="animate-preview-sweep h-full w-1/3 rounded-full brand-gradient" />
      </div>
    </div>
  )
}

// Puramente presentacional: todo el control (estado del preview, viewport, ruta, modo
// selección) vive ahora en Chat.jsx, que también dibuja la barra de herramientas unificada en
// el header de arriba — este componente solo dibuja el iframe y los estados de carga/error.
export default function PreviewPanel({
  status,
  error,
  repoFullName,
  viewport,
  iframeSrc,
  reloadKey,
  iframeRef,
  selectedElement,
  onClearSelection,
  onTryFix,
  fixing,
  onRestartContainer,
  restarting,
  onIframeLoad,
  selectMode,
  onToggleSelectMode,
  onViewportChange,
  onReload,
  onQuickEdit,
  autoFixing = false,
  runtimeCrash = null,
  onManualFix,
}) {
  const [autoFixTimedOut, setAutoFixTimedOut] = useState(false)
  const [activePopover, setActivePopover] = useState(null) // 'text' | 'styles' | null
  const [editText, setEditText] = useState('')
  const [editClasses, setEditClasses] = useState('')
  const [isApplyingQuickEdit, setIsApplyingQuickEdit] = useState(false)

  useEffect(() => {
    if (selectedElement) {
      setEditText(selectedElement.innerText || '')
      setEditClasses(selectedElement.className || '')
    } else {
      setActivePopover(null)
    }
  }, [selectedElement])

  // Fail-safe UI: Temporizador estricto de 45 segundos para que la UI nunca quede congelada
  // en "Auto-corrigiendo error interno..." si el backend demora o no logra auto-resolver.
  useEffect(() => {
    if (status?.status === 'error') {
      const timer = setTimeout(() => {
        setAutoFixTimedOut(true)
      }, 45000)
      return () => clearTimeout(timer)
    } else {
      setAutoFixTimedOut(false)
    }
  }, [status?.status, status?.error])

  // Atajos de teclado: Alt + S para alternar selector, Escape para cancelar/limpiar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        onToggleSelectMode?.()
      } else if (e.key === 'Escape') {
        if (selectMode) {
          e.preventDefault()
          onToggleSelectMode?.()
        } else if (selectedElement) {
          e.preventDefault()
          onClearSelection?.()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectMode, selectedElement, onToggleSelectMode, onClearSelection])

  if (status?.status === 'unavailable') return null

  const isThisRepo = status?.repoFullName === repoFullName
  const isRunningHere = status?.status === 'running' && isThisRepo

  return (
    <div className="relative h-full overflow-hidden bg-[#0a0e18]">
      {error && <p className="p-3 text-xs text-red-300">{error}</p>}

      {/* POPOVER EDICIÓN RÁPIDA DE TEXTO (ZERO-LLM) */}
      {isRunningHere && activePopover === 'text' && selectedElement && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 w-80 sm:w-96 rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-white/15 p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Type className="size-3.5 text-blue-400" />
              <span>Edición Rápida de Texto</span>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full font-mono border border-blue-500/30">Zero-LLM</span>
            </div>
            <button type="button" onClick={() => setActivePopover(null)} className="text-white/50 hover:text-white">
              <X className="size-4" />
            </button>
          </div>

          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full rounded-lg bg-zinc-950/80 border border-white/10 p-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
            placeholder="Escribe el nuevo texto..."
            autoFocus
          />

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
            <span className="text-[10px] text-zinc-400">Si es dinámico, se deriva a la IA</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActivePopover(null)}
                className="px-2.5 py-1 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isApplyingQuickEdit || editText === selectedElement.innerText}
                onClick={async () => {
                  if (!onQuickEdit) return;
                  setIsApplyingQuickEdit(true);
                  try {
                    await onQuickEdit({
                      action: 'edit_text',
                      newText: editText,
                      elementContext: selectedElement
                    });
                    setActivePopover(null);
                  } finally {
                    setIsApplyingQuickEdit(false);
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-all shadow-md"
              >
                {isApplyingQuickEdit ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                <span>Aplicar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POPOVER AJUSTE VISUAL DE ESTILOS Y PALETA TAILWIND (ZERO-LLM) */}
      {isRunningHere && activePopover === 'styles' && selectedElement && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-40 w-88 sm:w-[26rem] max-h-[80vh] overflow-y-auto rounded-2xl bg-zinc-900/95 backdrop-blur-xl border border-white/15 p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Palette className="size-3.5 text-purple-400" />
              <span>Ajuste Visual de Estilos</span>
              <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full font-mono border border-purple-500/30">Zero-LLM</span>
            </div>
            <button type="button" onClick={() => setActivePopover(null)} className="text-white/50 hover:text-white">
              <X className="size-4" />
            </button>
          </div>

          {/* Selector de Color de Fondo */}
          <div className="space-y-1.5 mb-3">
            <label className="text-[11px] font-medium text-zinc-300">Color de Fondo (bg-*)</label>
            <div className="flex flex-wrap gap-1.5 items-center">
              {[
                { label: 'Transparente', cls: 'bg-transparent', bg: 'transparent', border: 'border-white/20' },
                { label: 'Oscuro', cls: 'bg-zinc-900', bg: '#18181b' },
                { label: 'Slate', cls: 'bg-slate-800', bg: '#1e293b' },
                { label: 'Azul', cls: 'bg-blue-600', bg: '#2563eb' },
                { label: 'Esmeralda', cls: 'bg-emerald-600', bg: '#059669' },
                { label: 'Violeta', cls: 'bg-violet-600', bg: '#7c3aed' },
                { label: 'Rosa', cls: 'bg-rose-600', bg: '#e11d48' },
                { label: 'Ámbar', cls: 'bg-amber-500', bg: '#f59e0b' },
                { label: 'Blanco', cls: 'bg-white', bg: '#ffffff' },
              ].map((c) => (
                <button
                  key={c.cls}
                  type="button"
                  onClick={() => setEditClasses((prev) => mutateTailwindClasses(prev, { bg: c.cls }))}
                  className={`size-6 rounded-full border ${c.border || 'border-white/10'} hover:scale-110 transition-transform shrink-0 shadow-sm`}
                  style={{ backgroundColor: c.bg }}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          {/* Selector de Color de Texto */}
          <div className="space-y-1.5 mb-3">
            <label className="text-[11px] font-medium text-zinc-300">Color de Texto (text-*)</label>
            <div className="flex flex-wrap gap-1.5 items-center">
              {[
                { label: 'Blanco', cls: 'text-white', color: '#ffffff' },
                { label: 'Gris claro', cls: 'text-zinc-300', color: '#d4d4d8' },
                { label: 'Gris oscuro', cls: 'text-zinc-500', color: '#71717a' },
                { label: 'Azul', cls: 'text-blue-400', color: '#60a5fa' },
                { label: 'Esmeralda', cls: 'text-emerald-400', color: '#34d399' },
                { label: 'Violeta', cls: 'text-violet-400', color: '#a78bfa' },
                { label: 'Rosa', cls: 'text-rose-400', color: '#fb7185' },
                { label: 'Ámbar', cls: 'text-amber-400', color: '#fbbf24' },
              ].map((t) => (
                <button
                  key={t.cls}
                  type="button"
                  onClick={() => setEditClasses((prev) => mutateTailwindClasses(prev, { text: t.cls }))}
                  className="size-6 rounded-full border border-white/10 hover:scale-110 transition-transform shrink-0 flex items-center justify-center font-bold text-[10px] shadow-sm bg-zinc-800"
                  style={{ color: t.color }}
                  title={t.label}
                >
                  A
                </button>
              ))}
            </div>
          </div>

          {/* Bordes redondeados y Padding */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-300">Bordes (rounded-*)</label>
              <div className="flex flex-wrap gap-1">
                {['rounded-none', 'rounded-md', 'rounded-xl', 'rounded-full'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setEditClasses((prev) => mutateTailwindClasses(prev, { rounded: r }))}
                    className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-zinc-300 border border-white/5 transition-colors"
                  >
                    {r.replace('rounded-', '')}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-300">Espaciado (p-*)</label>
              <div className="flex flex-wrap gap-1">
                {['p-2', 'p-4', 'p-6', 'px-4 py-2'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      const parts = p.split(' ');
                      const update = {};
                      for (const part of parts) {
                        if (part.startsWith('px-')) update.px = part;
                        else if (part.startsWith('py-')) update.py = part;
                        else if (part.startsWith('p-')) update.p = part;
                      }
                      setEditClasses((prev) => mutateTailwindClasses(prev, update));
                    }}
                    className="px-2 py-0.5 text-[10px] rounded bg-white/5 hover:bg-white/15 text-zinc-300 border border-white/5 transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Input de clases resultante editable */}
          <div className="space-y-1 mb-3">
            <label className="text-[10px] font-mono text-zinc-400">className resultante:</label>
            <input
              type="text"
              value={editClasses}
              onChange={(e) => setEditClasses(e.target.value)}
              className="w-full rounded-lg bg-zinc-950/80 border border-white/10 px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <span className="text-[10px] text-zinc-400">Mutación limpia anti-colisión</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActivePopover(null)}
                className="px-2.5 py-1 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isApplyingQuickEdit || editClasses === selectedElement.className}
                onClick={async () => {
                  if (!onQuickEdit) return;
                  setIsApplyingQuickEdit(true);
                  try {
                    await onQuickEdit({
                      action: 'edit_styles',
                      newClasses: editClasses,
                      elementContext: selectedElement
                    });
                    setActivePopover(null);
                  } finally {
                    setIsApplyingQuickEdit(false);
                  }
                }}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-500 disabled:opacity-50 transition-all shadow-md"
              >
                {isApplyingQuickEdit ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                <span>Aplicar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BARRA FLOTANTE INFERIOR ESTILO LOVABLE */}
      {isRunningHere && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 backdrop-blur-md border border-white/10 shadow-2xl max-w-[95%] transition-all">
          {selectedElement ? (
            /* Tarjeta de elemento seleccionado con acciones Zero-LLM */
            <div className="flex items-center gap-2 text-xs">
              <MousePointerClick className="size-4 shrink-0 text-blue-400 animate-pulse" />
              <div className="flex items-center gap-1.5 font-semibold text-white">
                <span className="rounded bg-blue-500/20 px-2 py-0.5 text-blue-300 border border-blue-500/30 font-mono text-[11px]">
                  {selectedElement.componentName ? `<${selectedElement.componentName} />` : `<${selectedElement.tagName || 'elemento'}>`}
                </span>
                {selectedElement.innerText && (
                  <span className="max-w-[130px] truncate font-normal text-white/80 text-[11px]">
                    "{selectedElement.innerText}"
                  </span>
                )}
              </div>

              <div className="h-4 w-px bg-white/15 mx-0.5" />

              {/* Botón T (Editar texto instantáneo) */}
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === 'text' ? null : 'text')}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                  activePopover === 'text'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-white/10 text-white/90 hover:bg-white/20 hover:text-white'
                }`}
                title="Editar texto del elemento (Zero-LLM)"
              >
                <Type className="size-3.5" />
                <span>Texto</span>
              </button>

              {/* Botón Paleta (Editar estilos / Tailwind instantáneo) */}
              <button
                type="button"
                onClick={() => setActivePopover(activePopover === 'styles' ? null : 'styles')}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                  activePopover === 'styles'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-white/10 text-white/90 hover:bg-white/20 hover:text-white'
                }`}
                title="Ajustar estilos y clases Tailwind (Zero-LLM)"
              >
                <Palette className="size-3.5" />
                <span>Estilos</span>
              </button>

              <div className="h-4 w-px bg-white/15 mx-0.5" />

              <button
                type="button"
                onClick={onClearSelection}
                className="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/20 hover:text-white transition-all shrink-0"
                title="Limpiar selección (Esc)"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <>
              {/* Botón 1: Inspector Visual / Seleccionar elemento */}
              <button
                type="button"
                onClick={onToggleSelectMode}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  selectMode
                    ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(59,130,246,0.6)] ring-1 ring-blue-400 font-semibold'
                    : 'text-zinc-200 hover:bg-white/10 hover:text-white'
                }`}
                title="Seleccionar elemento de la vista previa (Alt+S)"
              >
                <MousePointerClick className={`size-3.5 ${selectMode ? 'text-white animate-bounce' : 'text-blue-400'}`} />
                <span>{selectMode ? 'Seleccionando...' : 'Seleccionar'}</span>
              </button>

              <div className="h-4 w-px bg-white/15 mx-0.5" />

              {/* Botón 2: Edición Rápida de Texto (T) */}
              <button
                type="button"
                onClick={() => {
                  if (!selectMode) onToggleSelectMode?.()
                }}
                className={`flex size-7 items-center justify-center rounded-full transition-all ${
                  selectMode ? 'text-blue-400 bg-white/10' : 'text-zinc-400 hover:bg-white/10 hover:text-white'
                }`}
                title="Edición rápida de texto / títulos (T)"
              >
                <Type className="size-3.5" />
              </button>

              {/* Botón 3: Estilos / Colores (Paleta) */}
              <button
                type="button"
                onClick={() => {
                  if (!selectMode) onToggleSelectMode?.()
                }}
                className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-all"
                title="Ajuste visual de estilos y colores"
              >
                <Palette className="size-3.5" />
              </button>

              <div className="h-4 w-px bg-white/15 mx-0.5" />

              {/* Viewport toggle (Mobile / Desktop) */}
              <button
                type="button"
                onClick={() => onViewportChange?.(viewport === 'desktop' ? 'mobile' : 'desktop')}
                className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-all"
                title={viewport === 'desktop' ? 'Vista móvil' : 'Vista escritorio'}
              >
                {viewport === 'desktop' ? <Smartphone className="size-3.5" /> : <Monitor className="size-3.5" />}
              </button>

              {/* Recargar */}
              <button
                type="button"
                onClick={onReload}
                className="flex size-7 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white transition-all"
                title="Recargar vista previa"
              >
                <RotateCw className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}

      {!error && isRunningHere && (
        VIEWPORTS[viewport].size ? (
          <div className="size-full overflow-auto p-4">
            {/* min-h-full + items-center: centra el dispositivo cuando entra completo en el
                panel, pero si es más alto que el panel (típico en tablet/móvil), el contenedor
                crece con el hijo y el scroll arranca mostrando la parte de arriba (el header)
                en vez de quedar centrado a la mitad y cortar lo de arriba. */}
            <div className="flex min-h-full items-center justify-center">
              <iframe
                ref={iframeRef}
                key={reloadKey}
                src={iframeSrc}
                title="Vista previa"
                onLoad={onIframeLoad}
                className="shrink-0 rounded-xl border border-border/70 bg-white shadow-2xl"
                style={{ width: VIEWPORTS[viewport].size.width, height: VIEWPORTS[viewport].size.height }}
              />
            </div>
          </div>
        ) : (
          <iframe ref={iframeRef} key={reloadKey} src={iframeSrc} title="Vista previa" onLoad={onIframeLoad} className="size-full border-0 bg-white" />
        )
      )}

      {/* OVERLAY SILENCIOSO DE AUTO-CURACIÓN */}
      {!error && isRunningHere && autoFixing && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px] transition-all animate-in fade-in duration-200 pointer-events-auto">
          <div className="flex items-center gap-3 rounded-full bg-zinc-900/90 border border-blue-500/30 px-5 py-2.5 shadow-2xl">
            <Loader2 className="size-4 animate-spin text-blue-400" />
            <span className="text-xs font-medium text-white tracking-wide">Auto-reparando error...</span>
          </div>
        </div>
      )}

      {/* OVERLAY DE ERROR CRÍTICO TRAS 2 INTENTOS FALLIDOS (MODAL / OVERLAY ROJO) */}
      {!error && isRunningHere && runtimeCrash && !autoFixing && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 backdrop-blur-md p-6 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto">
          <div className="max-w-md w-full rounded-2xl bg-zinc-950 border border-red-500/30 p-6 shadow-2xl flex flex-col items-center text-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400">
              <AlertTriangle className="size-7" />
            </div>
            <div className="space-y-1 w-full">
              <h3 className="text-sm font-semibold text-white">Error en tiempo de ejecución de React / Vite</h3>
              <p className="text-xs text-red-300 font-mono bg-red-950/40 border border-red-500/20 rounded-lg p-3 break-all max-h-36 overflow-y-auto text-left whitespace-pre-wrap">
                {runtimeCrash.message || 'Error no controlado en la aplicación'}
                {runtimeCrash.filename && (
                  <span className="block mt-1 text-[11px] text-zinc-400">
                    Archivo: {runtimeCrash.filename}:{runtimeCrash.lineno || 0}
                  </span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={onManualFix || onTryFix}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg hover:from-blue-500 hover:to-indigo-500 transition-all active:scale-[0.98]"
            >
              <Wrench className="size-4" />
              <span>🔧 Intentar reparar con IA</span>
            </button>
          </div>
        </div>
      )}

      {!error && status && ACTIVE_STATUSES.has(status.status) && status.status !== 'running' && (
        <BuildingPreview
          phase={PHASE_LABEL[status.status] || 'Preparando tu vista previa'}
          subtitle={
            status.repoFullName && status.repoFullName !== repoFullName
              ? `Cambiando de ${status.repoFullName} a este proyecto…`
              : 'Esto puede tardar unos segundos'
          }
        />
      )}

      {!error && status?.status === 'running' && !isThisRepo && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted">Hay un preview corriendo para {status.repoFullName}</p>
        </div>
      )}

      {!error && status && !ACTIVE_STATUSES.has(status.status) && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
          {status.status === 'error' && status.error ? (
            (() => {
              const errStr = String(status.error).toLowerCase()
              const isTimeoutOrInfra =
                errStr.includes('tiempo de espera') ||
                errStr.includes('timeout') ||
                errStr.includes('502') ||
                errStr.includes('504') ||
                errStr.includes('econrefused') ||
                errStr.includes('orquestador')

              if (isTimeoutOrInfra || autoFixTimedOut) {
                return (
                  <div className="flex flex-col items-center justify-center gap-4 max-w-md w-full">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                      <AlertTriangle className="size-7" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-text">
                        {isTimeoutOrInfra
                          ? 'El servidor de desarrollo no respondió a tiempo'
                          : 'No se pudo auto-corregir el error a tiempo'}
                      </p>
                      <p className="text-xs text-muted">
                        {isTimeoutOrInfra
                          ? 'El proceso en el servidor se detuvo o tardó más de lo esperado en iniciar.'
                          : 'El error de compilación o dependencias persiste tras el intento de auto-corrección.'}
                      </p>
                    </div>
                    <div className="text-xs font-mono bg-black/50 border border-amber-500/30 rounded-lg p-3 text-amber-300 max-h-32 overflow-auto text-left w-full select-text">
                      {status.error}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAutoFixTimedOut(false)
                          onRestartContainer?.()
                        }}
                        disabled={restarting}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                      >
                        <RotateCw className={`size-3.5 ${restarting ? 'animate-spin' : ''}`} />
                        {restarting ? 'Reiniciando servidor…' : 'Instalar dependencias y reiniciar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAutoFixTimedOut(false)
                          onTryFix?.()
                        }}
                        disabled={fixing}
                        className="px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/15 disabled:opacity-50 cursor-pointer"
                      >
                        {fixing ? 'Corrigiendo…' : 'Pedir ayuda a la IA'}
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div className="flex flex-col items-center justify-center gap-4 max-w-md w-full">
                  <BuildingPreview
                    phase="Auto-corrigiendo error interno"
                    subtitle="El agente está solucionando dependencias o errores de sintaxis (límite 45s)…"
                  />
                  <div className="text-xs font-mono bg-black/50 border border-red-500/30 rounded-lg p-3 text-red-300 max-h-32 overflow-auto text-left w-full select-text">
                    {status.error}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onTryFix?.()}
                      disabled={fixing}
                      className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                    >
                      {fixing ? 'El agente está corrigiendo…' : 'Reintentar con el agente'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAutoFixTimedOut(false)
                        onRestartContainer?.()
                      }}
                      disabled={restarting}
                      className="px-3 py-2 rounded-lg bg-white/10 text-white text-xs font-medium hover:bg-white/15 disabled:opacity-50 cursor-pointer"
                    >
                      {restarting ? 'Reiniciando…' : 'Reiniciar ahora'}
                    </button>
                  </div>
                </div>
              )
            })()
          ) : (
            <p>Sin vista previa activa.</p>
          )}
        </div>
      )}
    </div>
  )
}
