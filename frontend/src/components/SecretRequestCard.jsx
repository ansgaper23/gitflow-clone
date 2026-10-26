import { useState } from 'react'
import { KeyRound, Check, Loader2, Server, Globe } from 'lucide-react'
import { api } from '../lib/api.js'

export default function SecretRequestCard({ data, projectId, answered, onDone }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    if (!value.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      if (data.isServerSide) {
        await api.saveProjectServerSecret(projectId, data.keyName, value.trim())
      } else {
        await api.saveProjectSecret(projectId, data.keyName, value.trim())
      }
      onDone(`Ya guardé la credencial ${data.keyName}. Podes continuar.`)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const skip = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onDone(`Decidí no ingresar ${data.keyName} por ahora, continuá sin eso o avisame qué hacemos.`)
    } catch (err) {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <KeyRound className="size-4 shrink-0 text-amber-500" />
        <span className="text-xs font-medium text-text/95">
          Se requiere credencial: <span className="font-mono text-primary">{data.keyName}</span>
        </span>
      </div>

      <div className="px-3 pb-3">
        <p className="text-xs text-muted mb-3">{data.description}</p>
        
        <div className="flex items-center gap-2 mb-3 text-[11px] text-muted bg-background/40 p-2 rounded border border-border/50">
          {data.isServerSide ? <Server className="size-3" /> : <Globe className="size-3" />}
          <span>{data.isServerSide ? 'Se guardará como secreto de servidor (backend)' : 'Se guardará como variable de entorno (frontend)'}</span>
        </div>

        {!answered && (
          <div className="space-y-2">
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ingresa el valor secreto..."
              className="w-full rounded-md border border-border bg-background/40 px-3 py-2 text-xs outline-none focus:border-primary/50"
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
            />
            {error && <p className="text-[11px] text-red-400">{error}</p>}
          </div>
        )}
      </div>

      {!answered && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button
            onClick={skip}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/80 hover:bg-white/5 disabled:opacity-60"
          >
            Omitir
          </button>
          <button
            onClick={save}
            disabled={!value.trim() || saving}
            className="press ml-auto flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Guardar
          </button>
        </div>
      )}
    </div>
  )
}
