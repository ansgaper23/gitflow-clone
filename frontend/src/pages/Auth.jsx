import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Github, Bot, Loader2 } from 'lucide-react'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'

const ERROR_MESSAGES = {
  missing_code: 'No se recibió el código de autorización. Inténtalo de nuevo.',
  token_exchange_failed: 'No se pudo validar la autorización.',
  supabase_not_configured: 'El backend aún no tiene Supabase configurado (ver backend/.env.example).',
  server_error: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
}

function GoogleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" {...props}>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.28 1.48-1.13 2.73-2.4 3.58v2.98h3.88c2.27-2.09 3.58-5.17 3.58-8.8z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.88-2.98c-1.07.72-2.45 1.15-4.05 1.15-3.11 0-5.75-2.1-6.69-4.93H1.3v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.31 14.33A7.2 7.2 0 0 1 4.9 12c0-.81.14-1.6.41-2.33V6.58H1.3A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.3 5.42l4.01-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.59 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.3 6.58l4.01 3.09c.94-2.83 3.58-4.92 6.69-4.92z" />
    </svg>
  )
}

export default function Auth() {

  const [ref] = useState(() => localStorage.getItem('flowpro_ref'))
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : ''

  const [params] = useSearchParams()
  const error = params.get('error')
  const navigate = useNavigate()
  const { login: setSession } = useAuth()

  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setFormError(null)
    try {
      const result =
        mode === 'login' ? await api.login(email, password) : await api.register(email, password, name, ref)
      await setSession(result.token)
      navigate('/dashboard')
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-full brand-gradient">
          <Bot className="size-4 text-slate-950" />
        </span>
        <span className="text-lg font-semibold tracking-tight">
          Flow<span className="text-brand-gradient">Pro</span>
        </span>
      </Link>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface/70 p-8 backdrop-blur-sm">
        <div className="mb-5 flex rounded-lg border border-border p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
              mode === 'login' ? 'bg-white/10 text-text' : 'text-muted hover:text-text'
            }`}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 rounded-md py-1.5 font-medium transition-colors ${
              mode === 'register' ? 'bg-white/10 text-text' : 'text-muted hover:text-text'
            }`}
          >
            Crear cuenta
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {ERROR_MESSAGES[error] || 'Ocurrió un error al iniciar sesión.'}
          </p>
        )}

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre (opcional)"
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          )}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            type="password"
            required
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'register' ? 'Contraseña (mín. 8 caracteres)' : 'Contraseña'}
            className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />

          {formError && <p className="text-xs text-red-300">{formError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md brand-gradient py-2.5 text-sm font-bold text-slate-950 disabled:opacity-60"
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {mode === 'login' ? 'Entrar' : 'Crear cuenta'}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />o<span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2">
          <a
            href={`${import.meta.env.VITE_API_URL || ''}/api/auth/google/login${qs}`}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90"
          >
            <GoogleIcon />
            Continuar con Google
          </a>
          <a
            href={`${import.meta.env.VITE_API_URL || ''}/api/auth/github/login${qs}`}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-white/95 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-opacity hover:opacity-90"
          >
            <Github className="size-4" />
            Continuar con GitHub
          </a>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted">
          Con Google o email/contraseña podrás conectar tu GitHub después, desde tu cuenta.
        </p>

        <p className="mt-6 text-center text-xs text-muted">
          Al continuar aceptas nuestros{' '}
          <a href="#" className="text-primary hover:underline">Términos de Uso</a> y{' '}
          <a href="#" className="text-primary hover:underline">Política de Privacidad</a>.
        </p>
      </div>
    </div>
  )
}
