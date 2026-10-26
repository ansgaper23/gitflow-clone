import React from 'react';
import { Loader2 } from 'lucide-react';

export function ThinkingState({ statusText = "Pensando..." }) {
  // Sanitizar puntos suspensivos duplicados o exceso de puntuación
  const cleanText = (statusText || '').replace(/\.{2,}/g, '').trim();

  return (
    <div className="inline-flex items-center gap-2.5 py-1.5 px-3 rounded-full bg-zinc-900/90 border border-white/10 shadow-sm text-zinc-300 animate-in fade-in duration-200 select-none backdrop-blur-md">
      {/* Micro spinner tenue con color acento azul Lovable */}
      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 stroke-[2.2] shrink-0" />
      
      {/* Texto de telemetría efímera con transición suave */}
      <span className="text-[12.5px] font-medium tracking-tight text-zinc-200 transition-all duration-150 truncate max-w-sm sm:max-w-md">
        {cleanText || 'Procesando cambios en el proyecto'}
      </span>
      
      {/* Micro-puntos pulsantes */}
      <span className="inline-flex items-center gap-0.5 ml-0.5 shrink-0">
        <span className="h-1 w-1 rounded-full bg-blue-400/80 animate-pulse" />
        <span className="h-1 w-1 rounded-full bg-blue-400/80 animate-pulse [animation-delay:200ms]" />
        <span className="h-1 w-1 rounded-full bg-blue-400/80 animate-pulse [animation-delay:400ms]" />
      </span>
    </div>
  );
}
