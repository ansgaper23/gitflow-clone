import { useState } from 'react'
import { Check, X, Loader2 } from 'lucide-react'

// Un solo "Aprobar"/"Rechazar" por turno (no uno por archivo) — solo aparece cuando el modelo
// dejó una etapa de un plan largo pendiente de revisión (ver agent.js/"requires_approval"); en
// un pedido normal los cambios ya se aplicaron solos y esta barra ni se renderiza.
export default function TurnApprovalBar({ messageId, count, onApprove, onReject }) {
  const [busy, setBusy] = useState(false)

  const act = async (fn) => {
    setBusy(true)
    try {
      await fn(messageId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2">
      <span className="flex-1 text-xs text-muted">
        {count} {count === 1 ? 'cambio propuesto' : 'cambios propuestos'}
      </span>
      <button
        onClick={() => act(onApprove)}
        disabled={busy}
        className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Aprobar
      </button>
      <button
        onClick={() => act(onReject)}
        disabled={busy}
        className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/80 hover:bg-white/5 disabled:opacity-60"
      >
        <X className="size-3.5" /> Rechazar
      </button>
    </div>
  )
}
