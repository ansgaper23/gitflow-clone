import { useEffect, useState } from 'react'
import { X, FileCode, Database, Upload, RotateCcw, Loader2, Sparkles } from 'lucide-react'
import { api } from '../lib/api.js'

const TYPE_ICON = { code: FileCode, db: Database, asset: Upload }
const TYPE_LABEL = { code: 'Código', db: 'Base de datos', asset: 'Archivo' }

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return `hace ${days} d`
}

export default function HistoryPanel({ projectId, onClose, onRestored }) {
  const [checkpoints, setCheckpoints] = useState(null)
  const [error, setError] = useState(null)
  const [restoringId, setRestoringId] = useState(null)
  const [confirmingId, setConfirmingId] = useState(null)

  useEffect(() => {
    let cancelled = false
    api
      .listCheckpoints(projectId)
      .then((data) => {
        if (!cancelled) setCheckpoints(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const restore = async (id) => {
    setRestoringId(id)
    setError(null)
    try {
      await api.restoreCheckpoint(projectId, id)
      setConfirmingId(null)
      onRestored?.()
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end p-0">
      <div className="animate-overlay-in absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-panel-in relative z-10 flex h-full w-full max-w-sm flex-col bg-bg shadow-2xl overflow-hidden md:rounded-2xl border-0 md:border md:border-white/10">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Historial de cambios</h2>
          <button
            onClick={onClose}
            className="press flex size-7 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {!checkpoints && !error && <p className="text-sm text-muted">Cargando…</p>}
          {error && <p className="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {checkpoints?.length === 0 && <p className="text-sm text-muted">Todavía no hay cambios en el historial.</p>}

          <div className="space-y-2">
            {checkpoints?.map((c) => {
              const Icon = TYPE_ICON[c.changeType] || Sparkles
              const isConfirming = confirmingId === c.id
              return (
                <div key={c.id} className="rounded-lg border border-border bg-background/40 p-3">
                  <div className="flex items-start gap-2">
                    <Icon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-snug text-text/90">{c.summary}</p>
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                        {TYPE_LABEL[c.changeType] || c.changeType} · {relativeTime(c.createdAt)}
                      </p>
                    </div>
                  </div>

                  {isConfirming ? (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[11px] text-amber-300">
                        Esto va a reemplazar el código actual del proyecto por como estaba en este punto. Se guarda como un
                        cambio nuevo, no se pierde el historial.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => restore(c.id)}
                          disabled={restoringId === c.id}
                          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-bold text-slate-950 disabled:opacity-60"
                        >
                          {restoringId === c.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                          Confirmar
                        </button>
                        <button
                          onClick={() => setConfirmingId(null)}
                          disabled={restoringId === c.id}
                          className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted hover:bg-white/5"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmingId(c.id)}
                      className="mt-2 flex items-center gap-1 text-[11px] text-muted hover:text-primary"
                    >
                      <RotateCcw className="size-3" /> Restaurar a este punto
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
