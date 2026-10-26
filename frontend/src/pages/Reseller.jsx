import { useEffect, useState } from 'react'
import { Handshake, Coins, Users, Copy, Check, Loader2, Send, Clock, History, KeyRound, Ban, LayoutDashboard, Settings, Key, UserPlus, Zap } from 'lucide-react'
import AppNav from '../components/AppNav.jsx'
import { api } from '../lib/api.js'

const INVITE_STATUS_LABEL = {
  pending: { label: 'Pendiente', cls: 'bg-amber-500/15 text-amber-300' },
  accepted: { label: 'Aceptada', cls: 'bg-primary/15 text-primary' },
  expired: { label: 'Expirada', cls: 'bg-red-500/15 text-red-300' },
}

const KEY_STATUS_LABEL = {
  unused: { label: 'Sin usar', cls: 'bg-amber-500/15 text-amber-300' },
  redeemed: { label: 'Canjeada', cls: 'bg-primary/15 text-primary' },
  revoked: { label: 'Anulada', cls: 'bg-white/10 text-muted' },
}

const CREDIT_REASON_LABEL = {
  admin_grant: 'Carga de admin',
  activate_plan: 'Activación de plan',
  admin_adjustment: 'Ajuste de admin',
  generate_key: 'Generar clave',
  revoke_key_refund: 'Devolución (clave anulada)',
}

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-brand-gradient">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

function InviteForm({ onCreated }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [lastInvite, setLastInvite] = useState(null)
  const [copied, setCopied] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      const invite = await api.resellerCreateInvite(email.trim())
      setLastInvite(invite)
      setEmail('')
      onCreated?.(invite)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSending(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(lastInvite.inviteUrl).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <p className="text-sm font-medium">Invitar cliente</p>
      <p className="mt-0.5 text-[11px] text-muted">
        Se genera un link — el cliente entra, inicia sesión o se registra con ESE email, y confirma la invitación él mismo.
      </p>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="cliente@ejemplo.com"
          className="min-w-0 flex-1 rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={sending}
          className="press flex shrink-0 items-center gap-1.5 rounded-md brand-gradient px-3 py-2 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Invitar
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {lastInvite && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text/90">{lastInvite.inviteUrl}</span>
          <button onClick={copyLink} className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      )}
    </div>
  )
}

// A diferencia de "Invitar cliente" (que vincula una cuenta puntual), esto genera un código que
// el reseller le pasa a cualquiera por fuera (WhatsApp, etc.) — quien lo reciba lo canjea él
// mismo en /account con la cuenta que quiera, sin necesitar estar vinculado a este reseller.
function GenerateKeyForm({ planCosts, balance, onGenerated }) {
  const [planId, setPlanId] = useState(planCosts[0]?.planId || '')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [lastKey, setLastKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const cost = planCosts.find((p) => p.planId === planId)?.creditCost

  const generate = async () => {
    if (!planId || generating) return
    setGenerating(true)
    setError(null)
    try {
      const key = await api.resellerGenerateKey(planId)
      setLastKey(key)
      onGenerated(key)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setGenerating(false)
    }
  }

  const copyCode = () => {
    navigator.clipboard.writeText(lastKey.code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (planCosts.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-surface/60 p-4">
      <p className="text-sm font-medium">Generar clave de activación</p>
      <p className="mt-0.5 text-[11px] text-muted">
        Se cobra el crédito al generarla. Pasále el código a quien quieras — lo canjea en su cuenta desde "Mi cuenta", sin
        necesitar estar vinculado a vos.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-2 text-xs outline-none focus:border-primary"
        >
          {planCosts.map((p) => (
            <option key={p.planId} value={p.planId}>
              {p.name} · {p.creditCost} créditos
            </option>
          ))}
        </select>
        <button
          onClick={generate}
          disabled={generating || (cost !== undefined && cost > balance)}
          title={cost !== undefined && cost > balance ? 'No te alcanzan los créditos' : undefined}
          className="press flex items-center gap-1.5 rounded-md brand-gradient px-3 py-2 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {generating ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Generar clave
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {lastKey && (
        <div className="glow-brand animate-materialize-in mt-3 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-text/90">{lastKey.code}</span>
          <button onClick={copyCode} className="flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      )}
    </div>
  )
}

function KeysTable({ keys, onRevoked }) {
  const [revoking, setRevoking] = useState(null)
  const [error, setError] = useState(null)

  const revoke = async (key) => {
    if (!window.confirm(`¿Anular la clave ${key.code}? Se te devuelven los créditos.`)) return
    setRevoking(key.id)
    setError(null)
    try {
      const result = await api.resellerRevokeKey(key.id)
      onRevoked(key.id, result.balance)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setRevoking(null)
    }
  }

  if (keys.length === 0) return null

  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-border">
      {error && <p className="border-b border-border bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      <table className="w-full text-left text-sm">
        <thead className="bg-surface/70 text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Código</th>
            <th className="px-3 py-2 font-medium">Plan</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium">Generada</th>
            <th className="px-3 py-2 font-medium">Acción</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{k.code}</td>
              <td className="px-3 py-2 text-muted">{k.planName}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KEY_STATUS_LABEL[k.status]?.cls || 'bg-white/10 text-muted'}`}>
                  {KEY_STATUS_LABEL[k.status]?.label || k.status}
                </span>
              </td>
              <td className="px-3 py-2 text-muted">{new Date(k.createdAt).toLocaleDateString()}</td>
              <td className="px-3 py-2">
                {k.status === 'unused' && (
                  <button
                    onClick={() => revoke(k)}
                    disabled={revoking === k.id}
                    className="flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Ban className="size-3" /> Anular
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActivatePlanButton({ client, planCosts, balance, onActivated }) {
  const [open, setOpen] = useState(false)
  const [planId, setPlanId] = useState(planCosts[0]?.planId || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const cost = planCosts.find((p) => p.planId === planId)?.creditCost

  const activate = async () => {
    if (!planId || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.resellerActivatePlan(client.id, planId)
      onActivated(client.id, result)
      setOpen(false)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={planCosts.length === 0}
        className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text/80 hover:bg-white/5 disabled:opacity-40"
      >
        Activar plan
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={planId}
        onChange={(e) => setPlanId(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
      >
        {planCosts.map((p) => (
          <option key={p.planId} value={p.planId}>
            {p.name} · {p.creditCost} créditos
          </option>
        ))}
      </select>
      <button
        onClick={activate}
        disabled={busy || (cost !== undefined && cost > balance)}
        className="press rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        title={cost !== undefined && cost > balance ? 'No te alcanzan los créditos' : undefined}
      >
        {busy ? '...' : 'Confirmar'}
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-text">
        Cancelar
      </button>
      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  )
}


function PaymentConfigForm({ initialUrl }) {
  const [url, setUrl] = useState(initialUrl || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await api.resellerSetPaymentUrl(url.trim())
      setMessage({ type: 'ok', text: 'URL de pago guardada' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card-lift rounded-xl border border-border bg-surface/50 p-6">
      <h2 className="text-lg font-semibold">Pasarela de Pago Personalizada</h2>
      <p className="mt-1 text-sm text-muted">
        Si configurás un link aquí (ej. MercadoPago o Hotmart), tus clientes invitados verán este botón para pagar en vez de la pasarela por defecto de FlowPro. Una vez te paguen, podés generarles la Key aquí y enviársela.
      </p>
      <form onSubmit={save} className="mt-4 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://link.mercadopago.com.ar/..."
          className="flex-1 rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50"
        />
        <button type="submit" disabled={saving} className="press rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar'}
        </button>
      </form>
      {message && <p className={`mt-2 text-sm ${message.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{message.text}</p>}
    </div>
  )
}


function ReferralLinkBlock({ licenseKey }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/r/${licenseKey}`

  const copyLink = () => {
    navigator.clipboard.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-6 card-lift rounded-xl border border-border bg-surface/50 p-6">
      <h2 className="text-lg font-semibold">Tu Link de Referido</h2>
      <p className="mt-1 text-sm text-muted">Compartí este enlace con tus clientes. Al registrarse, quedarán vinculados a ti automáticamente.</p>
      <div 
        onClick={copyLink}
        className="press mt-3 flex cursor-pointer items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-mono transition-colors hover:bg-primary/10"
      >
        <span className="flex-1 truncate">{link}</span>
        <div className="flex shrink-0 items-center gap-1 text-xs text-primary">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copiado' : 'Copiar'}
        </div>
      </div>
    </div>
  )
}


function GatewaysConfig({ initialGateways }) {
  const [gateways, setGateways] = useState(initialGateways || {
    stripe: { enabled: false, secretKey: '', webhookSecret: '' },
    mercadopago: { enabled: false, accessToken: '', webhookSecret: '' },
    hotmart: { enabled: false, hottok: '' },
    paypal: { enabled: false, clientId: '', secretKey: '' }
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const handleToggle = (gw) => {
    setGateways(prev => ({
      ...prev,
      [gw]: { ...prev[gw], enabled: !prev[gw].enabled }
    }))
  }

  const handleChange = (gw, field, value) => {
    setGateways(prev => ({
      ...prev,
      [gw]: { ...prev[gw], [field]: value }
    }))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await api.resellerSetGateways(gateways)
      setMessage({ type: 'ok', text: 'Configuración guardada exitosamente.' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Error al guardar.' })
    } finally {
      setSaving(false)
    }
  }

  const GW_CONFIGS = [
    { id: 'mercadopago', name: 'MercadoPago', color: 'bg-[#009EE3]', text: 'text-white', icon: 'MP', fields: [ { id: 'accessToken', label: 'Access Token', placeholder: 'APP_USR-...' }, { id: 'webhookSecret', label: 'Webhook Secret (opcional)', placeholder: 'x-signature...' } ] },
    { id: 'stripe', name: 'Stripe', color: 'bg-[#635BFF]', text: 'text-white', icon: 'S', fields: [ { id: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_...' }, { id: 'webhookSecret', label: 'Webhook Signing Secret', placeholder: 'whsec_...' } ] },
    { id: 'hotmart', name: 'Hotmart', color: 'bg-[#F04E23]', text: 'text-white', icon: 'H', fields: [ { id: 'hottok', label: 'Hottok (Token Webhook)', placeholder: '...' } ] },
    { id: 'paypal', name: 'PayPal', color: 'bg-[#003087]', text: 'text-white', icon: 'P', fields: [ { id: 'clientId', label: 'Client ID', placeholder: '...' }, { id: 'secretKey', label: 'Secret Key', placeholder: '...' } ] }
  ]

  return (
    <div className="card-lift rounded-xl border border-border bg-surface/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="size-5 text-primary" /> Integraciones Nativas de Pago
          </h2>
          <p className="mt-1 text-sm text-muted">
            Habilita y configura tus pasarelas. FlowPro generará los cobros dinámicamente usando tus credenciales.
          </p>
        </div>
        <button onClick={save} disabled={saving} className="press rounded-full bg-primary px-5 py-2 text-sm font-bold text-slate-900 transition-opacity hover:opacity-90 disabled:opacity-50">
          {saving ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      {message && (
        <div className={`mb-6 rounded-md px-4 py-2.5 text-sm font-medium ${message.type === 'ok' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 mt-4">
        {GW_CONFIGS.map(cfg => {
          const isEnabled = gateways[cfg.id]?.enabled || false
          return (
            <div key={cfg.id} className={`rounded-xl border transition-colors ${isEnabled ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/30'}`}>
              <div className="flex items-center justify-between p-4 cursor-pointer select-none" onClick={() => handleToggle(cfg.id)}>
                <div className="flex items-center gap-3">
                  <div className={`flex size-8 items-center justify-center rounded-lg ${cfg.color} ${cfg.text} font-bold text-xs`}>
                    {cfg.icon}
                  </div>
                  <span className="font-semibold text-text/90">{cfg.name}</span>
                </div>
                <div className={`flex h-5 w-9 items-center rounded-full transition-colors ${isEnabled ? 'bg-primary' : 'bg-white/10'}`}>
                  <div className={`size-4 rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </div>
              </div>
              
              {isEnabled && (
                <div className="border-t border-border/50 p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
                  {cfg.fields.map(field => (
                    <div key={field.id}>
                      <label className="text-xs font-semibold text-text/80 uppercase tracking-wider">{field.label}</label>
                      <input
                        type="password"
                        value={gateways[cfg.id]?.[field.id] || ''}
                        onChange={(e) => handleChange(cfg.id, field.id, e.target.value)}
                        placeholder={field.placeholder}
                        className="mt-1.5 w-full rounded-md border border-border bg-background/80 px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                  ))}
                  <div className="mt-3 rounded-md bg-white/5 p-3 text-[11px] text-muted">
                    <p className="font-medium text-text/70 mb-1">Webhook URL de {cfg.name}:</p>
                    <code className="font-mono text-primary select-all">{window.location.origin.replace('http://localhost:5173', 'https://flow-pro.online')}/api/reseller/webhook/{cfg.id}/{status.license.shortCode || status.license.license_key}</code>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function Reseller() {
    const [status, setStatus] = useState(undefined) // undefined = cargando
  const [clients, setClients] = useState([])
  const [planCosts, setPlanCosts] = useState([])
  const [invites, setInvites] = useState([])
  const [transactions, setTransactions] = useState([])
  const [keys, setKeys] = useState([])
  const [error, setError] = useState(null)
  
  const [activeTab, setActiveTab] = useState('overview')

  const load = () => {
    Promise.all([
      api.resellerStatus(),
      api.resellerClients().catch(() => []),
      api.resellerPlanCosts().catch(() => []),
      api.resellerInvites().catch(() => []),
      api.resellerKeys().catch(() => []),
      api.resellerWallet().catch(() => ({ transactions: [] })),
    ])
      .then(([s, c, pc, inv, k, wallet]) => {
        setStatus(s)
        setClients(c)
        setPlanCosts(pc)
        setInvites(inv)
        setKeys(k)
        setTransactions(wallet.transactions || [])
      })
      .catch((err) => setError(err.message))
  }

  useEffect(load, [])

  const onActivated = (clientId, result) => {
    setStatus((s) => ({ ...s, balance: result.balance }))
    setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, planExpiresAt: result.planExpiresAt, planActive: true } : c)))
  }

  const onInviteCreated = (invite) => setInvites((prev) => [invite, ...prev])

  const onKeyGenerated = (key) => {
    setStatus((s) => ({ ...s, balance: key.balance }))
    setKeys((prev) => [key, ...prev])
  }

  const onKeyRevoked = (keyId, balance) => {
    setStatus((s) => ({ ...s, balance }))
    setKeys((prev) => prev.map((k) => (k.id === keyId ? { ...k, status: 'revoked' } : k)))
  }

  if (status === undefined) {
    return (
      <div className="min-h-screen bg-aurora">
        <AppNav />
        <main className="mx-auto max-w-5xl px-4 py-10 text-sm text-muted">Cargando…</main>
      </div>
    )
  }

  if (!status.active) {
    return (
      <div className="min-h-screen bg-aurora">
        <AppNav />
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <Handshake className="mx-auto size-8 text-muted" />
          <h1 className="mt-3 text-lg font-semibold">No tenés acceso al panel reseller</h1>
          <p className="mt-1.5 text-sm text-muted">
            {status.hasLicense
              ? 'Tu licencia de reseller no está activa o venció. Contactá a soporte de FlowPro para renovarla.'
              : 'Esta cuenta no tiene una licencia de reseller. Contactá a FlowPro si querés convertirte en reseller.'}
          </p>
        </main>
      </div>
    )
  }  return (
    <div className="min-h-screen bg-aurora pb-20">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Handshake className="size-6 text-primary" /> <span className="text-brand-gradient">Panel Reseller</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          Tier <span className="font-medium text-text">{status.license.tier === 'white_label' ? 'White-label' : 'Básico'}</span>
          {status.license.expiresAt && ` · vence el ${new Date(status.license.expiresAt).toLocaleDateString()}`}
        </p>

        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

        {/* Custom Tabs */}
        <div className="mt-8 flex space-x-2 border-b border-border pb-1 overflow-x-auto scrollbar-hide">
          {[
            { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
            { id: 'clients', label: 'Clientes', icon: Users },
            { id: 'keys', label: 'Claves & Historial', icon: Key },
            { id: 'settings', label: 'Configuración', icon: Settings },
          ].map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-b-2 border-primary text-primary bg-primary/5'
                    : 'text-muted hover:bg-white/5 hover:text-text/90'
                }`}
              >
                <Icon className="size-4" /> {tab.label}
              </button>
            )
          })}
        </div>

        <div className="mt-6">
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid gap-4 sm:grid-cols-2">
                <StatCard icon={Coins} label="Créditos disponibles" value={status.balance} />
                <StatCard icon={Users} label="Clientes" value={clients.length} hint={status.license.clientLimit ? `Cupo: ${status.license.clientLimit}` : 'Sin límite de cupo'} />
              </div>
              
              <div className="grid gap-4 sm:grid-cols-2">
                <InviteForm onCreated={onInviteCreated} />
                <GenerateKeyForm planCosts={planCosts} balance={status.balance} onGenerated={onKeyGenerated} />
              </div>
              
              <ReferralLinkBlock licenseKey={status.license.shortCode || status.license.license_key} />
            </div>
          )}

          {activeTab === 'clients' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {invites.some((i) => i.status === 'pending') && (
                <div>
                  <p className="mb-2 text-sm font-medium">Invitaciones pendientes</p>
                  <div className="overflow-x-auto rounded-xl border border-border bg-surface/50">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface/70 text-xs text-muted">
                        <tr>
                          <th className="px-4 py-3 font-medium">Email</th>
                          <th className="px-4 py-3 font-medium">Estado</th>
                          <th className="px-4 py-3 font-medium">Enviada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invites.filter((i) => i.status === 'pending').map((i) => (
                          <tr key={i.id} className="border-t border-border hover:bg-white/[0.02]">
                            <td className="px-4 py-3 text-muted">{i.invite_email}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${INVITE_STATUS_LABEL[i.status]?.cls || 'bg-white/10 text-muted'}`}>
                                {INVITE_STATUS_LABEL[i.status]?.label || i.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted">{new Date(i.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-medium">Tus clientes activos</p>
                {clients.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border bg-surface/30 p-8 text-center text-sm text-muted">
                    Todavía no tenés clientes. Envíales tu Link Mágico desde la sección Resumen.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border bg-surface/50">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface/70 text-xs text-muted">
                        <tr>
                          <th className="px-4 py-3 font-medium">Email</th>
                          <th className="px-4 py-3 font-medium">Plan actual</th>
                          <th className="px-4 py-3 font-medium">Acción (Renovar)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clients.map((c) => (
                          <tr key={c.id} className="border-t border-border hover:bg-white/[0.02]">
                            <td className="px-4 py-3 font-medium">{c.email}</td>
                            <td className="px-4 py-3">
                              {c.planActive ? (
                                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                                  {c.planName}
                                </span>
                              ) : (
                                <span className="text-xs text-muted">Sin plan activo</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <DirectActivate planCosts={planCosts} balance={status.balance} clientId={c.id} onActivated={onClientPlanActivated} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'keys' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {keys.length > 0 ? (
                <div>
                  <p className="mb-2 text-sm font-medium">Tus claves generadas</p>
                  <KeysTable keys={keys} onRevoked={onKeyRevoked} />
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border bg-surface/30 p-8 text-center text-sm text-muted">
                  No has generado ninguna clave.
                </p>
              )}

              {transactions.length > 0 && (
                <div className="mt-8">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    <History className="size-4 text-muted" /> Historial de créditos
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-border bg-surface/50">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-surface/70 text-xs text-muted">
                        <tr>
                          <th className="px-4 py-3 font-medium">Movimiento</th>
                          <th className="px-4 py-3 font-medium">Créditos</th>
                          <th className="px-4 py-3 font-medium">Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((tx) => (
                          <tr key={tx.id} className="border-t border-border hover:bg-white/[0.02]">
                            <td className="px-4 py-3">
                              <span className="font-medium text-text/90">{tx.transaction_type}</span>
                              {tx.description && <span className="ml-2 text-xs text-muted">({tx.description})</span>}
                            </td>
                            <td className={`px-4 py-3 font-mono text-xs font-semibold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {tx.amount > 0 ? '+' : ''}{tx.amount}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted">{new Date(tx.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <GatewaysConfig initialGateways={status.license.gateways} />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

