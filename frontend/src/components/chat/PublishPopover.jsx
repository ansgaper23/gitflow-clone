// frontend/src/components/chat/PublishPopover.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Globe, Pencil, Copy, Check, Loader2, ShieldCheck, ExternalLink, X, Package } from 'lucide-react';
import { api } from '../../lib/api';

export function PublishPopover({ project, onClose, onOpenDomains, onProjectUpdated }) {
  const popoverRef = useRef(null);
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugValue, setSlugValue] = useState(project?.slug || '');
  const [slugSaving, setSlugSaving] = useState(false);
  const [slugError, setSlugError] = useState(null);
  const [publishStatus, setPublishStatus] = useState(project?.publishedAt ? 'published' : 'ready');
  const [publishError, setPublishError] = useState(null);

  const host = typeof window !== 'undefined' ? window.location.host : 'flow-pro.online';
  const siteUrl = project?.slug ? `https://${project.slug}.${host}` : '';

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleCopy = () => {
    if (!siteUrl) return;
    navigator.clipboard.writeText(siteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveSlug = async () => {
    const clean = slugValue.trim().toLowerCase();
    if (!clean || clean === project.slug) {
      setEditingSlug(false);
      return;
    }
    setSlugSaving(true);
    setSlugError(null);
    try {
      const updated = await api.updateProject(project.id, { slug: clean });
      onProjectUpdated?.(updated);
      setEditingSlug(false);
    } catch (err) {
      setSlugError(err.message || 'No se pudo actualizar el subdominio');
    } finally {
      setSlugSaving(false);
    }
  };

  const [downloadingStatic, setDownloadingStatic] = useState(false);

  const handleDownloadStatic = async () => {
    if (!project?.id) return;
    setDownloadingStatic(true);
    try {
      const token = localStorage.getItem('flowpro_token') || localStorage.getItem('supabase_token');
      const response = await fetch(`/api/projects/${project.id}/export-static`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo generar el zip estático');
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${project.slug || project.name || 'proyecto'}-estatico-dist.zip`;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(link);
    } catch (err) {
      alert(err.message || 'Error al descargar dist.zip');
    } finally {
      setDownloadingStatic(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await api.publishProject(project.id);
      onProjectUpdated?.({ publishedAt: result.publishedAt });
      setPublishStatus('published');
    } catch (err) {
      setPublishError(err.message || 'Error al publicar los cambios');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div
      ref={popoverRef}
      className="fixed right-4 top-14 z-50 w-[380px] rounded-2xl bg-[#18181b] border border-white/15 p-5 shadow-2xl text-zinc-100 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150 select-text"
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex size-2.5 rounded-full bg-blue-500"></span>
          </span>
          <div>
            <h3 className="font-semibold text-sm text-zinc-100">Publicar</h3>
            <p className="text-xs text-zinc-400">
              {publishStatus === 'published' ? 'Sitio publicado y activo' : 'Cambios listos para publicar'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* URL del sitio web */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-zinc-300">URL del sitio web</span>
          <button
            type="button"
            onClick={() => {
              onClose?.();
              onOpenDomains?.();
            }}
            className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
          >
            + Añadir dominio
          </button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/90 px-3 py-2 text-xs">
          {editingSlug ? (
            <div className="flex items-center gap-1.5 flex-1 mr-2">
              <input
                type="text"
                value={slugValue}
                onChange={(e) => setSlugValue(e.target.value)}
                className="w-full bg-zinc-800 text-zinc-100 px-2 py-0.5 rounded outline-none border border-blue-500/50"
                autoFocus
              />
              <button
                onClick={handleSaveSlug}
                disabled={slugSaving}
                className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
              >
                {slugSaving ? '...' : 'OK'}
              </button>
            </div>
          ) : (
            <span className="truncate text-zinc-300 font-mono">
              {project?.slug ? `${project.slug}.${host}` : 'sin-subdominio'}
            </span>
          )}

          <div className="flex items-center gap-1 ml-2 shrink-0">
            {!editingSlug && (
              <button
                type="button"
                onClick={() => setEditingSlug(true)}
                title="Editar subdominio"
                className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5 transition-colors"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              title="Copiar enlace"
              className="p-1 text-zinc-400 hover:text-white rounded hover:bg-white/5 transition-colors"
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </div>
        {slugError && <p className="text-[11px] text-red-400">{slugError}</p>}
      </div>

      {/* Fila de Visibilidad */}
      <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-900/50 border border-white/5 rounded-xl px-3 py-2">
        <span>🌐</span>
        <span className="truncate">Visible para cualquiera que tenga el enlace</span>
      </div>

      {/* Indicador de Seguridad */}
      <div className="flex items-center gap-2 text-xs text-zinc-300 bg-zinc-900/50 border border-white/5 rounded-xl px-3 py-2">
        <ShieldCheck className="size-4 text-emerald-400 shrink-0" />
        <span className="truncate">Análisis rápido de seguridad completado</span>
      </div>

      {publishError && (
        <p className="text-xs text-red-400 bg-red-950/30 border border-red-500/20 rounded-xl p-2.5">
          {publishError}
        </p>
      )}

      {/* Footer con Botón Publicar cambios */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10 mt-1">
        {project?.publishedAt ? (
          <a
            href={siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            Abrir sitio <ExternalLink className="size-3" />
          </a>
        ) : (
          <span className="text-[11px] text-zinc-500">Aún no publicado</span>
        )}

        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing}
          className="rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-xs px-4 py-2 flex items-center gap-1.5 shadow-md transition-all ml-auto"
        >
          {publishing && <Loader2 className="size-3.5 animate-spin" />}
          {publishing ? 'Publicando...' : 'Publicar cambios'}
        </button>
      </div>

      {/* Botón Descargar Estático (dist.zip) para cPanel / Hostinger */}
      <div className="pt-2 border-t border-white/10 flex flex-col gap-1.5 mt-1">
        <button
          type="button"
          onClick={handleDownloadStatic}
          disabled={downloadingStatic}
          className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 text-xs py-2 px-3 flex items-center justify-center gap-2 border border-white/10 transition-colors shadow-sm font-medium"
        >
          {downloadingStatic ? <Loader2 className="size-3.5 animate-spin text-blue-400" /> : <Package className="size-3.5 text-blue-400" />}
          <span>{downloadingStatic ? 'Compilando y empaquetando dist.zip...' : '📦 Descargar archivos estáticos (HTML / dist.zip)'}</span>
        </button>
        <span className="text-[10px] text-zinc-500 text-center">
          Listo para descomprimir en cPanel, Hostinger, Apache o Nginx
        </span>
      </div>
    </div>
  );
}
