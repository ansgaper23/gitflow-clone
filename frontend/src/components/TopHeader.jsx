import React, { useState } from 'react';
import ModeSelector from './ModeSelector';
import {
  Menu,
  ChevronDown,
  History,
  PanelLeft,
  Globe,
  FileText,
  Code2,
  Layers,
  Monitor,
  Smartphone,
  RotateCw,
  ExternalLink,
  Zap,
  PanelLeftClose
} from 'lucide-react';

export const TopHeader = ({
  projectName = "Secure Checkout Tester",
  activeView = "preview", // 'preview' | 'docs' | 'code' | 'db'
  onViewChange,
  currentRoute = "/",
  routes = [
    { label: "Página de inicio", path: "/" },
    { label: "Dashboard", path: "/dashboard" },
    { label: "Nueva Cotización", path: "/nueva-cotizacion" },
    { label: "Clientes", path: "/clientes" },
    { label: "Mi Empresa", path: "/mi-empresa" }
  ],
  onNavigateRoute,
  onReloadPreview,
  previewUrl,
  onPublish,
  chatHidden,
  setChatHidden,
  setShowHistory
}) => {
  const [deviceMode, setDeviceMode] = useState('desktop'); // 'desktop' | 'mobile'
  const [isRouteOpen, setIsRouteOpen] = useState(false);

  const currentRouteLabel = routes.find(r => r.path === currentRoute)?.label || currentRoute;

  return (
    <header className="h-12 w-full bg-[#0f0f11] border-b border-white/[0.08] px-3 flex items-center justify-between select-none z-40 text-zinc-300">
      
      {/* ── 1. ZONA IZQUIERDA: Contexto de Proyecto y Paneles ── */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button 
          className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          title="Menú principal"
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Nombre del Proyecto con Dropdown */}
        <button 
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/5 text-[13px] font-semibold text-zinc-100 transition-colors max-w-[190px]"
          title={projectName}
        >
          <span className="truncate">{projectName}</span>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        </button>

        {/* Botón Historial de Versiones */}
        <button 
          onClick={() => setShowHistory?.(true)}
          className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          title="Historial de versiones"
        >
          <History className="w-3.5 h-3.5" />
        </button>

        {/* Toggle de Paneles */}
        <button 
          onClick={() => setChatHidden?.(!chatHidden)}
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${chatHidden ? 'text-[#4F88FF] bg-[#4F88FF]/10 hover:bg-[#4F88FF]/20' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
          title={chatHidden ? "Mostrar panel izquierdo" : "Ocultar panel izquierdo"}
        >
          <PanelLeftClose className={`w-3.5 h-3.5 transition-transform ${chatHidden ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* ── 2. ZONA CENTRAL: Segmented Control de Vistas (Estilo Lovable) ── */}
      <div className="flex items-center gap-3">
        {/* Cápsula de Modos de Vista */}
        <div className="h-8 p-0.5 rounded-full bg-[#18181b] border border-white/10 flex items-center">
          {/* Tab Vista Previa */}
          <button
            onClick={() => onViewChange?.('preview')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              activeView === 'preview'
                ? 'bg-[#2563eb] text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Vista previa</span>
          </button>

          {/* Separador fino */}
          <div className="w-[1px] h-3.5 bg-white/10 mx-0.5" />

          {/* Tab Documentos */}
          <button
            onClick={() => onViewChange?.('docs')}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              activeView === 'docs' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title="Documentación"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>

          {/* Tab Código */}
          <button
            onClick={() => onViewChange?.('code')}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              activeView === 'code' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title="Editor de código"
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>

          {/* Tab Base de Datos */}
          <button
            onClick={() => onViewChange?.('db')}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
              activeView === 'db' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title="Base de datos y capas"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Controles del Preview (Solo visibles cuando la vista es Preview) */}
        {activeView === 'preview' && (
          <div className="flex items-center gap-1.5">
            {/* Alternar Dispositivo (Desktop / Mobile) */}
            <button
              onClick={() => setDeviceMode(deviceMode === 'desktop' ? 'mobile' : 'desktop')}
              className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              title={deviceMode === 'desktop' ? 'Cambiar a vista móvil' : 'Cambiar a escritorio'}
            >
              {deviceMode === 'desktop' ? (
                <Monitor className="w-3.5 h-3.5" />
              ) : (
                <Smartphone className="w-3.5 h-3.5 text-blue-400" />
              )}
            </button>

            {/* Botón Refrescar Preview */}
            <button
              onClick={onReloadPreview}
              className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              title="Refrescar vista previa"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            {/* ── CAJITA DE RUTAS (Page Switcher) ── */}
            <div className="relative">
              <button
                onClick={() => setIsRouteOpen(!isRouteOpen)}
                className="h-7 px-2.5 rounded-lg bg-[#18181b] border border-white/10 hover:border-white/20 text-xs font-medium text-zinc-200 flex items-center gap-2 transition-colors min-w-[130px] justify-between"
              >
                <span className="truncate">{currentRouteLabel}</span>
                <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
              </button>

              {/* Menú de selección de pantalla */}
              {isRouteOpen && (
                <div className="absolute top-full left-0 mt-1 w-44 py-1 rounded-xl bg-[#1c1c1f] border border-white/10 shadow-2xl z-50 text-xs">
                  {routes.map((r) => (
                    <button
                      key={r.path}
                      onClick={() => {
                        onNavigateRoute?.(r.path);
                        setIsRouteOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 hover:bg-white/5 flex items-center justify-between transition-colors ${
                        currentRoute === r.path ? 'text-blue-400 font-semibold' : 'text-zinc-300'
                      }`}
                    >
                      <span className="truncate">{r.label}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">{r.path}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Abrir en pestaña externa */}
            <a
              href={previewUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
              title="Abrir en pestaña nueva"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}
      </div>

      {/* ── 3. ZONA DERECHA: Acciones Globales ── */}
      
      {mode && setMode && (
        <div className="hidden md:flex mr-4">
          <ModeSelector currentMode={mode} onSelectMode={setMode} />
        </div>
      )}
      <div className="flex items-center gap-2 shrink-0">
        {/* Botón Mejorar Plan */}
        <button className="h-7 px-3 rounded-full bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 hover:border-purple-500/50 text-purple-300 text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm">
          <Zap className="w-3 h-3 fill-current text-purple-400" />
          <span>Mejorar plan</span>
        </button>

        {/* Botón Publicar */}
        <button
          onClick={onPublish}
          className="h-7 px-3.5 rounded-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold shadow-sm transition-all active:scale-95"
        >
          Publicar
        </button>
      </div>

    </header>
  );
};
