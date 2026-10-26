import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { DollarSign } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { SectionHeader } from '../../components/admin/AdminShared.jsx'

export default function AdminPlans() {
  const { user: currentUser } = useAuth()
  const [plans, setPlans] = useState([])
  const [planPriceEdits, setPlanPriceEdits] = useState({})
  const [planBusyId, setPlanBusyId] = useState(null)
  const [plansError, setPlansError] = useState(null)

  useEffect(() => {
    api.plans().then(setPlans).catch(() => {})
  }, [])

  const savePlanPrice = async (plan) => {
    const raw = planPriceEdits[plan.id]
    if (raw === undefined || raw === '') return
    const cents = Math.round(Number(raw) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      setPlansError('Precio inválido')
      return
    }
    setPlanBusyId(plan.id)
    setPlansError(null)
    try {
      const updated = await api.updatePlan(plan.id, { price_cents: cents })
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? updated : p)))
      setPlanPriceEdits((prev) => {
        const next = { ...prev }
        delete next[plan.id]
        return next
      })
    } catch (err) {
      setPlansError(err.message)
    } finally {
      setPlanBusyId(null)
    }
  }

  // Precios: solo admin completo (mismo criterio que ya tenía esta sección cuando vivía
  // apilada dentro de la página única de /admin).
  if (!currentUser?.isAdmin) return <Navigate to="/admin/usuarios" replace />

  return (
    <section>
      <SectionHeader icon={DollarSign} title="Planes y precios" description="Precio que se cobra por Stripe al comprar cada plan." />

      {plansError && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{plansError}</p>
      )}

      {/* Tabla en desktop/tablet */}
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/70 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Duración</th>
              <th className="px-3 py-2 font-medium">Precio ({plans[0]?.currency || 'USD'})</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted">{p.id}</p>
                </td>
                <td className="px-3 py-2 text-muted">{p.duration_days} día(s)</td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={planPriceEdits[p.id] ?? (p.price_cents / 100).toFixed(2)}
                    onChange={(e) => setPlanPriceEdits((s) => ({ ...s, [p.id]: e.target.value }))}
                    className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary"
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => savePlanPrice(p)}
                    disabled={planBusyId === p.id || planPriceEdits[p.id] === undefined}
                    className="press rounded-md brand-gradient px-2 py-1 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Guardar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas en mobile */}
      <div className="grid gap-3 md:hidden">
        {plans.map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-surface/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted">
                  {p.id} · {p.duration_days} día(s)
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs text-muted">{plans[0]?.currency || 'USD'}</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={planPriceEdits[p.id] ?? (p.price_cents / 100).toFixed(2)}
                onChange={(e) => setPlanPriceEdits((s) => ({ ...s, [p.id]: e.target.value }))}
                className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary"
              />
              <button
                onClick={() => savePlanPrice(p)}
                disabled={planBusyId === p.id || planPriceEdits[p.id] === undefined}
                className="press ml-auto rounded-md brand-gradient px-3 py-1.5 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Guardar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
