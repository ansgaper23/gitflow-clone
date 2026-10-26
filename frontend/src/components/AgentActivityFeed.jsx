import React, { useState } from 'react';
import AgentLiveStatus from './AgentLiveStatus';
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function AgentActivityFeed({ telemetry = [], isGenerating = false }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!telemetry || telemetry.length === 0) return null;

  const latestStep = telemetry[telemetry.length - 1];

  if (isGenerating) {
    const file = latestStep?.payload?.files?.[0] || latestStep?.payload?.path;
    return <AgentLiveStatus currentPhase={latestStep?.phase || 'THINKING'} currentFile={file} />;
  }

  return (
    <div className="my-2.5 rounded-xl border border-zinc-800/80 bg-zinc-950/60 overflow-hidden text-xs font-sans transition-all">
      {/* Barra de cabecera colapsable */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2 hover:bg-zinc-900/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isGenerating ? (
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </div>
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          )}

          <span className="font-medium text-zinc-300">
            {isGenerating
              ? latestStep?.label || 'Procesando cambios...'
              : `${telemetry.length} acciones completadas`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-500">
          <span className="text-[10px] uppercase tracking-wider">Detalles</span>
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
      </button>

      {/* Lista de pasos animados */}
      {isOpen && (
        <div className="px-3.5 pb-3 pt-1 border-t border-zinc-800/80 space-y-2 bg-zinc-900/20">
          {telemetry.map((step, idx) => {
            const isLast = idx === telemetry.length - 1;
            return (
              <div key={idx} className="flex items-start gap-2.5 text-zinc-400">
                {step.status === 'running' || (isGenerating && isLast) ? (
                  <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin mt-0.5 shrink-0" />
                ) : step.status === 'failed' ? (
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
                )}

                <div className="flex-1 font-mono text-[11px] leading-relaxed">
                  <span className={isLast && isGenerating ? 'text-zinc-200 font-semibold' : 'text-zinc-400'}>
                    {step.label || step.message}
                  </span>
                  {step.details && (
                    <p className="text-[10px] text-zinc-500 mt-0.5 font-sans">{step.details}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
