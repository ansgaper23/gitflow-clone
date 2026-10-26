import { useState } from 'react'
import { FileText, Github, Database, Check, X, ExternalLink } from 'lucide-react'

const STATUS_LABEL = {
  pending: null,
  applied: { text: 'Aplicado', className: 'bg-primary/15 text-primary' },
  rejected: { text: 'Rechazado', className: 'bg-red-500/15 text-red-300' },
}

export default function AssetChangeCard({ change, onApprove, onReject }) {
  const [busy, setBusy] = useState(false)
  const status = STATUS_LABEL[change.status]
  const isImage = change.mime_type?.startsWith('image/')

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
          {change.target === 'github' ? (
            <Github className="size-4 shrink-0 text-primary" />
          ) : (
            <Database className="size-4 shrink-0 text-primary" />
          )}
          <span className="truncate font-mono text-xs">
            {change.target === 'storage' ? `${change.bucket}/${change.path}` : change.path}
          </span>
        </span>
        {status && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
            {status.text}
          </span>
        )}
      </div>

      <p className="px-3 pb-2 text-xs text-muted">{change.summary}</p>

      <div className="px-3 pb-3">
        {isImage ? (
          <img
            src={`data:${change.mime_type};base64,${change.file_base64}`}
            alt={change.filename}
            className="max-h-48 rounded-md border border-border object-contain"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-border bg-[#0a0e18] px-3 py-2 text-xs text-muted">
            <FileText className="size-4 shrink-0" />
            {change.filename} · {Math.round(change.size_bytes / 1024)} KB
          </div>
        )}
      </div>

      {change.status === 'pending' && (
        <div className="flex gap-2 border-t border-border px-3 py-2">
          <button
            onClick={() => act(onApprove)}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-60"
          >
            <Check className="size-3.5" /> Aprobar y subir
          </button>
          <button
            onClick={() => act(onReject)}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/80 hover:bg-white/5 disabled:opacity-60"
          >
            <X className="size-3.5" /> Rechazar
          </button>
        </div>
      )}

      {change.status === 'applied' && (change.commit_url || change.public_url) && (
        <a
          href={change.commit_url || change.public_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 border-t border-border px-3 py-2 text-xs text-primary hover:underline"
        >
          {change.commit_url ? 'Ver commit en GitHub' : 'Ver archivo público'} <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}
