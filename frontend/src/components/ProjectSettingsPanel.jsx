import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Pencil, Check, Loader2, Image as ImageIcon, Globe, AlertCircle, Trash2, BarChart3, Rocket, BookOpen, Brain } from 'lucide-react'
import { api } from '../lib/api.js'

// Debounce del chequeo de disponibilidad mientras el usuario escribe el nuevo subdominio,
// para no pegarle a la API en cada tecla.
const CHECK_DEBOUNCE_MS = 400

function ImageUploadRow({ label, hint, value, onUpload, uploading, error }) {
  const inputRef = useRef(null)
  return (
    <div>
      <p className="text-xs font-medium text-text/90">{label}</p>
      <p className="mt-0.5 text-[11px] text-muted">{hint}</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background/40">
          {value ? (
            <img src={value} alt={label} className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5 text-muted" />
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted hover:bg-white/5 hover:text-text disabled:opacity-50"
        >
          {uploading ? <Loader2 className="size-3 animate-spin" /> : <ImageIcon className="size-3" />}
          {uploading ? 'Subiendoâ€¦' : value ? 'Cambiar' : 'Subir imagen'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/x-icon,image/svg+xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) onUpload(file)
          }}
        />
      </div>
      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}
    </div>
  )
}

function AnalyticsSection({ projectId }) {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .projectAnalytics(projectId, 14)
      .then(setSummary)
      .catch((err) => setError(err.message))
  }, [projectId])

  const maxPageviews = Math.max(1, ...(summary?.daily || []).map((d) => d.pageviews))

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
        <BarChart3 className="size-3.5 text-primary" /> Analíticas
      </p>
      <p className="mt-0.5 text-[11px] text-muted">Visitas a tu sitio publicado en los últimos 14 días.</p>

      {summary === null && !error && <p className="mt-2 text-[11px] text-muted">Cargandoâ€¦</p>}
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

      {summary && (
        <>
          <div className="mt-3 flex gap-4">
            <div>
              <p className="text-lg font-semibold text-text">{summary.totalPageviews}</p>
              <p className="text-[11px] text-muted">Visitas</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-text">{summary.totalUniqueVisitors}</p>
              <p className="text-[11px] text-muted">Visitantes únicos</p>
            </div>
          </div>

          {summary.daily.length > 0 ? (
            <div className="mt-3 flex h-16 items-end gap-1">
              {summary.daily.map((d) => (
                <div
                  key={d.date}
                  title={`${d.date}: ${d.pageviews} visita${d.pageviews === 1 ? '' : 's'}`}
                  className="flex-1 rounded-t bg-primary/60 transition-all hover:bg-primary"
                  style={{ height: `${Math.max(6, (d.pageviews / maxPageviews) * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-muted">Todavía no hay visitas registradas.</p>
          )}

          {summary.topPaths.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-[11px] text-muted">Páginas más visitadas</p>
              {summary.topPaths.slice(0, 5).map((p) => (
                <div key={p.path} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1 text-[11px]">
                  <span className="truncate font-mono text-text/90">{p.path}</span>
                  <span className="shrink-0 text-muted">{p.count}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Hace mucho tiempo/minutos/horas/días — nada de librería nueva para esto.
function KnowledgeSection({ project, onProjectUpdated }) {
  const [text, setText] = useState(project?.knowledge || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const dirty = text !== (project?.knowledge || '')

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await api.updateProjectKnowledge(project.id, text)
      onProjectUpdated?.({ knowledge: updated.knowledge })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
        <BookOpen className="size-3.5 text-primary" /> Conocimiento del proyecto
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Contexto fijo que la IA lee siempre (a qué se dedica el negocio, tono, reglas) — asÃ­ no hace falta que se lo
        repitas en cada mensaje.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Ej: Somos una clínica veterinaria en Lima. El tono del sitio es cálido y cercano. Los precios siempre van en soles (S/)."
        className="mt-2 w-full resize-y rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs outline-none focus:border-primary/50"
      />

      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}

      <button
        onClick={save}
        disabled={!dirty || saving}
        className="press mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/80 hover:bg-white/5 disabled:opacity-40"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        {saved ? 'Guardado' : 'Guardar'}
      </button>
    </div>
  )
}

// A diferencia de KnowledgeSection (lo escribe el dueño), esto lo va armando la propia IA con
// "update_memory" mientras trabaja — acá el dueño solo la ve y, si quiere, la corrige a mano.
function MemorySection({ project, onProjectUpdated }) {
  const [text, setText] = useState(project?.aiMemory || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const dirty = text !== (project?.aiMemory || '')

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await api.updateProjectAiMemory(project.id, text)
      onProjectUpdated?.({ aiMemory: updated.aiMemory })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
        <Brain className="size-3.5 text-primary" /> Memoria de la IA
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Lo que la IA fue anotando sola sobre este proyecto (arquitectura, convenciones, decisiones) para no
        redescubrirlo cada vez. Podés corregirla o vaciarla si ves algo desactualizado.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Todavía no anotó nada acá — se va a ir completando sola a medida que construya cosas en el proyecto."
        className="mt-2 w-full resize-y rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs outline-none focus:border-primary/50"
      />

      {error && <p className="mt-1.5 text-[11px] text-red-300">{error}</p>}

      <button
        onClick={save}
        disabled={!dirty || saving}
        className="press mt-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/80 hover:bg-white/5 disabled:opacity-40"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        {saved ? 'Guardado' : 'Guardar'}
      </button>
    </div>
  )
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `hace ${hr} h`
  const days = Math.floor(hr / 24)
  return `hace ${days} d`
}

function PublishSection({ project, host, onProjectUpdated }) {
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState(null)
  const [needsUpgrade, setNeedsUpgrade] = useState(false)

  const publish = async () => {
    setPublishing(true)
    setError(null)
    setNeedsUpgrade(false)
    try {
      const result = await api.publishProject(project.id)
      onProjectUpdated?.({ publishedAt: result.publishedAt })
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
      setNeedsUpgrade(err.code === 'plan_upgrade_required')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
        <Rocket className="size-3.5 text-primary" /> Publicar sitio
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Genera una versión estática real del proyecto y la deja guardada en el servidor — a diferencia de la vista previa
        del editor, no se apaga sola por inactividad. Es lo que ve cualquiera que entre a tu subdominio.
      </p>

      <p className="mt-2 text-[11px] text-muted">
        {project?.publishedAt ? (
          <>
            Publicado {timeAgo(project.publishedAt)} Â·{' '}
            <a
              href={`https://${project.slug}.${host}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Ver sitio publicado
            </a>
          </>
        ) : (
          'Todavía no publicaste este proyecto.'
        )}
      </p>

      {error && (
        <p className="mt-1.5 text-[11px] text-red-300">
          {error}{' '}
          {needsUpgrade && (
            <Link to="/account" className="underline">
              Ver planes
            </Link>
          )}
        </p>
      )}

      <button
        onClick={publish}
        disabled={publishing}
        className="press mt-2 flex items-center gap-1.5 rounded-md brand-gradient px-3 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-60"
      >
        {publishing ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
        {publishing ? 'Publicandoâ€¦ puede tardar un minuto' : project?.publishedAt ? 'Volver a publicar' : 'Publicar'}
      </button>
    </div>
  )
}

function DomainSection({ project, onProjectUpdated }) {
  const [domainInput, setDomainInput] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [checking, setChecking] = useState(false)

  const [agents, setAgents] = useState([])
  useEffect(() => {
    api.listAgents().then(res => setAgents(res.agents || [])).catch(console.error)
  }, [])

  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState(null)
  const [needsUpgrade, setNeedsUpgrade] = useState(false)
  const [nameservers, setNameservers] = useState(null)
  const [certReady, setCertReady] = useState(Boolean(project?.customDomainVerifiedAt))

  const connect = async (e) => {
    e.preventDefault()
    const domain = domainInput.trim().toLowerCase()
    if (!domain || connecting) return
    setConnecting(true)
    setError(null)
    setNeedsUpgrade(false)
    try {
      const result = await api.connectDomain(project.id, domain)
      setNameservers(result.nameservers)
      setDomainInput('')
      onProjectUpdated?.({ customDomain: domain, customDomainVerifiedAt: null })
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
      setNeedsUpgrade(err.code === 'plan_upgrade_required')
    } finally {
      setConnecting(false)
    }
  }

  const checkStatus = async () => {
    setChecking(true)
    setError(null)
    try {
      const result = await api.domainStatus(project.id)
      setNameservers(result.nameservers)
      setCertReady(result.certReady)
      onProjectUpdated?.({ customDomainVerifiedAt: result.verified ? new Date().toISOString() : null })
      if (!result.verified) setError('Todavía no detecto el cambio de nameservers. Puede tardar unas horas en propagar — probá de nuevo más tarde.')
      else if (!result.certReady) setError('Dominio verificado — emitiendo el certificado HTTPS, puede tardar un momento. ProbÃ¡ "Verificar ahora" de nuevo en unos segundos.')
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setChecking(false)
    }
  }

  const remove = async () => {
    setRemoving(true)
    setError(null)
    try {
      await api.disconnectDomain(project.id)
      setNameservers(null)
      onProjectUpdated?.({ customDomain: null, customDomainVerifiedAt: null })
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setRemoving(false)
    }
  }

  const isVerified = Boolean(project?.customDomainVerifiedAt)
  const isReady = isVerified && certReady

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
        <Globe className="size-3.5 text-primary" /> Dominio propio
      </p>

      {!project?.customDomain ? (
        <>
          <p className="mt-0.5 text-[11px] text-muted">
            Conectá tu propio dominio (ej. midominio.com) apuntando sus nameservers a los de FlowPro.
          </p>
          <form onSubmit={connect} className="mt-2 flex items-center gap-1.5">
            <input
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="midominio.com"
              className="min-w-0 flex-1 rounded-md border border-border bg-background/40 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary/50"
            />
            <button
              type="submit"
              disabled={!domainInput.trim() || connecting}
              className="press flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-slate-950 disabled:opacity-40"
            >
              {connecting ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            </button>
          </form>
          {error && (
            <p className="mt-1.5 text-[11px] text-red-300">
              {error}{' '}
              {needsUpgrade && (
                <Link to="/account" className="underline">
                  Ver planes
                </Link>
              )}
            </p>
          )}
        </>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
            <span className="truncate font-mono text-xs text-text/90">{project.customDomain}</span>
            {isReady ? (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-400">
                <Check className="size-3" /> Conectado
              </span>
            ) : isVerified ? (
              <span className="shrink-0 text-[11px] text-amber-300">Emitiendo HTTPSâ€¦</span>
            ) : (
              <span className="shrink-0 text-[11px] text-amber-300">Pendiente</span>
            )}
          </div>

          {!isVerified && (
            <div className="rounded-md border border-border bg-background/40 p-2.5">
              <p className="text-[11px] text-muted">
                En donde compraste el dominio, cambiá los nameservers a estos dos:
              </p>
              <div className="mt-1.5 space-y-1 font-mono text-[11px] text-text/90">
                {(nameservers || ['ns1.flow-pro.online', 'ns2.flow-pro.online']).map((ns) => (
                  <div key={ns} className="rounded bg-white/5 px-2 py-1">{ns}</div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">Puede tardar hasta unas horas en propagar.</p>
            </div>
          )}

          {error && <p className="text-[11px] text-red-300">{error}</p>}

          <div className="flex items-center gap-1.5">
            {!isReady && (
              <button
                onClick={checkStatus}
                disabled={checking}
                className="press flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-white/5 hover:text-text disabled:opacity-50"
              >
                {checking ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Verificar ahora
              </button>
            )}
            {isReady && (
              <a
                href={`https://${project.customDomain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-white/5 hover:text-text"
              >
                Ver sitio
              </a>
            )}
            <button
              onClick={remove}
              disabled={removing}
              title="Quitar dominio"
              className="press flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
            >
              {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProjectSettingsPanel({ project, onClose, onProjectUpdated }) {
  const [editingSlug, setEditingSlug] = useState(false)
  const [slugInput, setSlugInput] = useState(project?.slug || '')
  const [checkState, setCheckState] = useState(null) // { available, slug, host } | null
  const [checking, setChecking] = useState(false)

  const [agents, setAgents] = useState([])
  useEffect(() => {
    api.listAgents().then(res => setAgents(res.agents || [])).catch(console.error)
  }, [])

  const [savingSlug, setSavingSlug] = useState(false)
  const [slugError, setSlugError] = useState(null)

  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState(null)
  const [socialUploading, setSocialUploading] = useState(false)
  const [socialError, setSocialError] = useState(null)

  const host = checkState?.host || 'flow-pro.online'

  useEffect(() => {
    if (!editingSlug) return
    const trimmed = slugInput.trim()
    if (!trimmed || trimmed === project?.slug) {
      setCheckState(null)
      setChecking(false)
      return
    }
    setChecking(true)
    const handle = setTimeout(() => {
      api
        .checkSlugAvailable(trimmed, project.id)
        .then((res) => setCheckState(res))
        .catch(() => setCheckState(null))
        .finally(() => setChecking(false))
    }, CHECK_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [slugInput, editingSlug, project?.id, project?.slug])

  const startEditing = () => {
    setSlugInput(project?.slug || '')
    setSlugError(null)
    setCheckState(null)
    setEditingSlug(true)
  }

  const cancelEditing = () => {
    setEditingSlug(false)
    setSlugInput(project?.slug || '')
    setSlugError(null)
    setCheckState(null)
  }

  const saveSlug = async () => {
    const trimmed = slugInput.trim()
    if (!trimmed || savingSlug) return
    if (trimmed === project?.slug) {
      setEditingSlug(false)
      return
    }
    setSavingSlug(true)
    setSlugError(null)
    try {
      const updated = await api.updateProjectSlug(project.id, trimmed)
      onProjectUpdated?.(updated)
      setEditingSlug(false)
      setCheckState(null)
    } catch (err) {
      setSlugError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSavingSlug(false)
    }
  }

  const canSave =
    editingSlug &&
    slugInput.trim() &&
    slugInput.trim() !== project?.slug &&
    !checking &&
    (checkState ? checkState.available : false)

  const uploadLogo = async (file) => {
    setLogoUploading(true)
    setLogoError(null)
    try {
      const updated = await api.uploadProjectLogo(project.id, file)
      onProjectUpdated?.(updated)
    } catch (err) {
      setLogoError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setLogoUploading(false)
    }
  }

  const uploadSocialImage = async (file) => {
    setSocialUploading(true)
    setSocialError(null)
    try {
      const updated = await api.uploadProjectSocialImage(project.id, file)
      onProjectUpdated?.(updated)
    } catch (err) {
      setSocialError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSocialUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end p-0">
      <div className="animate-overlay-in absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-panel-in relative z-10 flex h-full w-full max-w-sm flex-col bg-bg shadow-2xl overflow-hidden md:rounded-2xl border-0 md:border md:border-white/10">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Publicar</h2>
          <button
            onClick={onClose}
            className="press flex size-7 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
              <Globe className="size-3.5 text-primary" /> Website URL
            </p>

            {!editingSlug ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
                <span className="truncate font-mono text-xs text-text/90">
                  {project?.slug}.{host}
                </span>
                <button
                  onClick={startEditing}
                  title="Editar subdominio"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-text"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            ) : (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-background/40 focus-within:border-primary/50">
                    <input
                      autoFocus
                      value={slugInput}
                      onChange={(e) => setSlugInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canSave) saveSlug()
                        if (e.key === 'Escape') cancelEditing()
                      }}
                      className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-xs text-text outline-none"
                      placeholder="mi-proyecto"
                    />
                    <span className="shrink-0 pr-3 font-mono text-xs text-muted">.{host}</span>
                  </div>
                  <button
                    onClick={saveSlug}
                    disabled={!canSave || savingSlug}
                    title="Guardar"
                    className="press flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-slate-950 disabled:opacity-40"
                  >
                    {savingSlug ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  </button>
                  <button
                    onClick={cancelEditing}
                    disabled={savingSlug}
                    title="Cancelar"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted hover:bg-white/5"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                {slugInput.trim() && slugInput.trim() !== project?.slug && (
                  <p className={`flex items-center gap-1 text-[11px] ${checking ? 'text-muted' : checkState?.available ? 'text-emerald-400' : 'text-red-300'}`}>
                    {checking ? (
                      <>
                        <Loader2 className="size-3 animate-spin" /> Verificando disponibilidadâ€¦
                      </>
                    ) : checkState?.available ? (
                      <>
                        <Check className="size-3" /> Disponible
                      </>
                    ) : checkState ? (
                      <>
                        <AlertCircle className="size-3" /> {checkState.reason || 'Ese subdominio ya está en uso'}
                      </>
                    ) : null}
                  </p>
                )}
              </div>
            )}
            {slugError && <p className="mt-1.5 text-[11px] text-red-300">{slugError}</p>}
          </div>

          <div className="h-px bg-border" />

          

          <div className="h-px bg-border" />

          {project?.id && <MemorySection project={project} onProjectUpdated={onProjectUpdated} />}

          <div className="h-px bg-border" />

          {project?.id && <PublishSection project={project} host={host} onProjectUpdated={onProjectUpdated} />}

          <div className="h-px bg-border" />

          {project?.id && <DomainSection project={project} onProjectUpdated={onProjectUpdated} />}

          <div className="h-px bg-border" />

          <ImageUploadRow
            label="Logo / favicon"
            hint="Ícono que se muestra en la pestaña del navegador."
            value={project?.logoUrl}
            onUpload={uploadLogo}
            uploading={logoUploading}
            error={logoError}
          />

          <ImageUploadRow
            label="Imagen social"
            hint="Cómo se ve el link al compartirlo (WhatsApp, X, etc). No afecta el código del proyecto."
            value={project?.socialImageUrl}
            onUpload={uploadSocialImage}
            uploading={socialUploading}
            error={socialError}
          />

          <div className="h-px bg-border" />

          {project?.id && <AnalyticsSection projectId={project.id} />}
        </div>
      </div>
    </div>
  )
}

