import { useEffect, useRef, useState } from 'react'
import { Sparkles, Upload, Trash2, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'

// Skills al estilo Claude (un SKILL.md con frontmatter name/description, o un .zip que lo
// contenga) — instrucciones extra que el agente aplica en ESTE proyecto puntual, además del
// "Conocimiento del proyecto". Subida directa, sin pasar por el chat.
export default function SkillsTab({ projectId }) {
  const [skills, setSkills] = useState(null)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const inputRef = useRef(null)

  const load = () => {
    api
      .listProjectSkills(projectId)
      .then((data) => setSkills(data.skills))
      .catch((err) => setError(err.message))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const pickFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    api
      .uploadProjectSkill(projectId, file)
      .then((skill) => setSkills((prev) => [...(prev || []), skill]))
      .catch((err) => setError(err.detail ? `${err.message}: ${err.detail}` : err.message))
      .finally(() => setUploading(false))
  }

  const toggle = (skill) => {
    setBusyId(skill.id)
    api
      .toggleProjectSkill(projectId, skill.id, !skill.is_active)
      .then((updated) => setSkills((prev) => prev.map((s) => (s.id === updated.id ? updated : s))))
      .catch((err) => setError(err.message))
      .finally(() => setBusyId(null))
  }

  const remove = (skill) => {
    setBusyId(skill.id)
    api
      .deleteProjectSkill(projectId, skill.id)
      .then(() => setSkills((prev) => prev.filter((s) => s.id !== skill.id)))
      .catch((err) => setError(err.message))
      .finally(() => setBusyId(null))
  }

  return (
    <div>
      <p className="text-[11px] text-muted">
        Subí una skill (archivo <code className="font-mono text-primary">SKILL.md</code>, o un{' '}
        <code className="font-mono text-primary">.zip</code> que lo contenga) para ampliar lo que la IA sabe hacer
        en este proyecto. Las skills activas se aplican solas cuando el pedido encaja, sin que tengas que
        mencionarlas.
      </p>

      <input ref={inputRef} type="file" accept=".md,.zip" className="hidden" onChange={pickFile} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="press mt-3 flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-white/5 hover:text-text disabled:opacity-50"
      >
        {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {uploading ? 'Subiendo…' : 'Subir skill'}
      </button>

      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}
      {skills === null && !error && <p className="mt-3 text-[11px] text-muted">Cargando…</p>}
      {skills?.length === 0 && <p className="mt-3 text-[11px] text-muted">Todavía no subiste ninguna skill.</p>}

      {skills?.length > 0 && (
        <div className="mt-3 space-y-2">
          {skills.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-start gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sparkles className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text">{s.name}</p>
                  {s.description && <p className="mt-0.5 text-[11px] text-muted">{s.description}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    s.is_active ? 'bg-primary/15 text-primary' : 'bg-white/10 text-muted'
                  }`}
                >
                  {s.is_active ? 'Activa' : 'Inactiva'}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  onClick={() => toggle(s)}
                  disabled={busyId === s.id}
                  className="press flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-white/5 hover:text-text disabled:opacity-50"
                >
                  {s.is_active ? 'Desactivar' : 'Activar'}
                </button>
                <button
                  onClick={() => remove(s)}
                  disabled={busyId === s.id}
                  title="Eliminar"
                  className="press flex size-6 items-center justify-center rounded-full text-muted hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                >
                  {busyId === s.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
