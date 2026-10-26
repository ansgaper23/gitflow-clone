import React from 'react';
import { Search, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useSeoStatus } from '../../hooks/useCloudData';

export default function SeoView({ projectId, onSendPrompt }) {
  const { data: audit, isLoading, fixSeo, isFixing } = useSeoStatus(projectId);
  const checks = audit?.checks || [];
  
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-10">
      <div className="p-5 rounded-xl border border-[#23252a] bg-[#141519]">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold text-[#f0f2f5]">auditoría SEO {audit?.score !== undefined ? `(Score: ${audit.score})` : ''}</h3>
            <p className="text-xs text-[#8a8f9d] mt-1">Evaluando VFS index.html y rutas</p>
          </div>
          <button 
            onClick={() => { fixSeo(); onSendPrompt("Corrige las etiquetas SEO faltantes (title, meta description, opengraph) y genera robots.txt y URLs canónicas según el diagnóstico de auditoría SEO."); }}
            disabled={isFixing || isLoading}
            className={`px-4 py-2 rounded-lg border border-[#23252a] bg-[#191a20] hover:bg-[#202229] transition-colors text-xs font-medium text-white ${isFixing ? 'opacity-50' : ''}`}
          >
            {isFixing ? 'Corrigiendo con IA...' : 'Solucionar todo con IA'}
          </button>
        </div>

        <div className="space-y-4">
          {isLoading && (
             <div className="flex items-center gap-3 p-3 rounded-lg bg-[#191a20] border border-[#23252a]">
               <Loader2 className="w-4 h-4 text-[#3b82f6] animate-spin" />
               <span className="text-xs text-[#8a8f9d]">Comprobando contenido y etiquetas SEO...</span>
             </div>
          )}
          {!isLoading && checks.map((iss) => (
             <div key={iss.id} className={`flex items-center gap-3 p-3 rounded-lg bg-[#191a20] border ${iss.passed ? 'border-[#10b98130]' : iss.impact === 'high' ? 'border-[#ef444430]' : 'border-[#f59e0b30]'} transition-colors`}>
               {iss.passed ? (
                 <CheckCircle2 className="w-4 h-4 text-[#10b981]" />
               ) : (
                 <AlertTriangle className={`w-4 h-4 ${iss.impact === 'high' ? 'text-[#ef4444]' : 'text-[#f59e0b]'}`} />
               )}
               <span className="block text-xs font-medium text-[#f0f2f5]">{iss.label}</span>
             </div>
          ))}
        </div>
      </div>
    </div>
  );
}
