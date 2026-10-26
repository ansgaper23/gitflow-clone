import { useEffect, useState } from 'react'
import { Handshake, Plus, Coins } from 'lucide-react'
import { api } from '../../lib/api.js'
import { SectionHeader } from '../../components/admin/AdminShared.jsx'

// Otorgar una licencia (a un usuario ya existente, buscado por email) — Fase 1 no tiene
// selector de usuarios reusable en /admin todavía, así que se busca por email acá mismo.
function GrantLicenseForm({ users, onGranted }) {
  const [email, setEmail] = useState('')
  const [tier, setTier] = useState('basico')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    const target = users.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase())
    if (!target) {
      setError('No hay ningún usuario registrado con ese email')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const license = await api.adminGrantResellerLicense(target.id, { tier })
      onGranted({ ...license, email: target.email, name: target.name, githubLogin: target.githubLogin })
      setEmail('')
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface/60 p-4">
      <div className="min-w-0 flex-1">
        <label className="text-xs text-muted">Email del usuario</label>
        <input
          type="email"
          required
          list="reseller-user-emails"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="reseller@ejemplo.com"
          className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
        />
        {/* Predictivo: como "users" ya está cargado en memoria para el lookup del submit, se
            reusa acá para sugerir mientras se escribe — sin pegarle a ningún endpoint nuevo. */}
        <datalist id="reseller-user-emails">
          {users.map((u) => (
            <option key={u.id} value={u.email}>
              {u.name || u.githubLogin || u.email}
            </option>
          ))}
        </datalist>
      </div>
      <div>
        <label className="text-xs text-muted">Tier</label>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="mt-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
        >
          <option value="basico">Básico</option>
          <option value="white_label">White-label</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="press flex items-center gap-1.5 rounded-md brand-gradient px-3 py-1.5 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <Plus className="size-3.5" /> Otorgar licencia
      </button>
      {error && <p className="w-full text-xs text-red-300">{error}</p>}
    </form>
  )
}

function CreditsButton({ userId, onGranted }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('10')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const n = parseInt(amount, 10)
    if (!Number.isInteger(n) || n === 0 || busy) return
    setBusy(true)
    try {
      const { balance } = await api.adminGrantResellerCredits(userId, n)
      onGranted(userId, balance)
      setOpen(false)
    } catch {
      // el error queda visible en el balance sin actualizar; suficiente para Fase 1
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-xs text-primary hover:underline">
        <Coins className="size-3.5" /> Cargar créditos
      </button>
    )
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-16 rounded-md border border-border bg-background px-1.5 py-1 text-xs outline-none focus:border-primary"
      />
      <button onClick={submit} disabled={busy} className="press rounded-md brand-gradient px-2 py-1 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90">
        OK
      </button>
      <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-text">
        x
      </button>
    </div>
  )
}

function PlanCostsSection() {
  const [costs, setCosts] = useState([])
  const [edits, setEdits] = useState({})
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    api.adminResellerPlanCosts().then(setCosts).catch(() => {})
  }, [])

  const save = async (planId) => {
    const raw = edits[planId]
    const n = parseInt(raw, 10)
    if (!Number.isInteger(n) || n <= 0) return
    setBusyId(planId)
    try {
      await api.adminSetResellerPlanCost(planId, n)
      setCosts((prev) => prev.map((c) => (c.planId === planId ? { ...c, creditCost: n } : c)))
      setEdits((prev) => {
        const next = { ...prev }
        delete next[planId]
        return next
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-6">
      <p className="mb-2 text-sm font-medium">Costo en créditos por plan</p>
      <p className="mb-3 text-xs text-muted">
        Un plan sin costo definido todavía no aparece como opción para que un reseller lo active.
      </p>
      <div className="space-y-2">
        {costs.map((c) => (
          <div key={c.planId} className="flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm">
              {c.name} <span className="text-xs text-muted">({c.durationDays} días)</span>
            </span>
            <input
              type="number"
              min="1"
              value={edits[c.planId] ?? c.creditCost ?? ''}
              onChange={(e) => setEdits((prev) => ({ ...prev, [c.planId]: e.target.value }))}
              placeholder="créditos"
              className="w-24 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
            />
            <button
              onClick={() => save(c.planId)}
              disabled={busyId === c.planId || edits[c.planId] === undefined}
              className="press rounded-md brand-gradient px-2.5 py-1 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminResellers() {
  const [resellers, setResellers] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)

  const load = () => {
    api.adminResellers().then(setResellers).catch((err) => setError(err.message))
    api.adminUsers().then(setUsers).catch(() => {})
  }
  useEffect(load, [])

  const onGranted = (license) => setResellers((prev) => [license, ...prev.filter((r) => r.userId !== license.userId)])
  const onCreditsGranted = (userId, balance) => setResellers((prev) => prev.map((r) => (r.userId === userId ? { ...r, balance } : r)))

  return (
    <section>
      <SectionHeader icon={Handshake} title="Resellers" description="Fase 1: licencias y créditos se cargan a mano (sin Stripe todavía)." />

      {error && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      <GrantLicenseForm users={users} onGranted={onGranted} />

      <div className="mt-4 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/70 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Reseller</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Créditos</th>
              <th className="px-3 py-2 font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {resellers.map((r) => (
              <tr key={r.userId} className="border-t border-border">
                <td className="px-3 py-2">{r.name || r.githubLogin || r.email}</td>
                <td className="px-3 py-2 text-muted">{r.tier === 'white_label' ? 'White-label' : 'Básico'}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      r.status === 'active' ? 'bg-primary/15 text-primary' : 'bg-red-500/15 text-red-300'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2">{r.balance}</td>
                <td className="px-3 py-2">
                  <CreditsButton userId={r.userId} onGranted={onCreditsGranted} />
                </td>
              </tr>
            ))}
            {resellers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">
                  Todavía no hay ningún reseller.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PlanCostsSection />
    </section>
  )
}
