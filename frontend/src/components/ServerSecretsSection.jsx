import { useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'

// Secrets de SERVIDOR (Edge Functions) — a diferencia de los secrets del sitio (que terminan
// en el bundle público), estos se empujan directo a Supabase (Management API) y solo los lee
// una función corriendo en el servidor. Vive en el panel "Más" (junto con Funciones e
// Integraciones), separado del panel de Publicar.
export default function ServerSecretsSection({ projectId }) {
  const [secrets, setSecrets] = useState(null)
  const [error, setError] = useState(null)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    api
      .listProjectServerSecrets(projectId)
      .then((data) => setSecrets(data.secrets))
      .catch((err) => setError(err.message))
  }, [projectId])

  const add = async (e) => {
    e.preventDefault()
    if (!key.trim() || !value.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveProjectServerSecret(projectId, key.trim(), value.trim())
      setSecrets((prev) => [...(prev || []).filter((s) => s.key !== saved.key), saved].sort((a, b) => a.key.localeCompare(b.key)))
      setKey('')
      setValue('')
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (secret) => {
    setDeletingId(secret.id)
    try {
      await api.deleteProjectServerSecret(projectId, secret.id)
      setSecrets((prev) => prev.filter((s) => s.id !== secret.id))
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
        <KeyRound className="size-3.5 text-primary" /> Secrets de servidor
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Para Edge Functions (backend real) — a diferencia de los secrets del sitio, estos <span className="text-primary">nunca</span> se
        incluyen en el código público, solo los lee una función corriendo en tu proyecto de Supabase con{' '}
        <code className="font-mono">Deno.env.get(...)</code>. Necesita que la base de datos esté conectada por OAuth.
      </p>

      {secrets === null && !error && <p className="mt-2 text-[11px] text-muted">Cargando…</p>}
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

      {secrets?.length > 0 && (
        <div className="mt-2 space-y-1">
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
              <span className="truncate font-mono text-xs text-text/90">{s.key}</span>
              <button
                onClick={() => remove(s)}
                disabled={deletingId === s.id}
                title="Eliminar"
                className="press flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
              >
                {deletingId === s.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="mt-2 space-y-1.5">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="STRIPE_SECRET_KEY"
          className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary/50"
        />
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-background/40 focus-within:border-primary/50">
            <input
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Valor"
              className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none"
            />
            <button
              type="button"
              onClick={() => setShowValue((s) => !s)}
              className="shrink-0 px-2 text-muted hover:text-text"
            >
              {showValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={!key.trim() || !value.trim() || saving}
            className="press flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-slate-950 disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          </button>
        </div>
      </form>
    </div>
  )
}
