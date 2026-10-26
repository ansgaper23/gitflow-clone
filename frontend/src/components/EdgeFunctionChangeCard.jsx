import { useState } from 'react'
import { Server, Check, X, Maximize2 } from 'lucide-react'

const STATUS_LABEL = {
  pending: null,
  applied: { text: 'Desplegada', className: 'bg-primary/15 text-primary' },
  rejected: { text: 'Rechazada', className: 'bg-red-500/15 text-red-300' },
}

export default function EdgeFunctionChangeCard({ change, onApprove, onReject, onShowFull, isShowingFull }) {
  const [busy, setBusy] = useState(false)
  const status = STATUS_LABEL[change.status]

  const act = async (fn) => {
    setBusy(true)
    try {
      await fn(change.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface/60">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <Server className="size-4 shrink-0 text-primary" />
          <span className="truncate text-xs font-medium">Función de servidor · {change.slug}</span>
        </span>
        {status && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
            {status.text}
          </span>
        )}
      </div>

      <p className="px-3 pb-2 text-xs text-muted">{change.summary}</p>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <button
          onClick={() => onShowFull?.(change)}
          className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
            isShowingFull ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-text/80 hover:bg-white/5'
          }`}
        >
          <Maximize2 className="size-3.5" /> Ver código completo
        </button>

        {change.status === 'pending' && (
          <>
            <button
              onClick={() => act(onApprove)}
              disabled={busy}
              className="ml-auto flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-60"
            >
              <Check className="size-3.5" /> Aprobar y desplegar
            </button>
            <button
              onClick={() => act(onReject)}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/80 hover:bg-white/5 disabled:opacity-60"
            >
              <X className="size-3.5" /> Rechazar
            </button>
          </>
        )}
      </div>
    </div>
  )
}
