import { useEffect, useState } from 'react'
import { Server, Copy, Check, ExternalLink } from 'lucide-react'
import { api } from '../lib/api.js'

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `hace ${hr} h`
  return `hace ${Math.floor(hr / 24)} d`
}

// Solo lectura: para desplegar una función nueva se le pide a la IA por chat (con
// "propose_edge_function", el usuario aprueba ahí) — acá se ve lo que ya quedó desplegado.
export default function FunctionsTab({ projectId }) {
  const [functions, setFunctions] = useState(null)
  const [error, setError] = useState(null)
  const [copiedSlug, setCopiedSlug] = useState(null)

  useEffect(() => {
    api
      .listProjectEdgeFunctions(projectId)
      .then((data) => setFunctions(data.functions))
      .catch((err) => setError(err.message))
  }, [projectId])

  const copy = async (slug, url) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug(null), 1500)
    } catch {
      /* portapapeles no disponible */
    }
  }

  return (
    <div>
      <p className="text-[11px] text-muted">
        Funciones de servidor (Edge Functions) ya desplegadas en este proyecto. Para agregar una nueva, pedísela a la IA
        por chat — la aprobás ahí, y aparece acá una vez desplegada.
      </p>

      {functions === null && !error && <p className="mt-3 text-[11px] text-muted">Cargando…</p>}
      {error && <p className="mt-3 text-[11px] text-red-300">{error}</p>}

      {functions?.length === 0 && <p className="mt-3 text-[11px] text-muted">Todavía no desplegaste ninguna función.</p>}

      {functions?.length > 0 && (
        <div className="mt-3 space-y-2">
          {functions.map((f) => (
            <div key={f.slug} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-start gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Server className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs font-medium text-text">{f.slug}</p>
                  {f.summary && <p className="mt-0.5 text-[11px] text-muted">{f.summary}</p>}
                  <p className="mt-0.5 text-[10px] text-muted">Desplegada {timeAgo(f.deployedAt)}</p>
                </div>
              </div>
              {f.invokeUrl && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{f.invokeUrl}</span>
                  <button
                    onClick={() => copy(f.slug, f.invokeUrl)}
                    title="Copiar URL"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-text"
                  >
                    {copiedSlug === f.slug ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                  </button>
                  <a
                    href={f.invokeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Abrir"
                    className="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-white/5 hover:text-text"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
