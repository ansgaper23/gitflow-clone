import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../lib/api.js'

// Compatibilidad con enlaces viejos /chat/:owner/:repo (de antes de proyectos virtuales):
// abre (o registra) ese repo como proyecto de FlowPro y redirige a /chat/:projectId.
export default function ChatLegacyRedirect() {
  const { owner, repo } = useParams()
  const [projectId, setProjectId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api
      .openProject(`${owner}/${repo}`)
      .then((project) => {
        if (!cancelled) setProjectId(project.id)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [owner, repo])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-red-300">No se pudo abrir {owner}/{repo}</p>
        <p className="text-xs text-muted">{error}</p>
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Abriendo proyecto…</p>
      </div>
    )
  }

  return <Navigate to={`/chat/${projectId}`} replace />
}
