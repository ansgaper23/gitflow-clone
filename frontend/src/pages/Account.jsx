import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Github, KeyRound, Loader2, Zap } from 'lucide-react'
import AppNav from '../components/AppNav.jsx'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useTrialCountdown, formatCountdown } from '../components/TrialCountdown.jsx'
import YapePlinModal from '../components/YapePlinModal.jsx'

// Yape/Plin son apps peruanas — no tiene sentido ofrecérselas a alguien fuera de Perú. Sin
// geo-IP, la zona horaria del navegador es la señal más simple y sin dependencias externas.
function looksLikePeru() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Lima'
  } catch {
    return false
  }
}

function formatPrice(cents, currency) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(cents / 100)
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

// Canjea una clave que el usuario recibió de un reseller (por WhatsApp, etc.) — no hace falta
// estar vinculado a ningún reseller en particular, la clave sola alcanza (ver POST
// /plans/redeem-key). `onRedeemed` refresca el plan del usuario en el resto de la página.
function RedeemKeyForm({ onRedeemed }) {
  const [code, setCode] = useState('')
  const [redeeming, setRedeeming] = useState(false)
  const [result, setResult] = useState(null) // { type: 'ok' | 'error', text }

  const submit = async (e) => {
    e.preventDefault()
    if (!code.trim() || redeeming) return
    setRedeeming(true)
    setResult(null)
    try {
      await api.redeemPlanKey(code.trim())
      setResult({ type: 'ok', text: '¡Clave canjeada! Tu plan ya está activo.' })
      setCode('')
      onRedeemed?.()
    } catch (err) {
      setResult({ type: 'error', text: err.message })
    } finally {
      setRedeeming(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-dashed border-border p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound className="size-4 text-primary" /> ¿Tenés una clave de activación?
      </p>
      <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="FP-XXXX-XXXX-XXXX"
          className="min-w-0 flex-1 rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-sm outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={redeeming || !code.trim()}
          className="press flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          {redeeming ? <Loader2 className="size-3.5 animate-spin" /> : null} Canjear
        </button>
      </form>
      {result && (
        <p className={`mt-2 text-xs ${result.type === 'ok' ? 'text-primary' : 'text-red-300'}`}>{result.text}</p>
      )}
    </div>
  )
}

export default function Account() {
  const { user, refresh } = useAuth()
  const trialRemainingMs = useTrialCountdown(user?.trialActive ? user.trialExpiresAt : null)
  const [params, setParams] = useSearchParams()
  const [plans, setPlans] = useState([])
  const [purchasing, setPurchasing] = useState(null)
  const [message, setMessage] = useState(null)
  const [yapeAvailable, setYapeAvailable] = useState(false)
  const [yapePlan, setYapePlan] = useState(null)

  useEffect(() => {
    api.plans().then(setPlans).catch(() => {})
    if (looksLikePeru()) {
      api.yapeInfo().then((info) => setYapeAvailable(info.configured)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (params.get('github_connected') === '1') {
      refresh()
      setMessage({ type: 'ok', text: 'Cuenta de GitHub conectada correctamente.' })
      setParams((p) => { p.delete('github_connected'); return p }, { replace: true })
    }
    if (params.get('google_connected') === '1') {
      refresh()
      setMessage({ type: 'ok', text: 'Cuenta de Google conectada correctamente.' })
      setParams((p) => { p.delete('google_connected'); return p }, { replace: true })
    }
    if (params.get('stripe') === 'success') {
      setMessage({ type: 'ok', text: 'Pago recibido — activando tu plan… si no se ve activo en unos segundos, recargá la página.' })
      setParams((p) => { p.delete('stripe'); return p }, { replace: true })
      // El webhook de Stripe activa el plan de forma asíncrona; puede llegar unos segundos
      // después de que el usuario vuelve del checkout, así que reintenta el refresh un rato.
      let attempts = 0
      const poll = setInterval(() => {
        attempts += 1
        refresh()
        if (attempts >= 5) clearInterval(poll)
      }, 2000)
    }
    if (params.get('stripe') === 'cancelled') {
      setMessage({ type: 'error', text: 'Pago cancelado. No se te cobró nada.' })
      setParams((p) => { p.delete('stripe'); return p }, { replace: true })
    }
    const err = params.get('error')
    if (err === 'github_already_linked') {
      setMessage({ type: 'error', text: 'Esa cuenta de GitHub ya está conectada a otro usuario de FlowPro.' })
      setParams((p) => { p.delete('error'); return p }, { replace: true })
    }
    if (err === 'google_already_linked') {
      setMessage({ type: 'error', text: 'Esa cuenta de Google ya está conectada a otro usuario de FlowPro.' })
      setParams((p) => { p.delete('error'); return p }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const buy = async (planId) => {
    setPurchasing(planId)
    setMessage(null)
    try {
      const { url } = await api.checkoutPlan(planId)
      window.location.href = url
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
      setPurchasing(null)
    }
  }

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">Mi cuenta</h1>

        <div className={`mt-6 rounded-xl border p-5 ${user?.planActive ? 'border-primary/30 bg-surface/60 glow-brand' : 'border-border bg-surface/60'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">Estado del plan</p>
              <p className="mt-1 text-lg font-semibold">
                {user?.planActive ? (
                  <span className="text-primary">Activo</span>
                ) : (
                  <span className="text-red-300">Sin plan activo</span>
                )}
              </p>
              {user?.planExpiresAt && (
                <p className="mt-1 text-xs text-muted">
                  {user.planActive ? 'Expira' : 'Expiró'} el {new Date(user.planExpiresAt).toLocaleString('es-ES')}
                </p>
              )}
              {!user?.planActive && user?.trialActive && trialRemainingMs > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                  <Zap className="size-3" /> Prueba gratis: {formatCountdown(trialRemainingMs)} restantes
                </p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm text-muted">Mensajes enviados</p>
              <p className="text-2xl font-bold text-brand-gradient">{user?.creditsUsed ?? 0}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface/60 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted">GitHub</p>
              <p className="mt-1 text-lg font-semibold">
                {user?.githubConnected ? (
                  <span className="text-primary">Conectado {user.githubLogin ? `como @${user.githubLogin}` : ''}</span>
                ) : (
                  <span className="text-amber-300">No conectado</span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted">
                Necesario para crear o editar proyectos (FlowPro trabaja sobre tus repositorios de GitHub).
              </p>
            </div>
            {!user?.githubConnected && (
              <a
                href={api.githubLinkUrl()}
                className="press flex shrink-0 items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:opacity-90"
              >
                <Github className="size-4" /> Conectar GitHub
              </a>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface/60 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted">Google</p>
              <p className="mt-1 text-lg font-semibold">
                {user?.googleConnected ? (
                  <span className="text-primary">Conectado</span>
                ) : (
                  <span className="text-amber-300">No conectado</span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted">
                Conéctalo para poder entrar con este mismo botón la próxima vez, sin usar contraseña.
              </p>
            </div>
            {!user?.googleConnected && (
              <a
                href={api.googleLinkUrl()}
                className="press flex shrink-0 items-center gap-2 rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:opacity-90"
              >
                <GoogleIcon /> Conectar Google
              </a>
            )}
          </div>
        </div>

        {message && (
          <p
            className={`mt-4 rounded-md px-3 py-2 text-sm ${
              message.type === 'ok'
                ? 'border border-primary/30 bg-primary/10 text-primary'
                : 'border border-red-500/30 bg-red-500/10 text-red-300'
            }`}
          >
            {message.text}
          </p>
        )}

        <h2 className="mt-10 text-lg font-semibold">Planes disponibles</h2>
        <p className="text-xs text-muted">
          Pago seguro procesado por Stripe{yapeAvailable ? ', o por Yape/Plin con verificación manual' : ''}.
        </p>

        <RedeemKeyForm onRedeemed={refresh} />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`card-lift flex flex-col justify-between gap-4 rounded-xl border p-5 ${
                plan.featured ? 'border-gold/60 bg-gold/5 glow-brand' : 'border-border bg-surface/50'
              }`}
            >
              <div>
                <p className="font-semibold">{plan.name}</p>
                <p className="mt-1 text-2xl font-bold">{formatPrice(plan.price_cents, plan.currency)}</p>
              </div>
              <div className="flex flex-col gap-2">
                
                  {user?.resellerId ? (
                    user?.resellerPaymentUrl ? (
                      <a href={user.resellerPaymentUrl} target="_blank" rel="noopener noreferrer" className="press flex items-center justify-center gap-2 rounded-md brand-gradient py-2 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90">
                        Comprar a proveedor
                      </a>
                    ) : (
                      <div className="text-center rounded-md border border-dashed border-border bg-background/50 px-3 py-2 text-xs text-muted">
                        Adquirí una key con tu proveedor para activar el plan.
                      </div>
                    )
                  ) : (
                  <button
                    onClick={() => buy(plan.id)}
                    disabled={purchasing === plan.id}
                    className="press flex items-center justify-center gap-2 rounded-md brand-gradient py-2 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {purchasing === plan.id ? (
                      'Procesando…'
                    ) : user?.planId === plan.id && user?.planActive ? (
                      <>
                        <CheckCircle2 className="size-4" /> Plan actual
                      </>
                    ) : (
                      <>
                        {plan.name.toLowerCase().includes('pro') && <Zap className="size-4" />} Empezar {plan.name}
                      </>
                    )}
                  </button>
                  )}

                {yapeAvailable && (
                  <button
                    onClick={() => setYapePlan(plan)}
                    className="press rounded-md border border-border py-2 text-sm font-semibold hover:bg-white/5"
                  >
                    Pagar con Yape / Plin
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      {yapePlan && <YapePlinModal plan={yapePlan} onClose={() => setYapePlan(null)} />}
    </div>
  )
}
