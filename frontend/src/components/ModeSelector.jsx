import React from 'react';
import { MessageSquare, ClipboardList, Hammer } from 'lucide-react';

export const MODES = {
  CHAT: 'chat',
  PLAN: 'plan',
  BUILD: 'build',
};

export default function ModeSelector({ currentMode, onSelectMode }) {
  const options = [
    {
      id: MODES.CHAT,
      label: 'Chat',
      icon: MessageSquare,
      desc: 'Discusión y consultas',
    },
    {
      id: MODES.PLAN,
      label: 'Plan',
      icon: ClipboardList,
      desc: 'Planificar antes de construir',
    },
    {
      id: MODES.BUILD,
      label: 'Build',
      icon: Hammer,
      badge: 'Auto',
      desc: 'Editar código y ejecutar en vivo',
    },
  ];

  return (
    <div className="flex items-center gap-1 p-1 bg-zinc-900/90 border border-zinc-800/80 rounded-full shadow-lg backdrop-blur-md">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = currentMode === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onSelectMode(opt.id)}
            title={opt.desc}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
              isActive
                ? 'bg-zinc-100 text-zinc-950 shadow-sm font-semibold'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-zinc-950' : 'text-zinc-400'}`} />
            <span>{opt.label}</span>
            {opt.badge && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold ${
                isActive ? 'bg-zinc-900 text-zinc-100' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              }`}>
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
