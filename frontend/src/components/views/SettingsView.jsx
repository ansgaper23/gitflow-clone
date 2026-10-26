// frontend/src/components/views/SettingsView.jsx
import React, { useState, useEffect } from 'react';
import { 
  Sliders, Brain, Globe, GitBranch, Pencil, Check, Loader2, Copy, 
  ExternalLink, Trash2, ArrowUpRight, Github, FolderGit2
} from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { getProjectDisplayName } from '../../lib/projectUtils';

export default function SettingsView({ 
  project, 
  subTab = 'general', 
  onSelectSubTab, 
  onProjectUpdated 
}) {
  const { user } = useAuth();
  const [projData, setProjData] = useState(project || {});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Sincronizar datos frescos del proyecto
  useEffect(() => {
    if (project?.id) {
      api.getProject(project.id)
        .then((p) => {
          if (p) setProjData(p);
        })
        .catch(() => {});
    }
  }, [project?.id]);

  const showFeedback = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div className="space-y-6 text-zinc-100 max-w-4xl mx-auto pb-10">
      {msg && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-xl text-xs font-medium animate-in fade-in">
          {msg}
        </div>
      )}

      {subTab === 'general' && (
        <GeneralSettingsSection 
          project={projData} 
          user={user} 
          onUpdated={(p) => {
            setProjData(prev => ({ ...prev, ...p }));
            onProjectUpdated?.(p);
          }}
          onFeedback={showFeedback}
        />
      )}

      {subTab === 'knowledge' && (
        <KnowledgeSettingsSection 
          project={projData} 
          onUpdated={(p) => {
            setProjData(prev => ({ ...prev, ...p }));
            onProjectUpdated?.(p);
          }}
          onFeedback={showFeedback}
        />
      )}

      {subTab === 'domains' && (
        <DomainsSettingsSection 
          project={projData} 
          onUpdated={(p) => {
            setProjData(prev => ({ ...prev, ...p }));
            onProjectUpdated?.(p);
          }}
          onFeedback={showFeedback}
        />
      )}

      {subTab === 'git' && (
        <GitSettingsSection 
          project={projData} 
          onUpdated={(p) => {
            setProjData(prev => ({ ...prev, ...p }));
            onProjectUpdated?.(p);
          }}
          onFeedback={showFeedback}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// 1. SUB-TAB: GENERAL
// -------------------------------------------------------------
function GeneralSettingsSection({ project, user, onUpdated, onFeedback }) {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(project?.name || '');
  const [savingName, setSavingName] = useState(false);

  const [editingSlug, setEditingSlug] = useState(false);
  const [slugVal, setSlugVal] = useState(project?.slug || '');
  const [savingSlug, setSavingSlug] = useState(false);

  const [checkpointsCount, setCheckpointsCount] = useState(0);
  const [messagesCount, setMessagesCount] = useState(0);

  useEffect(() => {
    if (project?.id) {
      api.listCheckpoints(project.id)
        .then((res) => setCheckpointsCount((res || []).length))
        .catch(() => {});
      api.conversations(project.id)
        .then((res) => {
          const list = Array.isArray(res) ? res : (res?.conversations || []);
          setMessagesCount(list.length > 0 ? (list[0]?.message_count || list.length * 4) : 0);
        })
        .catch(() => {});
    }
  }, [project?.id]);

  const handleSaveName = async () => {
    if (!nameVal.trim() || nameVal === project?.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await api.renameProject(project.id, nameVal.trim());
      onUpdated({ name: nameVal.trim() });
      onFeedback('Nombre del proyecto actualizado');
      setEditingName(false);
    } catch (err) {
      onFeedback(err.message || 'Error al actualizar nombre');
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveSlug = async () => {
    const clean = slugVal.trim().toLowerCase();
    if (!clean || clean === project?.slug) {
      setEditingSlug(false);
      return;
    }
    setSavingSlug(true);
    try {
      await api.updateProjectSlug(project.id, clean);
      onUpdated({ slug: clean });
      onFeedback('Subdominio actualizado');
      setEditingSlug(false);
    } catch (err) {
      onFeedback(err.message || 'Error al actualizar subdominio');
    } finally {
      setSavingSlug(false);
    }
  };

  const formattedDate = project?.created_at
    ? new Date(project.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Reciente';

  const host = typeof window !== 'undefined' ? window.location.host : 'flow-pro.online';

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado con Icono, Título y Fecha de Creación */}
      <div className="flex items-center gap-4 p-5 rounded-2xl bg-zinc-900/60 border border-white/10 shadow-sm">
        <div className="size-12 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold text-lg">
          {getProjectDisplayName(project).charAt(0).toUpperCase()}
        </div>
        <div>
          <h2 className="text-lg font-bold text-zinc-100">{getProjectDisplayName(project)}</h2>
          <p className="text-xs text-zinc-400">Creado el {formattedDate}</p>
        </div>
      </div>

      {/* Tarjeta Detalles del Proyecto */}
      <div className="rounded-2xl bg-zinc-900/40 border border-white/10 p-5 shadow-sm space-y-1">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">Detalles del proyecto</h3>

        {/* Project Name */}
        <div className="border-b border-white/10 py-3.5 flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">Project name</span>
          <div className="flex items-center gap-2">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  className="bg-zinc-800 text-zinc-100 px-2 py-1 rounded-lg border border-blue-500/50 outline-none text-xs"
                  autoFocus
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName}
                  className="p-1 rounded bg-blue-600 text-white hover:bg-blue-500"
                >
                  <Check className="size-3" />
                </button>
              </div>
            ) : (
              <>
                <span className="font-semibold text-zinc-200">{project?.name || 'Sin nombre'}</span>
                <button
                  type="button"
                  onClick={() => { setNameVal(project?.name || ''); setEditingName(true); }}
                  className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5 transition-colors"
                >
                  <Pencil className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* URL subdomain */}
        <div className="border-b border-white/10 py-3.5 flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">URL subdomain</span>
          <div className="flex items-center gap-2">
            {editingSlug ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={slugVal}
                  onChange={(e) => setSlugVal(e.target.value)}
                  className="bg-zinc-800 text-zinc-100 px-2 py-1 rounded-lg border border-blue-500/50 outline-none text-xs font-mono"
                  autoFocus
                />
                <button
                  onClick={handleSaveSlug}
                  disabled={savingSlug}
                  className="p-1 rounded bg-blue-600 text-white hover:bg-blue-500"
                >
                  <Check className="size-3" />
                </button>
              </div>
            ) : (
              <>
                <span className="font-mono text-zinc-300">{project?.slug ? `${project.slug}.${host}` : 'sin-subdominio'}</span>
                <button
                  type="button"
                  onClick={() => { setSlugVal(project?.slug || ''); setEditingSlug(true); }}
                  className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5 transition-colors"
                >
                  <Pencil className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Owner */}
        <div className="border-b border-white/10 py-3.5 flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">Owner</span>
          <span className="text-zinc-200 font-medium">{user?.email || 'Propietario'}</span>
        </div>

        {/* Messages count */}
        <div className="border-b border-white/10 py-3.5 flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">Messages count</span>
          <span className="text-zinc-200 font-semibold">{messagesCount || '0'}</span>
        </div>

        {/* AI edits count */}
        <div className="py-3.5 flex items-center justify-between text-xs">
          <span className="text-zinc-400 font-medium">AI edits count</span>
          <span className="text-zinc-200 font-semibold">{checkpointsCount || '1'}</span>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 2. SUB-TAB: CONOCIMIENTO (MEMORIA DE LA IA)
// -------------------------------------------------------------
function KnowledgeSettingsSection({ project, onUpdated, onFeedback }) {
  const [memoryText, setMemoryText] = useState(project?.ai_memory || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (project?.ai_memory !== undefined) {
      setMemoryText(project.ai_memory || '');
    }
  }, [project?.ai_memory]);

  const handleSaveMemory = async () => {
    setSaving(true);
    try {
      await api.updateProjectAiMemory(project.id, memoryText);
      onUpdated({ ai_memory: memoryText });
      onFeedback('Memoria de la IA actualizada con éxito');
    } catch (err) {
      onFeedback(err.message || 'Error al guardar memoria');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <div className="flex items-center gap-2.5">
        <Brain className="size-5 text-purple-400" />
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Memoria de la IA</h3>
          <p className="text-xs text-zinc-400">
            Directrices arquitectónicas, convenciones y conocimiento persistente que la IA recuerda para este proyecto.
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-zinc-900/40 border border-white/10 p-5 space-y-4">
        <textarea
          rows={10}
          value={memoryText}
          onChange={(e) => setMemoryText(e.target.value)}
          placeholder="Escribe directrices, convenciones de diseño o notas de arquitectura que quieras que el agente siempre respete en este proyecto..."
          className="w-full rounded-xl bg-zinc-900 border border-white/10 p-3.5 text-xs text-zinc-200 outline-none focus:border-blue-500/50 leading-relaxed font-mono"
        />

        <div className="flex justify-between items-center pt-2">
          <span className="text-[11px] text-zinc-500">
            Se inyecta automáticamente en cada turno de construcción.
          </span>
          <button
            type="button"
            onClick={handleSaveMemory}
            disabled={saving}
            className="rounded-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-4 py-2 flex items-center gap-1.5 shadow-md transition-all"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Guardar memoria
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 3. SUB-TAB: DOMINIOS
// -------------------------------------------------------------
function DomainsSettingsSection({ project, onUpdated, onFeedback }) {
  const [domainInput, setDomainInput] = useState(project?.customDomain || '');
  const [connecting, setConnecting] = useState(false);
  const [nameservers, setNameservers] = useState(null);

  const handleConnectDomain = async (e) => {
    e?.preventDefault();
    const domain = domainInput.trim().toLowerCase();
    if (!domain) return;
    setConnecting(true);
    try {
      const res = await api.connectDomain(project.id, domain);
      setNameservers(res.nameservers || []);
      onUpdated({ customDomain: domain });
      onFeedback('Dominio configurado. Configura los nameservers indicados.');
    } catch (err) {
      onFeedback(err.message || 'Error al conectar dominio');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <div className="flex items-center gap-2.5">
        <Globe className="size-5 text-blue-400" />
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Dominio Personalizado</h3>
          <p className="text-xs text-zinc-400">
            Conecta tu propio dominio (ej. <code className="text-zinc-300">miapp.com</code>) para servir tu aplicación.
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-zinc-900/40 border border-white/10 p-5 space-y-4">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="midominio.com"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            className="flex-1 rounded-xl bg-zinc-900 border border-white/10 px-3.5 py-2 text-xs text-zinc-100 outline-none focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={handleConnectDomain}
            disabled={connecting || !domainInput.trim()}
            className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs px-4 py-2 transition-colors disabled:opacity-50"
          >
            {connecting ? 'Conectando...' : 'Conectar'}
          </button>
        </div>

        {nameservers && nameservers.length > 0 && (
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-zinc-300 space-y-2">
            <p className="font-semibold text-blue-400">Configura estos Nameservers en tu proveedor DNS:</p>
            <ul className="list-disc list-inside space-y-1 font-mono text-zinc-200">
              {nameservers.map((ns, idx) => (
                <li key={idx}>{ns}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 4. SUB-TAB: GIT
// -------------------------------------------------------------
function GitSettingsSection({ project, onFeedback }) {
  const isGithub = project?.storage_type === 'github' || project?.storageType === 'github';
  const repoName = project?.repo_full_name || project?.repoFullName || 'virtual/repo';
  const [migrating, setMigrating] = useState(false);

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      await api.migrateToGithub(project.id, project.name);
      onFeedback('Repositorio sincronizado con GitHub');
    } catch (err) {
      onFeedback(err.message || 'Error al exportar a GitHub');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <div className="flex items-center gap-2.5">
        <GitBranch className="size-5 text-emerald-400" />
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Estado del Repositorio Git</h3>
          <p className="text-xs text-zinc-400">
            Control de versiones y sincronización bidireccional de tu código fuente.
          </p>
        </div>
      </div>

      <div className="rounded-2xl bg-zinc-900/40 border border-white/10 p-5 space-y-4">
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900 border border-white/10 text-xs">
          <div className="flex items-center gap-3">
            {isGithub ? <Github className="size-5 text-white" /> : <FolderGit2 className="size-5 text-zinc-400" />}
            <div>
              <p className="font-semibold text-zinc-200">{isGithub ? repoName : 'Proyecto Virtual (FlowPro Cloud)'}</p>
              <p className="text-[11px] text-zinc-500">Rama activa: main</p>
            </div>
          </div>
          {isGithub ? (
            <a
              href={`https://github.com/${repoName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors"
            >
              Ver en GitHub <ArrowUpRight className="size-3.5" />
            </a>
          ) : (
            <button
              type="button"
              onClick={handleMigrate}
              disabled={migrating}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors"
            >
              {migrating && <Loader2 className="size-3 animate-spin" />}
              Conectar con GitHub
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
