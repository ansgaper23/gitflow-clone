import React from 'react';
import { Loader2, Code2, Sparkles, CheckCircle2 } from 'lucide-react';

/**
 * Mapeo de estados técnicos a etiquetas humanas y elegantes
 */
const STATUS_CONFIG = {
  THINKING: {
    label: 'Planificando solución...',
    icon: Sparkles,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10 border-amber-400/20',
  },
  WRITING_VFS: {
    label: (file) => file ? `Editando ${file}...` : 'Aplicando cambios...',
    icon: Code2,
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10 border-blue-400/20',
  },
  VALIDATING_BUILD: {
    label: 'Comprobando compilación...',
    icon: Loader2,
    spin: true,
    color: 'text-violet-400',
    bgColor: 'bg-violet-400/10 border-violet-400/20',
  },
  AUDITING_RUNTIME: {
    label: 'Verificando en vista previa...',
    icon: Loader2,
    spin: true,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-400/10 border-emerald-400/20',
  },
  HEALING: {
    label: 'Ajustando detalles...',
    icon: Sparkles,
    color: 'text-sky-400',
    bgColor: 'bg-sky-400/10 border-sky-400/20',
  },
};

export default function AgentLiveStatus({ currentPhase = 'THINKING', currentFile = null }) {
  const config = STATUS_CONFIG[currentPhase] || STATUS_CONFIG.THINKING;
  const Icon = config.icon;
  const label = typeof config.label === 'function' ? config.label(currentFile) : config.label;

  return (
    <div className="flex items-center gap-2 py-2 mb-2">
      {/* Píldora animada estilo Lovable */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium backdrop-blur-md transition-all duration-300 shadow-sm ${config.bgColor}`}>
        {/* Icono con animación sutil */}
        <Icon className={`w-3.5 h-3.5 ${config.color} ${config.spin ? 'animate-spin' : 'animate-pulse'}`} />
        
        {/* Texto con gradiente y efecto shimmer */}
        <span className="text-zinc-300 tracking-wide font-sans">
          {label}
        </span>

        {/* Punto brillante de actividad */}
        <span className="relative flex h-2 w-2 ml-0.5">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${config.color.replace('text-', 'bg-')}`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${config.color.replace('text-', 'bg-')}`} />
        </span>
      </div>
    </div>
  );
}
