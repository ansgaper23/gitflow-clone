import React from 'react';
import { Bookmark, FileText } from 'lucide-react';

const STATUS_LABEL = {
  pending: null,
  applied: { text: 'Aplicado', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  rejected: { text: 'Rechazado', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
  approved: { text: 'Aprobado', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
};

export default function GroupedChangesCard({ changes, onShowFull }) {
  if (!changes || changes.length === 0) return null;

  const filesMap = new Map();
  for (const c of changes) {
    if (!filesMap.has(c.file_path)) {
      filesMap.set(c.file_path, { ...c, count: 1 });
    } else {
      const existing = filesMap.get(c.file_path);
      existing.count++;
      existing.id = c.id;
      existing.new_content = c.new_content;
      existing.commit_url = c.commit_url || existing.commit_url;
      existing.summary = c.summary;
      existing.status = c.status;
    }
  }

  const uniqueFiles = Array.from(filesMap.values());
  const lastChange = changes[changes.length - 1];
  const status = STATUS_LABEL[lastChange.status] || STATUS_LABEL.applied;

  let titleText = uniqueFiles[0]?.summary || 'Cambios aplicados';
  if (titleText.length > 55) {
    titleText = titleText.substring(0, 55) + '...';
  }

  const filesCount = uniqueFiles.length;

  return (
    <div className="w-full max-w-[340px] rounded-xl border border-[#26282d] bg-[#141518] p-3 space-y-3 shadow-sm mt-1 mb-2">
      
      {/* Encabezado: Título + Status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <h4 className="text-[12px] font-medium text-zinc-100 line-clamp-1">
            {titleText}
          </h4>
        </div>
        {status && (
          <span className={\`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full border \${status.className}\`}>
            {status.text}
          </span>
        )}
      </div>

      {/* Fila de archivos modificados */}
      <div className="flex flex-wrap gap-1.5">
        {uniqueFiles.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#1e1f23] border border-[#2d2f34]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80" />
            <span className="text-[10px] text-zinc-300 font-mono truncate max-w-[200px]">
              {f.file_path.split('/').pop()}
            </span>
          </div>
        ))}
      </div>

      {/* Botón Detalles */}
      <div className="pt-1">
        <button
          type="button"
          onClick={(e) => {
             e.stopPropagation();
             onShowFull?.(uniqueFiles[0]);
          }}
          className="flex w-full items-center justify-center gap-2 py-1.5 px-3 rounded-lg bg-[#1e1f23] text-zinc-300 border border-[#2d2f34] text-[11px] font-medium hover:bg-[#26282d] transition-all"
        >
          <FileText className="w-3.5 h-3.5 text-zinc-400" />
          Detalles ({filesCount})
        </button>
      </div>
    </div>
  );
}
