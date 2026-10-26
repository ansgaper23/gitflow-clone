import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Plus, Trash2, Zap, ArrowUp, ArrowDown, CheckCircle2, XCircle, Pencil, Check, X, BarChart3, ArrowDownToLine, ArrowUpFromLine, AlertCircle, DollarSign, Link2, Copy, Loader2 } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import {
  SectionHeader,
  PROVIDER_DEFAULTS,
  emptyForm,
  SCOPE_LABEL,
  SCOPE_ORDER,
  isBridgeProvider,
  supportsCustomBaseUrl,
} from '../../components/admin/AdminShared.jsx'

// Alta guiada de una cuenta de Antigravity: "agy" no tiene un comando de login — cuando corre
// sin credenciales imprime sola una URL de Google y espera el código en su stdin. El backend
// envuelve ese proceso (queda vivo entre las 2 llamadas: arrancar y completar) — ver
// routes/admin.js y antigravity-bridge/lib/accountLogins.js para el detalle completo.
function AntigravityLoginModal({ onClose, onCreated }) {
  const [accountId, setAccountId] = useState(null)
  const [authUrl, setAuthUrl] = useState(null)
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [starting, setStarting] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const start = async () => {
    setStarting(true)
    setError(null)
    setAuthUrl(null)
    setAccountId(null)
    try {
      const data = await api.startAntigravityLogin()
      setAccountId(data.accountId)
      setAuthUrl(data.authUrl)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => {
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copyUrl = () => {
    navigator.clipboard.writeText(authUrl).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const complete = async (e) => {
    e.preventDefault()
    if (!code.trim() || completing) return
    setCompleting(true)
    setError(null)
    try {
      const account = await api.completeAntigravityLogin(accountId, code.trim(), { label: label.trim() })
      onCreated(account)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setCompleting(false)
    }
  }

  const close = () => {
    if (accountId) api.cancelAntigravityLogin(accountId).catch(() => {})
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-background p-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4 text-primary" /> Agregar cuenta de Antigravity
          </h3>
          <button onClick={close} className="text-muted hover:text-text">
            <X className="size-4" />
          </button>
        </div>

        {starting && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Generando el link de acceso…
          </p>
        )}

        {!starting && authUrl && (
          <form onSubmit={complete}>
            <p className="mt-4 text-xs text-muted">
              1. Abrí este link en tu navegador y autorizá con la cuenta de Google que querés usar (tenés ~60 segundos
              desde que se generó):
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <a href={authUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-xs text-primary hover:underline">
                {authUrl}
              </a>
              <button type="button" onClick={copyUrl} className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>

            <label className="mt-4 block text-xs text-muted">2. Pegá acá el código que te dio esa página</label>
            <input
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Código de autorización"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />

            <label className="mt-3 block text-xs text-muted">Etiqueta (opcional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ej. Antigravity cuenta 2"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />

            {error && (
              <div className="mt-3">
                <p className="text-xs text-red-300">{error}</p>
                <button type="button" onClick={start} className="mt-1 text-xs text-primary hover:underline">
                  Generar un link nuevo
                </button>
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="submit"
                disabled={completing || !code.trim()}
                className="press flex items-center gap-1.5 rounded-md brand-gradient px-3 py-2 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {completing ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {completing ? 'Activando…' : 'Activar'}
              </button>
              <button type="button" onClick={close} className="rounded-md border border-border px-3 py-2 text-xs hover:bg-white/5">
                Cancelar
              </button>
            </div>
          </form>
        )}

        {!starting && !authUrl && error && (
          <div className="mt-4">
            <p className="text-xs text-red-300">{error}</p>
            <button onClick={start} className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-white/5">
              Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminAI() {
  const { user: currentUser } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [testResults, setTestResults] = useState({})
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ label: '', model: '', apiKey: '', baseUrl: '', scope: 'agent' })
  const [editError, setEditError] = useState(null)
  const [showAntigravityLogin, setShowAntigravityLogin] = useState(false)

  const load = () => {
    setLoading(true)
    api
      .aiAccounts()
      .then(setAccounts)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (currentUser?.isAdmin) load()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.isAdmin])

  const onProviderChange = (provider) => {
    setForm((f) => ({ ...f, provider, model: PROVIDER_DEFAULTS[provider].model }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      await api.createAiAccount(form)
      setForm({ ...emptyForm, provider: form.provider, model: form.model, scope: form.scope })
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const toggleActive = async (acc) => {
    setBusyId(acc.id)
    try {
      const updated = await api.updateAiAccount(acc.id, { isActive: !acc.isActive })
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? updated : a)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const move = async (acc, delta) => {
    setBusyId(acc.id)
    try {
      const updated = await api.updateAiAccount(acc.id, { priority: acc.priority + delta })
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? updated : a)).sort((a, b) => a.priority - b.priority))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (acc) => {
    if (!confirm(`¿Eliminar la cuenta "${acc.label}"?`)) return
    setBusyId(acc.id)
    try {
      await api.deleteAiAccount(acc.id)
      setAccounts((prev) => prev.filter((a) => a.id !== acc.id))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const startEdit = (acc) => {
    setEditingId(acc.id)
    setEditForm({ label: acc.label, model: acc.model, apiKey: '', baseUrl: acc.baseUrl || '', scope: acc.scope })
    setEditError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError(null)
  }

  const saveEdit = async (acc) => {
    if (!editForm.label.trim() || !editForm.model.trim()) return
    setBusyId(acc.id)
    setEditError(null)
    try {
      const patch = { label: editForm.label.trim(), model: editForm.model.trim(), baseUrl: editForm.baseUrl.trim(), scope: editForm.scope }
      if (editForm.apiKey.trim()) patch.apiKey = editForm.apiKey.trim()
      const updated = await api.updateAiAccount(acc.id, patch)
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? updated : a)))
      setEditingId(null)
    } catch (err) {
      setEditError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const test = async (acc) => {
    setBusyId(acc.id)
    setTestResults((r) => ({ ...r, [acc.id]: null }))
    try {
      await api.testAiAccount(acc.id)
      setTestResults((r) => ({ ...r, [acc.id]: { ok: true } }))
    } catch (err) {
      setTestResults((r) => ({ ...r, [acc.id]: { ok: false, error: err.message } }))
    } finally {
      setBusyId(null)
      load()
    }
  }

  // Solo admin completo (mismo criterio que ya tenía esta sección cuando vivía apilada dentro
  // de la página única de /admin).
  if (!currentUser?.isAdmin) return <Navigate to="/admin/usuarios" replace />

  return (
    <section>
      <SectionHeader
        icon={Zap}
        title="Cuentas de IA"
        description={
          <>
            Gestiona las cuentas de IA (Claude, Gemini, DeepSeek…). Hay dos usos separados, cada uno con su propia
            rotación por prioridad: <strong className="text-text/90">Agente de código</strong> (el que construye los
            proyectos, acá mismo en el chat) e <strong className="text-text/90">IA dentro de apps</strong> (la que
            queda disponible para que las apps que construyen tus usuarios integren un chat/asistente propio).
          </>
        }
      />

      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <button
        onClick={() => setShowAntigravityLogin(true)}
        className="press mb-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10"
      >
        <Link2 className="size-4" /> Agregar cuenta de Antigravity (link + código)
      </button>

      {showAntigravityLogin && (
        <AntigravityLoginModal
          onClose={() => setShowAntigravityLogin(false)}
          onCreated={(account) => {
            setAccounts((prev) => [...prev, account])
            setShowAntigravityLogin(false)
          }}
        />
      )}

      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface/60 p-4 sm:grid-cols-2 sm:p-5">
        <div>
          <label className="text-xs text-muted">Proveedor</label>
          <select
            value={form.provider}
            onChange={(e) => onProviderChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini (gratis)</option>
            <option value="deepseek">DeepSeek</option>
            <option value="orcarouter">OrcaRouter (+200 modelos)</option>
            <option value="cloudflare">Cloudflare Workers AI (imágenes, gratis)</option>
            <option value="antigravity">Antigravity (bridge)</option>
            <option value="claudecode">Claude Code (bridge)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted">Etiqueta</label>
          <input
            required
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="ej. Claude cuenta 1"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted">API key</label>
          <input
            required
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
            placeholder={
              form.provider === 'gemini'
                ? 'AIza…'
                : form.provider === 'openai'
                  ? 'sk-proj-…'
                  : form.provider === 'deepseek'
                    ? 'sk-…'
                    : form.provider === 'orcarouter'
                      ? 'sk-orca-…'
                      : form.provider === 'cloudflare'
                        ? 'accountId:apiToken'
                        : isBridgeProvider(form.provider)
                          ? 'la API_KEY configurada en el bridge'
                          : 'sk-ant-…'
            }
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono outline-none focus:border-primary"
          />
          {supportsCustomBaseUrl(form.provider) && (
            <div className="mt-2">
              <label className="text-xs text-muted">
                Base URL {isBridgeProvider(form.provider) ? '(obligatoria)' : 'personalizada (opcional)'}
              </label>
              <input
                required={isBridgeProvider(form.provider)}
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                placeholder={
                  isBridgeProvider(form.provider)
                    ? 'http://127.0.0.1:3100 (o la URL del bridge)'
                    : form.provider === 'gemini'
                      ? 'https://generativelanguage.googleapis.com (dejar vacío para usar el default)'
                      : form.provider === 'openai'
                        ? 'https://api.openai.com/v1 (dejar vacío para usar el default)'
                        : 'https://api.anthropic.com (dejar vacío para usar el default)'
                }
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono outline-none focus:border-primary"
              />
              <p className="mt-1 text-[11px] text-muted">
                {isBridgeProvider(form.provider)
                  ? 'La URL donde corre antigravity-bridge (mismo bridge para Antigravity y Claude Code, distintos endpoints).'
                  : `Solo si usás un endpoint compatible con la API de ${form.provider === 'gemini' ? 'Gemini' : 'Anthropic'} distinto del oficial (ej. un gateway propio). Dejalo vacío para pegarle directo a ${form.provider === 'gemini' ? 'Google AI Studio' : 'Anthropic'}.`}
              </p>
            </div>
          )}
          {isBridgeProvider(form.provider) && (
            <p className="mt-1 text-[11px] text-muted">
              Solo propone cambios de <strong className="text-text/80">archivos de código</strong> — no crea tablas, no
              despliega funciones de servidor, no genera imágenes ni prueba la preview.
              {form.provider === 'antigravity' &&
                ' Además, a veces el modelo escribe directo en su copia de trabajo sin pasar por la cola de aprobación del bridge — nunca llega a FlowPro en ese caso, pero por eso conviene prioridad baja hasta tener más historial de uso.'}
            </p>
          )}
          {form.provider === 'cloudflare' && (
            <p className="mt-1 text-[11px] text-muted">
              Cloudflare usa dos credenciales, no una key sola — pegá acá{' '}
              <code className="font-mono text-primary">tuAccountId:tuApiToken</code> (separados por
              &quot;:&quot;). Sacás el Account ID del dashboard de Cloudflare y el token en{' '}
              <code className="font-mono text-primary">dash.cloudflare.com/profile/api-tokens</code> (plantilla
              &quot;Workers AI&quot;).
            </p>
          )}
        </div>
        <div>
          <label className="text-xs text-muted">Modelo</label>
          <input
            required
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm font-mono outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="text-xs text-muted">Prioridad (menor = primero)</label>
          <input
            type="number"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) }))}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs text-muted">Uso</label>
          <select
            value={form.scope}
            onChange={(e) => {
              const scope = e.target.value
              setForm((f) => ({
                ...f,
                scope,
                model:
                  scope === 'image' && f.provider === 'gemini'
                    ? 'gemini-2.5-flash-image'
                    : scope === 'image' && f.provider === 'cloudflare'
                      ? '@cf/black-forest-labs/flux-1-schnell'
                      : f.model,
              }))
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="agent">Agente de código (construye los proyectos)</option>
            <option value="app">IA dentro de apps (chat/asistente en las apps de tus usuarios)</option>
            <option value="image">Generación de imágenes (ilustraciones, íconos, portadas)</option>
          </select>
          {form.scope === 'image' && (
            <p className="mt-1 text-[11px] text-muted">
              Necesita un proveedor con salida de imagen. <strong className="text-text/80">Cloudflare Workers AI</strong>{' '}
              tiene cuota gratis real y diaria (recomendado). Gemini también sirve, pero su modelo de imagen ya no
              tiene capa gratis — necesita facturación habilitada en la cuenta de Google.
            </p>
          )}
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={creating}
            className="flex items-center justify-center gap-2 rounded-md brand-gradient px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60 sm:justify-start"
          >
            <Plus className="size-4" /> {creating ? 'Agregando…' : 'Agregar cuenta'}
          </button>
        </div>
      </form>

      <h3 className="mt-8 text-sm font-semibold text-text/90">Cuentas configuradas</h3>

      {loading && <p className="mt-4 text-sm text-muted">Cargando…</p>}
      {!loading && accounts.length === 0 && <p className="mt-4 text-sm text-muted">Aún no agregaste ninguna cuenta.</p>}

      {SCOPE_ORDER.map((scopeKey) => {
        const group = accounts.filter((acc) => acc.scope === scopeKey)
        return (
          <div key={scopeKey} className="mt-6">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{SCOPE_LABEL[scopeKey] || scopeKey}</h4>
            {group.length === 0 ? (
              <p className="mt-2 text-xs text-muted">Sin cuentas configuradas para este uso.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {group.map((acc) => (
                  <div key={acc.id} className="rounded-xl border border-border bg-surface/60 p-4">
                    {editingId === acc.id ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <label className="text-[11px] text-muted">Etiqueta</label>
                  <input
                    value={editForm.label}
                    onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted">Modelo</label>
                  <input
                    value={editForm.model}
                    onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-mono outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted">API key (dejar vacío para no cambiarla)</label>
                  <input
                    type="password"
                    value={editForm.apiKey}
                    onChange={(e) => setEditForm((f) => ({ ...f, apiKey: e.target.value }))}
                    placeholder={acc.apiKeyMasked}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-mono outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-muted">Uso</label>
                  <select
                    value={editForm.scope}
                    onChange={(e) => setEditForm((f) => ({ ...f, scope: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                  >
                    <option value="agent">Agente de código</option>
                    <option value="app">IA dentro de apps</option>
                    <option value="image">Generación de imágenes</option>
                  </select>
                </div>
                {supportsCustomBaseUrl(acc.provider) && (
                  <div className="sm:col-span-3">
                    <label className="text-[11px] text-muted">
                      Base URL{' '}
                      {isBridgeProvider(acc.provider)
                        ? '(la del bridge)'
                        : `personalizada (opcional, vacío = default de ${acc.provider === 'gemini' ? 'Google AI Studio' : 'Anthropic'})`}
                    </label>
                    <input
                      value={editForm.baseUrl}
                      onChange={(e) => setEditForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      placeholder={
                        isBridgeProvider(acc.provider)
                          ? 'http://127.0.0.1:3100'
                          : acc.provider === 'gemini'
                            ? 'https://generativelanguage.googleapis.com'
                            : acc.provider === 'openai'
                              ? 'https://api.openai.com/v1'
                              : 'https://api.anthropic.com'
                      }
                      className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-mono outline-none focus:border-primary"
                    />
                  </div>
                )}
                {editError && <p className="text-xs text-red-300 sm:col-span-3">{editError}</p>}
                <div className="flex items-center gap-1.5 sm:col-span-3">
                  <button
                    onClick={() => saveEdit(acc)}
                    disabled={busyId === acc.id || !editForm.label.trim() || !editForm.model.trim()}
                    className="press flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-slate-950 disabled:opacity-50"
                  >
                    <Check className="size-3.5" /> Guardar
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={busyId === acc.id}
                    className="press flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
                  >
                    <X className="size-3.5" /> Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                      {acc.provider}
                    </span>
                    <span className="rounded-full border border-primary/30 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {SCOPE_LABEL[acc.scope] || acc.scope}
                    </span>
                    <span className="font-semibold">{acc.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        acc.isActive ? 'bg-primary/15 text-primary' : 'bg-white/10 text-muted'
                      }`}
                    >
                      {acc.isActive ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted">
                    {acc.model} · key {acc.apiKeyMasked} · prioridad {acc.priority}
                    {acc.baseUrl ? ` · base ${acc.baseUrl}` : ''}
                    {acc.bridgeAccountId ? ' · cuenta propia (link)' : ''}
                  </p>
                  {acc.lastError && (
                    <p className="mt-1 text-xs text-red-300">
                      Último error ({new Date(acc.lastErrorAt).toLocaleString('es-ES')}): {acc.lastError}
                    </p>
                  )}
                  {testResults[acc.id]?.ok && <p className="mt-1 text-xs text-primary">Conexión OK ✓</p>}
                  {testResults[acc.id]?.ok === false && (
                    <p className="mt-1 text-xs text-red-300">Falló: {testResults[acc.id].error}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    title="Subir prioridad"
                    onClick={() => move(acc, -1)}
                    disabled={busyId === acc.id}
                    className="press rounded-md border border-border p-1.5 hover:bg-white/5 disabled:opacity-50"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    title="Bajar prioridad"
                    onClick={() => move(acc, 1)}
                    disabled={busyId === acc.id}
                    className="press rounded-md border border-border p-1.5 hover:bg-white/5 disabled:opacity-50"
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    title="Editar etiqueta, modelo o API key"
                    onClick={() => startEdit(acc)}
                    disabled={busyId === acc.id}
                    className="press flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
                  >
                    <Pencil className="size-3.5" /> Editar
                  </button>
                  <button
                    title="Probar conexión"
                    onClick={() => test(acc)}
                    disabled={busyId === acc.id}
                    className="press flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
                  >
                    <Zap className="size-3.5" /> Probar
                  </button>
                  <button
                    title={acc.isActive ? 'Desactivar' : 'Activar'}
                    onClick={() => toggleActive(acc)}
                    disabled={busyId === acc.id}
                    className="press flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
                  >
                    {acc.isActive ? <XCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                  </button>
                  <button
                    title="Eliminar"
                    onClick={() => remove(acc)}
                    disabled={busyId === acc.id}
                    className="press rounded-md border border-red-500/30 p-1.5 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <UsageLogsSection />
    </section>
  )
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
        <Icon className="size-3.5 text-primary" /> {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-text">{value}</p>
      <p className="text-[11px] text-muted">{sub}</p>
    </div>
  )
}

const STATUS_LABEL = { agent: 'Agente', app: 'App', image: 'Imagen' }

// Consumo TOTAL acumulado por cuenta de IA — tabla estática (una fila por cada cuenta que exista
// en /admin, ni una más ni una menos, aparezca o no haya usado nunca) en vez de una lista de
// llamadas individuales que crece sola. Cada fila suma de por vida, no una ventana de "últimas N".
function UsageLogsSection() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [clearing, setClearing] = useState(false)

  const load = () => {
    setError(null)
    api.aiUsageSummary().then(setSummary).catch((err) => setError(err.message))
  }

  useEffect(() => {
    load()
    // Solo lee la tabla de logs ya guardados (vía la función SQL), nunca llama a ningún
    // proveedor de IA — pollear cada 10s no gasta cuota de ninguna cuenta.
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
  }, [])

  const clearErrors = async () => {
    if (!window.confirm('¿Borrar el historial de llamadas fallidas? El contador de errores vuelve a 0 (no afecta requests/tokens exitosos).')) return
    setClearing(true)
    setError(null)
    try {
      await api.clearAiUsageErrors()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setClearing(false)
    }
  }

  const rows = summary?.accounts || []
  const totals = summary?.totals

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text/90">
          <BarChart3 className="size-4 text-primary" /> Logs de uso
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Se actualiza sola cada 10s</span>
          <button
            onClick={load}
            className="press rounded-md border border-border px-2 py-1 text-xs hover:bg-white/5"
          >
            Actualizar
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      {!summary && !error && <p className="mt-3 text-xs text-muted">Cargando…</p>}

      {totals && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Zap} label="Requisiciones" value={totals.requests.toLocaleString('es-ES')} sub="de por vida, todas las cuentas" />
          <StatCard icon={ArrowDownToLine} label="Tokens entrada" value={totals.inputTokens.toLocaleString('es-ES')} sub="suma total" />
          <StatCard icon={ArrowUpFromLine} label="Tokens salida" value={totals.outputTokens.toLocaleString('es-ES')} sub="suma total" />
          {totals.costUsd > 0 && (
            <StatCard icon={DollarSign} label="Costo (Antigravity/Claude Code)" value={`$${totals.costUsd.toFixed(4)}`} sub="suma total, no facturado — cuota de suscripción" />
          )}
        </div>
      )}
      {totals?.errors > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-xs text-red-300">
            <AlertCircle className="size-3.5" /> {totals.errors} llamadas fallaron en total.
          </p>
          <button
            onClick={clearErrors}
            disabled={clearing}
            className="press rounded-md border border-red-500/30 px-2 py-0.5 text-[11px] font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-60"
          >
            {clearing ? 'Borrando…' : 'Borrar fallos'}
          </button>
        </div>
      )}

      {rows.length === 0 && summary && <p className="mt-3 text-xs text-muted">Todavía no hay ninguna cuenta configurada.</p>}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="bg-white/5 text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Cuenta</th>
                <th className="px-3 py-2 font-semibold">Proveedor</th>
                <th className="px-3 py-2 font-semibold">Uso</th>
                <th className="px-3 py-2 text-right font-semibold">Requests</th>
                <th className="px-3 py-2 text-right font-semibold">In</th>
                <th className="px-3 py-2 text-right font-semibold">Out</th>
                <th className="px-3 py-2 text-right font-semibold">Costo</th>
                <th className="px-3 py-2 text-right font-semibold">Errores</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Último uso</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId} className={`border-t border-border/60 ${r.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2 font-semibold">{r.label}</td>
                  <td className="px-3 py-2 text-muted">
                    {r.provider} <span className="font-mono text-[10px]">{r.model}</span>
                  </td>
                  <td className="px-3 py-2 text-muted">{STATUS_LABEL[r.scope] || r.scope}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.requests.toLocaleString('es-ES')}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.inputTokens.toLocaleString('es-ES')}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.outputTokens.toLocaleString('es-ES')}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : '—'}</td>
                  <td className={`px-3 py-2 text-right font-mono ${r.errors > 0 ? 'text-red-300' : 'text-muted'}`}>{r.errors}</td>
                  <td className="px-3 py-2">
                    {r.lastStatusCode == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-1.5 font-mono ${r.lastStatusCode === 200 ? 'text-primary' : 'text-red-300'}`}
                      >
                        <span className="size-1.5 rounded-full bg-current" /> {r.lastStatusCode}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{r.lastUsedAt ? new Date(r.lastUsedAt).toLocaleString('es-ES') : 'nunca'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
