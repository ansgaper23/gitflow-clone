import { lineDiff } from '../lib/diff.js'

const MAX_LINES = 400

export default function DiffViewer({ original, updated }) {
  const diff = lineDiff(original || '', updated || '')
  const truncated = diff.length > MAX_LINES
  const rows = truncated ? diff.slice(0, MAX_LINES) : diff

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-[#0a0e18] font-mono text-xs">
      {rows.map((row, i) => (
        <div
          key={i}
          className={`flex whitespace-pre px-3 py-0.5 ${
            row.type === 'add'
              ? 'bg-emerald-500/10 text-emerald-300'
              : row.type === 'del'
                ? 'bg-red-500/10 text-red-300'
                : 'text-muted'
          }`}
        >
          <span className="mr-2 select-none opacity-60">
            {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
          </span>
          {row.line || ' '}
        </div>
      ))}
      {truncated && <div className="px-3 py-1 text-muted">… diff truncado ({diff.length} líneas totales)</div>}
    </div>
  )
}
