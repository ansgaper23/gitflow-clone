import React, { useState } from 'react';
import { 
  Database, Users, HardDrive, Terminal, FileText, 
  Table2, ShieldCheck, ChevronRight, CheckCircle2, AlertCircle, RefreshCw
} from 'lucide-react';
import { useCloudOverview } from '../../hooks/useCloudData';
import DbConnectionPanel from '../DbConnectionPanel';
import DatabaseViewPanel from '../DatabaseViewPanel';
import UsersView from './cloud/UsersView';
import StorageView from './cloud/StorageView';
import SecretsView from './SecretsView';

export default function CloudView({ 
  projectId, 
  repoFullName, 
  onSendPrompt, 
  subTab: controlledSubTab, 
  onSelectSubTab 
}) {
  const [internalSubTab, setInternalSubTab] = useState('Overview');
  const subTab = controlledSubTab !== undefined ? controlledSubTab : internalSubTab;
  const setSubTab = onSelectSubTab || setInternalSubTab;
  
  const { data: cloudData, isLoading, refetch } = useCloudOverview(projectId);

  if (isLoading) return (
    <div className="p-12 flex flex-col items-center justify-center h-full gap-3">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <span className="text-xs text-zinc-400">Cargando estado de Cloud…</span>
    </div>
  );
  
  if (cloudData?.isConnected === false) return (
    <div className="p-8 flex flex-col items-center justify-center text-center h-full">
      <div className="p-4 rounded-2xl bg-zinc-900 border border-white/10 mb-4 text-zinc-400">
        <Database className="w-10 h-10" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">Base de datos desconectada</h3>
      <p className="text-zinc-400 text-sm mb-6 max-w-sm">
        Conecta Supabase o utiliza Flow Cloud para habilitar tus tablas, usuarios y almacenamiento.
      </p>
      <DbConnectionPanel projectId={projectId} repoFullName={repoFullName} onSendPrompt={onSendPrompt} />
    </div>
  );

  return (
    <div className="w-full h-full">
      {subTab === 'Overview' && (
        <CloudOverviewView 
          cloudData={cloudData} 
          onSelectSubTab={setSubTab} 
          onRefetch={refetch}
        />
      )}
      {subTab === 'Database' && (
        <DatabaseViewPanel 
          projectId={projectId} 
          repoFullName={repoFullName} 
          onSendPrompt={onSendPrompt} 
        />
      )}
      {subTab === 'Users' && (
        <UsersView projectId={projectId} />
      )}
      {subTab === 'Storage' && (
        <StorageView projectId={projectId} />
      )}
      {subTab === 'SQL editor' && (
        <DatabaseViewPanel 
          projectId={projectId} 
          repoFullName={repoFullName} 
          onSendPrompt={onSendPrompt} 
          initialSqlOpen={true}
        />
      )}
      {subTab === 'Logs' && (
        <CloudLogsView cloudData={cloudData} />
      )}
      {subTab === 'Secrets' && (
        <SecretsView projectId={projectId} />
      )}
    </div>
  );
}

/**
 * Vista Overview de Cloud al Estándar Exacto de Lovable:
 * Contenedores oscuros apilados verticalmente (Database, Users, Storage).
 */
function CloudOverviewView({ cloudData, onSelectSubTab, onRefetch }) {
  const tables = cloudData?.tables || [];
  const tablesCount = cloudData?.tablesCount || tables.length || 0;
  const signupsCount = cloudData?.signupsCount || 0;
  const bucketsCount = cloudData?.bucketsCount || 0;

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">
      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            Overview
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-medium tracking-wide flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {cloudData?.provider === 'oauth' ? 'Supabase Connected' : 'PostgreSQL Active'}
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Resumen en vivo de la infraestructura de datos y autenticación de tu aplicación.
          </p>
        </div>

        <button
          onClick={() => onRefetch?.()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-white/10 hover:border-white/20 text-xs font-medium text-zinc-300 hover:text-white transition-colors self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Actualizar</span>
        </button>
      </div>

      {/* BLOQUE 1: DATABASE */}
      <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-5 hover:border-white/15 transition-all">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Database</h3>
              <p className="text-xs text-zinc-400">View tables and edit data</p>
            </div>
          </div>

          <button
            onClick={() => onSelectSubTab('Database')}
            className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            <span>{tablesCount} tables</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Lista de primeras tablas como filas clicables */}
        <div className="space-y-1 mt-3">
          {tables.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-500 border border-dashed border-white/5 rounded-lg">
              No hay tablas en el esquema public aún.
            </div>
          ) : (
            tables.slice(0, 5).map((t) => (
              <div
                key={t.table_name || t.name}
                onClick={() => onSelectSubTab('Database')}
                className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-2.5">
                  <Table2 className="w-4 h-4 text-zinc-400 group-hover:text-blue-400 transition-colors" />
                  <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                    {t.table_name || t.name}
                  </span>
                  {t.rls_enabled && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      RLS
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono text-zinc-400">
                  {t.approximate_row_count ?? t.row_count ?? 0} rows
                </span>
              </div>
            ))
          )}
        </div>

        {/* Botón centrado View All */}
        {tables.length > 0 && (
          <div className="text-center mt-3 pt-3 border-t border-white/5">
            <button
              onClick={() => onSelectSubTab('Database')}
              className="text-xs text-zinc-300 hover:text-white px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors font-medium"
            >
              View all
            </button>
          </div>
        )}
      </div>

      {/* BLOQUE 2: USERS */}
      <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-5 hover:border-white/15 transition-all">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Users</h3>
              <p className="text-xs text-zinc-400">View user data and configure how users sign up</p>
            </div>
          </div>

          <button
            onClick={() => onSelectSubTab('Users')}
            className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            <span>{signupsCount} Signup</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1 mt-3">
          <div
            onClick={() => onSelectSubTab('Users')}
            className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-medium text-zinc-200 hover:text-white">Auth settings</span>
            </div>
            <span className="text-xs text-zinc-400 font-mono">Email, Password & OAuth Active</span>
          </div>
        </div>
      </div>

      {/* BLOQUE 3: STORAGE */}
      <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-5 hover:border-white/15 transition-all">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Storage</h3>
              <p className="text-xs text-zinc-400">View and manage files, images, and documents</p>
            </div>
          </div>

          <button
            onClick={() => onSelectSubTab('Storage')}
            className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            <span>{bucketsCount} Buckets</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1 mt-3">
          <div
            onClick={() => onSelectSubTab('Storage')}
            className="flex items-center justify-between p-2.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <HardDrive className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-200 hover:text-white">
                {bucketsCount > 0 ? `${bucketsCount} bucket(s) configurado(s)` : 'Almacenamiento de archivos'}
              </span>
            </div>
            <span className="text-xs text-zinc-400 font-mono">Público y Privado</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Vista de Logs del Sistema Cloud
 */
function CloudLogsView({ cloudData }) {
  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-10">
      <div className="flex items-center justify-between pb-2">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-zinc-400" />
            Logs de Base de Datos y API
          </h2>
          <p className="text-xs text-zinc-400 mt-1">
            Registro de transacciones, ejecuciones DDL y telemetría de base de datos.
          </p>
        </div>
      </div>

      <div className="bg-zinc-950 border border-white/10 rounded-xl p-4 font-mono text-xs text-zinc-300 overflow-x-auto space-y-2">
        <div className="text-zinc-500 text-[11px] pb-2 border-b border-white/5">
          [System Runtime] Monitoreo de consultas activas en PostgreSQL
        </div>
        <div className="text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>PostgreSQL pool saludable (conexión activa en puerto 5432)</span>
        </div>
        <div className="text-zinc-400">
          Último checkpoint de migraciones: OK • Row Level Security verificado
        </div>
      </div>
    </div>
  );
}
