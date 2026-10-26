import React, { useState } from 'react';
import { 
  BarChart3, Cloud, Sparkles, Layers, CreditCard, 
  Boxes, ShieldCheck, Search, Settings, X, ExternalLink, BrainCircuit,
  Database, Users, HardDrive, Terminal, FileText, LayoutGrid,
  Sliders, Brain, Globe, GitBranch
} from 'lucide-react';

import CloudView from './views/CloudView';
import SecretsView from './views/SecretsView';
import AnalyticsView from './views/AnalyticsView';
import SeoView from './views/SeoView';
import SettingsView from './views/SettingsView';
import IntegrationsTab from './IntegrationsTab';
import SkillsTab from './SkillsTab';

const MENU_ITEMS = [
  { id: 'analytics', label: 'Analíticas', icon: BarChart3 },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'skills', label: 'Skills de IA', icon: BrainCircuit },
  { id: 'integrations', label: 'Integraciones de app', icon: Layers },
  { id: 'payments', label: 'Pagos', icon: CreditCard },
  { id: 'connectors', label: 'Conectores', icon: Boxes },
  { id: 'secrets', label: 'Seguridad', icon: ShieldCheck },
  { id: 'seo', label: 'SEO y búsqueda', icon: Search },
  { id: 'settings', label: 'Ajustes', icon: Settings },
];

const CLOUD_SUB_ITEMS = [
  { id: 'Overview', label: 'Overview', icon: LayoutGrid },
  { id: 'Database', label: 'Database', icon: Database },
  { id: 'Users', label: 'Users', icon: Users },
  { id: 'Storage', label: 'Storage', icon: HardDrive },
  { id: 'SQL editor', label: 'SQL editor', icon: Terminal },
  { id: 'Logs', label: 'Logs', icon: FileText },
  { id: 'Secrets', label: 'Secrets', icon: ShieldCheck },
];

const SETTINGS_SUB_ITEMS = [
  { id: 'general', label: 'General', icon: Sliders },
  { id: 'knowledge', label: 'Conocimiento', icon: Brain },
  { id: 'domains', label: 'Dominios', icon: Globe },
  { id: 'git', label: 'Git', icon: GitBranch },
];

function PlaceholderSection({ tabName }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="h-12 w-12 rounded-xl bg-[#18191c] border border-[#27282d] flex items-center justify-center text-[#8a8f98] mb-4">
        <Sparkles className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold text-white capitalize">{tabName}</h3>
      <p className="text-xs text-[#8a8f98] max-w-sm mt-1">
        Esta sección se aprovisiona automáticamente según los módulos activados en tu proyecto.
      </p>
    </div>
  );
}

export default function MorePanel({ projectId, project, repoFullName, onMatchResult, onClose, onSendPrompt, onProjectUpdated, initialTab = 'cloud' }) {
  const [activeTab, setActiveTab] = useState(
    initialTab === 'settings' ? 'settings' : (initialTab === 'functions' || initialTab === 'db' ? 'cloud' : (initialTab === 'secrets' ? 'secrets' : 'cloud'))
  );
  const [cloudSubTab, setCloudSubTab] = useState(
    initialTab === 'db' ? 'Database' : 'Overview'
  );
  const [settingsSubTab, setSettingsSubTab] = useState('general');

  return (
    <div className="flex flex-col h-full w-full bg-[#0c0d0e] text-[#ededed]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#1f2024] px-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md bg-[#18191c] px-2.5 py-1 text-xs font-medium text-[#a1a1aa] border border-[#27282d]">
            <Layers className="h-3.5 w-3.5 text-blue-400" />
            <span>Más</span>
          </div>
        </div>

        <h1 className="text-sm font-semibold tracking-wide text-[#ededed]">Más</h1>

        <button 
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-full text-[#8a8f98] hover:bg-[#1a1b1f] hover:text-white transition-colors"
          title="Cerrar panel"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Barra lateral unificada (w-56) sin columnas duplicadas (Estándar Lovable) */}
        <aside className="w-56 shrink-0 border-r border-[#1f2024] p-3 flex flex-col gap-1 overflow-y-auto bg-[#0c0d0e]">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <React.Fragment key={item.id}>
                <button
                  onClick={() => {
                    setActiveTab(item.id);
                  }}
                  className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-all ${
                    isActive ? 'bg-[#202126] text-white font-medium shadow-sm' : 'text-[#8a8f98] hover:text-[#ededed] hover:bg-[#16171a]'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-[#8a8f98]'}`} />
                  <span className="truncate">{item.label}</span>
                </button>

                {/* Sub-secciones anidadas directamente bajo Cloud */}
                {item.id === 'cloud' && activeTab === 'cloud' && (
                  <div className="pl-3 pr-1 py-1 space-y-0.5 border-l border-white/10 ml-4 my-1">
                    {CLOUD_SUB_ITEMS.map((sub) => {
                      const SubIcon = sub.icon;
                      const isSubActive = cloudSubTab === sub.id;
                      return (
                        <button
                          key={sub.id}
                          onClick={() => setCloudSubTab(sub.id)}
                          className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                            isSubActive
                              ? 'bg-blue-600/20 text-blue-400 font-semibold'
                              : 'text-zinc-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <SubIcon className={`h-3.5 w-3.5 shrink-0 ${isSubActive ? 'text-blue-400' : 'text-zinc-400'}`} />
                          <span className="truncate">{sub.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Sub-secciones anidadas directamente bajo Ajustes */}
                {item.id === 'settings' && activeTab === 'settings' && (
                  <div className="pl-3 pr-1 py-1 space-y-0.5 border-l border-white/10 ml-4 my-1">
                    {SETTINGS_SUB_ITEMS.map((sub) => {
                      const SubIcon = sub.icon;
                      const isSubActive = settingsSubTab === sub.id;
                      return (
                        <button
                          key={sub.id}
                          onClick={() => setSettingsSubTab(sub.id)}
                          className={`flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                            isSubActive
                              ? 'bg-blue-600/20 text-blue-400 font-semibold'
                              : 'text-zinc-400 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <SubIcon className={`h-3.5 w-3.5 shrink-0 ${isSubActive ? 'text-blue-400' : 'text-zinc-400'}`} />
                          <span className="truncate">{sub.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </aside>

        {/* Contenido principal: ancho completo para la base de datos sin restricciones artificiales */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-[#0e0f12]">
          <div className={activeTab === 'cloud' ? 'w-full h-full' : 'max-w-5xl mx-auto'}>
            {activeTab === 'cloud' && (
              <CloudView 
                projectId={projectId} 
                repoFullName={repoFullName} 
                onMatchResult={onMatchResult} 
                onSendPrompt={onSendPrompt}
                subTab={cloudSubTab}
                onSelectSubTab={setCloudSubTab}
              />
            )}
            {activeTab === 'secrets' && <SecretsView projectId={projectId} />}
            {activeTab === 'integrations' && <IntegrationsTab projectId={projectId} repoFullName={repoFullName} onSendPrompt={onSendPrompt} onMatchResult={onMatchResult} />}
            {activeTab === 'skills' && <SkillsTab projectId={projectId} />}
            {activeTab === 'analytics' && <AnalyticsView project={{id: projectId, name: 'Mi Proyecto', slug: 'project'}} />}
            {activeTab === 'seo' && <SeoView projectId={projectId} onSendPrompt={onSendPrompt} />}
            {activeTab === 'settings' && (
              <SettingsView 
                project={project || { id: projectId, name: 'Mi Proyecto', slug: 'project' }} 
                subTab={settingsSubTab}
                onSelectSubTab={setSettingsSubTab}
                onProjectUpdated={onProjectUpdated}
              />
            )}
            {['ai', 'payments', 'connectors'].includes(activeTab) && (
              <PlaceholderSection tabName={activeTab} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}