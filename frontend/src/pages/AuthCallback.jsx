import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function AuthCallback() {
  const [params] = useSearchParams()
  const { login } = useAuth()
  const [done, setDone] = useState(false)
  const token = params.get('token')
  const next = params.get('next')

  useEffect(() => {
    if (!token) return
    login(token).then(() => setDone(true))
  }, [token, login])

  if (!token) return <Navigate to="/auth?error=missing_code" replace />
  if (!done) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Iniciando sesión…
      </div>
    )
  }
  return <Navigate to={next ? decodeURIComponent(next) : "/dashboard"} replace />
}
