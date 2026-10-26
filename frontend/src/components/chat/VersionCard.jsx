// frontend/src/components/chat/VersionCard.jsx
import React, { useState } from 'react';
import { Bookmark, ChevronDown, ChevronUp, FileCode2, Database, Eye, RotateCcw, Check } from 'lucide-react';

export function VersionCard({
  title = 'Actualización del proyecto',
  modifiedFiles = [],
  dbChanges = [],
  isActive = true,
  onViewDiff,
  onPreview,
  onRestore,
  commitSha,
  messageId,
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  const totalFiles = (Array.isArray(modifiedFiles) ? modifiedFiles : []).length;
  const totalDb = (Array.isArray(dbChanges) ? dbChanges : []).length;

  const handleRestoreClick = async () => {
    if (!confirmRestore) {
      setConfirmRestore(true);
      setTimeout(() => setConfirmRestore(false), 4000);
      return;
    }
    if (onRestore && !isRestoring) {
      setIsRestoring(true);
      try {
        await onRestore({ messageId, commitSha });
      } finally {
        setIsRestoring(false);
        setConfirmRestore(false);
      }
    }
  };

  return (
    <div className="rounded-2xl bg-zinc-900/90 border border-white/10 p-3.5 mb-3 shadow-lg select-text text-zinc-100">
      {/* Cabecera de la versión */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)] shrink-0" />
          <h4 className="font-semibold text-sm text-zinc-100 truncate">{title}</h4>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {commitSha && (
            <span className="text-[10px] font-mono text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded border border-white/5">
              {String(commitSha).slice(0, 7)}
            </span>
          )}
          <button
            type="button"
            onClick={() => setBookmarked(!bookmarked)}
            title={bookmarked ? 'Marcador guardado' : 'Guardar marcador'}
            className={`p-1 rounded-lg transition-colors ${
              bookmarked ? 'text-blue-400 hover:text-blue-300' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Bookmark className={`size-4 ${bookmarked ? 'fill-blue-500' : ''}`} />
          </button>
        </div>
      </div>

      {/* Fila de botones de acción */}
      <div className={`grid ${onRestore ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 mt-3`}>
        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          className="rounded-full border border-white/15 bg-zinc-800/60 hover:bg-zinc-800 py-1.5 px-2.5 text-xs text-zinc-200 font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
        >
          <span>Detalles</span>
          {showDetails ? <ChevronUp className="size-3 text-zinc-400" /> : <ChevronDown className="size-3 text-zinc-400" />}
        </button>

        <button
          type="button"
          onClick={onPreview}
          className={`rounded-full py-1.5 px-2.5 text-xs font-medium flex items-center justify-center gap-1 transition-all cursor-pointer ${
            isActive
              ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
              : 'bg-zinc-800/60 text-zinc-300 border border-white/15 hover:bg-zinc-800 hover:text-white'
          }`}
        >
          <Eye className="size-3" />
          <span className="truncate">{isActive ? 'Vista previa' : 'Vista previa'}</span>
        </button>

        {onRestore && (
          <button
            type="button"
            onClick={handleRestoreClick}
            disabled={isRestoring}
            title="Restaurar el proyecto a esta versión exacta"
            className={`rounded-full py-1.5 px-2.5 text-xs font-medium flex items-center justify-center gap-1 transition-all cursor-pointer ${
              confirmRestore
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                : 'bg-zinc-800/60 text-zinc-300 border border-white/15 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            {confirmRestore ? <Check className="size-3" /> : <RotateCcw className="size-3" />}
            <span className="truncate">{confirmRestore ? '¿Confirmar?' : isRestoring ? 'Revirtiendo...' : 'Restaurar'}</span>
          </button>
        )}
      </div>

      {/* Despliegue de Detalles Técnicos (Archivos y Migraciones) */}
      {showDetails && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-2.5 text-xs text-zinc-300 animate-in fade-in duration-150">
          {totalFiles > 0 && (
            <div>
              <p className="font-semibold text-zinc-400 mb-1 flex items-center gap-1.5">
                <FileCode2 className="size-3.5 text-blue-400" />
                Archivos modificados ({totalFiles})
              </p>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {modifiedFiles.map((f, i) => (
                  <div
                    key={i}
                    onClick={() => onViewDiff?.(typeof f === 'string' ? f : f?.path)}
                    className="flex items-center justify-between p-1.5 rounded-lg bg-zinc-800/40 hover:bg-zinc-800/80 cursor-pointer font-mono text-[11px] text-zinc-300 transition-colors"
                  >
                    <span className="truncate">{typeof f === 'string' ? f : (f?.path || f?.summary)}</span>
                    <span className="text-[10px] text-blue-400 ml-2 shrink-0">Ver diff</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalDb > 0 && (
            <div>
              <p className="font-semibold text-zinc-400 mb-1 flex items-center gap-1.5">
                <Database className="size-3.5 text-amber-400" />
                Migraciones de Base de Datos ({totalDb})
              </p>
              <div className="space-y-1 max-h-32 overflow-y-auto pr-1 font-mono text-[11px]">
                {dbChanges.map((db, idx) => (
                  <div key={idx} className="p-1.5 rounded-lg bg-zinc-800/40 border border-white/5 text-zinc-300">
                    <p className="font-medium text-amber-300/90">{db.summary || 'Cambio en esquema'}</p>
                    {db.sql && <pre className="mt-1 text-[10px] text-zinc-400 overflow-x-auto p-1 bg-black/30 rounded">{db.sql}</pre>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {totalFiles === 0 && totalDb === 0 && (
            <p className="text-zinc-500 italic py-1">Sin archivos técnicos modificados en este paso.</p>
          )}
        </div>
      )}
    </div>
  );
}
export default VersionCard;
