// frontend/src/components/chat/PlanCard.jsx
import React, { useState } from 'react';
import { CheckCircle2, ListTodo, FileCode, ArrowRight, Edit3, X, Sparkles, AlertCircle } from 'lucide-react';

export function PlanCard({
  plan,
  onApprove,
  onAdjust,
  isResponding = false,
}) {
  const [showAdjustInput, setShowAdjustInput] = useState(false);
  const [feedback, setFeedback] = useState('');

  if (!plan) return null;

  const title = plan.title || 'Plan de Implementación';
  const summary = plan.summary || '';
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const status = plan.status || 'WAITING_APPROVAL';
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';
  const isWaiting = status === 'WAITING_APPROVAL' || (!isApproved && !isRejected);

  const handleApprove = () => {
    if (onApprove && !isResponding) {
      onApprove();
    }
  };

  const handleSendFeedback = (e) => {
    e.preventDefault();
    if (!feedback.trim() || isResponding) return;
    if (onAdjust) {
      onAdjust(feedback.trim());
    }
  };

  return (
    <div className="rounded-2xl bg-zinc-900/90 border border-blue-500/20 p-4 mb-3 shadow-xl select-text text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center size-7 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-400">
            <ListTodo className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/20">
                Plan / Hoja de Ruta
              </span>
              {isApproved && (
                <span className="text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="size-3" /> Aprobado
                </span>
              )}
              {isRejected && (
                <span className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1">
                  <X className="size-3" /> Descartado
                </span>
              )}
            </div>
            <h4 className="font-semibold text-sm text-zinc-100 mt-1">{title}</h4>
          </div>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-xs text-zinc-300 leading-relaxed mt-3 mb-2 font-normal">
          {summary}
        </p>
      )}

      {/* Tasks List */}
      <div className="mt-3 space-y-2">
        {tasks.map((task, idx) => (
          <div
            key={task.id || idx}
            className="p-2.5 rounded-xl bg-zinc-800/40 border border-white/5 hover:border-white/10 transition-colors"
          >
            <div className="flex items-start gap-2.5">
              <div className="size-5 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-bold text-zinc-300">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <h5 className="text-xs font-semibold text-zinc-200">{task.title}</h5>
                {task.description && (
                  <p className="text-[11.5px] text-zinc-400 mt-0.5 leading-normal">
                    {task.description}
                  </p>
                )}
                {Array.isArray(task.filesToTouch) && task.filesToTouch.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {task.filesToTouch.map((filePath, fIdx) => (
                      <span
                        key={fIdx}
                        className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900/60 text-zinc-400 border border-white/5 truncate max-w-full"
                      >
                        <FileCode className="size-3 text-blue-400 shrink-0" />
                        <span className="truncate">{filePath}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Status or Approval Actions */}
      {isWaiting && (
        <div className="mt-4 pt-3 border-t border-white/10">
          {!showAdjustInput ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleApprove}
                disabled={isResponding}
                className="flex-1 py-2 px-3 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/20 transition-all cursor-pointer"
              >
                <CheckCircle2 className="size-3.5" />
                <span>{isResponding ? 'Procesando aprobación...' : '✓ Aprobar y construir plan'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAdjustInput(true)}
                disabled={isResponding}
                className="py-2 px-3 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-white/10 text-zinc-300 hover:text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Edit3 className="size-3.5" />
                <span>Ajustar plan...</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSendFeedback} className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-300">
                <span className="font-medium">¿Qué deseas ajustar del plan?</span>
                <button
                  type="button"
                  onClick={() => setShowAdjustInput(false)}
                  className="text-zinc-400 hover:text-zinc-200 p-0.5"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Ej. Agrega una tarea para pasarela Stripe antes de terminar, o cambia el diseño a modo oscuro..."
                rows={2}
                className="w-full text-xs rounded-xl bg-zinc-950 border border-white/10 p-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 resize-none"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdjustInput(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!feedback.trim() || isResponding}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5"
                >
                  <span>Enviar ajustes</span>
                  <ArrowRight className="size-3" />
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {isApproved && (
        <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center gap-2 text-xs text-emerald-400 font-medium">
          <Sparkles className="size-3.5" />
          <span>Plan aprobado. Ejecutando implementación técnica en modo Build.</span>
        </div>
      )}
    </div>
  );
}
export default PlanCard;
