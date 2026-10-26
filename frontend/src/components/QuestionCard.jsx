// frontend/src/components/QuestionCard.jsx
// SISTEMA INTERACTIVO DE PREGUNTAS Y TOMA DE DECISIONES DE DISEÑO ESTILO LOVABLE
// Soporta preguntas de arquitectura (single_choice) y paletas de color visuales (visual_choice).

import React, { useState } from 'react';
import { Check, Sparkles, ArrowRight, Palette, Layers, HelpCircle } from 'lucide-react';

export default function QuestionCard({ data, onAnswer, answered }) {
  // Normalizar datos: soportar formato nuevo (data.questions) o formato legacy (data.options)
  const introText = data?.introText || data?.body || '';
  const questions = Array.isArray(data?.questions) && data.questions.length > 0
    ? data.questions
    : [
        {
          id: 'q_legacy',
          header: data?.header || 'CONFIGURACIÓN',
          question: data?.question || 'Elige una opción para continuar:',
          type: 'single_choice',
          options: (data?.options || []).map((o, idx) => ({
            id: o.id || `opt_${idx}`,
            label: o.label,
            description: o.description || '',
            recommended: Boolean(o.recommended),
            swatches: Array.isArray(o.swatches) ? o.swatches : []
          }))
        }
      ];

  // Estado de selección por cada pregunta: { [questionId]: optionId }
  const [selections, setSelections] = useState(() => {
    const initial = {};
    questions.forEach((q) => {
      // Pre-seleccionar la opción recomendada o la primera opción por defecto
      const rec = q.options.find((o) => o.recommended) || q.options[0];
      if (rec) initial[q.id] = rec.id || rec.label;
    });
    return initial;
  });

  const [submitting, setSubmitting] = useState(false);

  const handleSelectOption = (questionId, optionId) => {
    if (answered || submitting) return;
    setSelections((prev) => ({
      ...prev,
      [questionId]: optionId
    }));
  };

  const handleSubmit = async () => {
    if (answered || submitting) return;
    setSubmitting(true);

    try {
      const summaryLines = [];
      questions.forEach((q) => {
        const chosenId = selections[q.id];
        const chosenOpt = q.options.find((o) => o.id === chosenId || o.label === chosenId);
        if (chosenOpt) {
          let line = `${q.header || 'Opción'}: ${chosenOpt.label}`;
          if (chosenOpt.swatches && chosenOpt.swatches.length > 0) {
            line += ` (Paleta: ${chosenOpt.swatches.join(', ')})`;
          }
          summaryLines.push(line);
        }
      });

      const responseText = summaryLines.length > 0
        ? `He seleccionado las siguientes opciones para el proyecto:\n${summaryLines.map((s) => `• ${s}`).join('\n')}`
        : 'Continúa con las opciones recomendadas por defecto.';

      await onAnswer?.(responseText);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (answered || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer?.('Aplica las opciones recomendadas por defecto y procede directamente con la construcción.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-white/10 bg-[#18181b]/95 p-4 shadow-xl text-zinc-100 flex flex-col gap-4 animate-in fade-in duration-200">
      {/* Intro text */}
      {introText && (
        <div className="flex items-center gap-2 text-xs text-zinc-300 font-medium pb-2 border-b border-white/10">
          <Sparkles className="size-3.5 text-blue-400 shrink-0" />
          <span>{introText}</span>
        </div>
      )}

      {/* Lista de Preguntas (1 a 3) */}
      <div className="flex flex-col gap-5">
        {questions.map((q, qIndex) => {
          const currentSelectedId = selections[q.id];
          const isVisualChoice = q.type === 'visual_choice' || q.options.some((o) => o.swatches?.length > 0);

          return (
            <div key={q.id || qIndex} className="flex flex-col gap-2.5">
              {/* Badge de encabezado y pregunta */}
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    {isVisualChoice ? <Palette className="size-3" /> : <Layers className="size-3" />}
                    {q.header || `PREGUNTA ${qIndex + 1}`}
                  </span>
                </div>
                <h4 className="text-xs font-semibold text-zinc-100 leading-snug">
                  {q.question}
                </h4>
              </div>

              {/* Opciones */}
              <div className={isVisualChoice ? 'grid grid-cols-1 sm:grid-cols-3 gap-2.5' : 'flex flex-col gap-2'}>
                {q.options.map((opt, optIndex) => {
                  const optId = opt.id || opt.label;
                  const isSelected = currentSelectedId === optId;

                  if (isVisualChoice) {
                    // Tarjeta Visual Choice con Muestrario de Colores (Swatches)
                    return (
                      <div
                        key={optId || optIndex}
                        onClick={() => handleSelectOption(q.id, optId)}
                        className={`group relative flex flex-col justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                          isSelected
                            ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40 shadow-md'
                            : 'border-white/10 bg-zinc-900/60 hover:border-white/20 hover:bg-zinc-800/60'
                        } ${answered ? 'opacity-70 cursor-default pointer-events-none' : ''}`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <span className="text-xs font-semibold text-zinc-200 group-hover:text-white">
                              {opt.label}
                            </span>
                            {isSelected && (
                              <span className="size-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                                <Check className="size-2.5 text-white" />
                              </span>
                            )}
                          </div>
                          {opt.description && (
                            <p className="text-[11px] text-zinc-400 leading-tight mb-2.5">
                              {opt.description}
                            </p>
                          )}
                        </div>

                        {/* Muestras de color HSL / HEX */}
                        {opt.swatches && opt.swatches.length > 0 && (
                          <div className="flex items-center gap-1.5 pt-2 border-t border-white/5">
                            {opt.swatches.slice(0, 4).map((swatch, sIdx) => (
                              <div
                                key={sIdx}
                                className="size-5 rounded-full border border-white/25 shadow-sm shrink-0 transition-transform group-hover:scale-105"
                                style={{ backgroundColor: swatch }}
                                title={swatch}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Tarjeta Single Choice clásica
                  return (
                    <div
                      key={optId || optIndex}
                      onClick={() => handleSelectOption(q.id, optId)}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/10 ring-1 ring-blue-500/40 shadow-sm'
                          : 'border-white/10 bg-zinc-900/60 hover:border-white/20 hover:bg-zinc-800/60'
                      } ${answered ? 'opacity-70 cursor-default pointer-events-none' : ''}`}
                    >
                      <div className="pt-0.5">
                        <span
                          className={`size-4 rounded-full border flex items-center justify-center transition-colors ${
                            isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-zinc-500 bg-zinc-800'
                          }`}
                        >
                          {isSelected && <Check className="size-2.5" />}
                        </span>
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-200">
                            {opt.label}
                          </span>
                          {opt.recommended && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                              Recomendada
                            </span>
                          )}
                        </div>
                        {opt.description && (
                          <p className="text-[11px] text-zinc-400 mt-0.5 leading-normal">
                            {opt.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer de Acciones */}
      <div className="flex items-center justify-between pt-3 border-t border-white/10 mt-1">
        {answered ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
            <Check className="size-3.5" />
            <span>Opciones seleccionadas y enviadas</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSkip}
              disabled={submitting}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Omitir y continuar
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs px-4 py-2 flex items-center gap-1.5 shadow-md transition-all ml-auto"
            >
              <span>{submitting ? 'Aplicando...' : 'Continuar con selección'}</span>
              <ArrowRight className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
