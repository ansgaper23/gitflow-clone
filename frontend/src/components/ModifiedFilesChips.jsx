import React from 'react';
import { FileCode2, Check } from 'lucide-react';

export function ModifiedFilesChips({ files, onFileClick }) {
  if (!files || files.length === 0) return null;
  
  const validFiles = files.filter(Boolean);
  if (validFiles.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2 border-t border-white/5">
      <span className="text-[11px] text-zinc-500 font-medium mr-1 flex items-center gap-1">
        <Check className="w-3 h-3 text-emerald-400" />
        Editado:
      </span>
      {validFiles.map((filePath) => {
        const pathStr = String(filePath);
        const fileName = pathStr.split('/').pop() || pathStr;
        const dirPath = pathStr.substring(0, pathStr.lastIndexOf('/'));

        return (
          <button
            key={pathStr}
            type="button"
            onClick={() => onFileClick?.(pathStr)}
            title={pathStr}
            className="group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs text-zinc-300 hover:text-white transition-all cursor-pointer font-mono"
          >
            <FileCode2 className="w-3 h-3 text-zinc-400 group-hover:text-blue-400 transition-colors" />
            <span className="truncate max-w-[160px] font-medium">{fileName}</span>
            {dirPath && (
              <span className="text-[10px] text-zinc-500 group-hover:text-zinc-400 hidden sm:inline">
                {dirPath}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
