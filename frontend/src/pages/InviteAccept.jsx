import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Handshake, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'

// Página pública (sin auth) — a la que llega el link que un reseller comparte con su cliente.
// Si la persona ya está logueada con el email correcto, confirma la invitación al toque. Si no,
// la manda a /auth guardando el token para retomar el flujo apenas vuelva logueada.
export default function InviteAccept() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [preview, setPreview] = useState(undefined) // undefined = cargando, null = inválida
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    api
      .resellerInvitePreview(token)
      .then(setPreview)
      .catch((err) => setPreview(null) || setError(err.message))
  }, [token])

  const accept = async () => {
    setAccepting(true)
    setError(null)
    try {
      await api.resellerAcceptInvite(token)
      setDone(true)
      setTimeout(() => navigate('/dashboard'), 1500)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setAccepting(false)
    }
  }

  // Login/registro (cualquiera de los 3 métodos) siempre termina en /dashboard, sin importar de
  // dónde vino la persona — Dashboard.jsx revisa esta clave al montar y retoma la invitación.
  const goAuth = () => {
    sessionStorage.setItem('gitflow_pending_invite', token)
    navigate('/auth')
  }

  if (preview === undefined || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    )
  }

  if (preview === null) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <Handshake className="mx-auto size-8 text-muted" />
          <h1 className="mt-3 text-lg font-semibold">Invitación no válida</h1>
          <p className="mt-1.5 text-sm text-muted">{error || 'Este link ya no es válido o ya fue usado.'}</p>
        </div>
      </div>
    )
  }

  const emailMatches = user?.email?.toLowerCase() === preview.email.toLowerCase()

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface/60 p-6 text-center">
        <Handshake className="mx-auto size-8 text-primary" />
        <h1 className="mt-3 text-lg font-semibold">Te invitó {preview.resellerName}</h1>
        <p className="mt-1.5 text-sm text-muted">
          Para <span className="font-medium text-text">{preview.email}</span>
        </p>

        {done ? (
          <p className="mt-4 text-sm text-primary">¡Listo! Te llevamos a tu panel…</p>
        ) : user ? (
          emailMatches ? (
            <button
              onClick={accept}
              disabled={accepting}
              className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60"
            >
              {accepting && <Loader2 className="size-4 animate-spin" />} Confirmar invitación
            </button>
          ) : (
            <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Estás logueado con {user.email || 'otra cuenta'}. Cerrá sesión e iniciá con {preview.email} para aceptar esta invitación.
            </p>
          )
        ) : (
          <button
            onClick={goAuth}
            className="mt-4 w-full rounded-md bg-primary py-2.5 text-sm font-bold text-slate-950"
          >
            Iniciar sesión o registrarme
          </button>
        )}

        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      </div>
    </div>
  )
}
