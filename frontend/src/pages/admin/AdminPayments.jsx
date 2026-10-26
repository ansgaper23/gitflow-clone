import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Receipt, Loader2 } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { SectionHeader } from '../../components/admin/AdminShared.jsx'

const STATUS_STYLES = {
  paid: 'bg-emerald-500/10 text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-300',
  pending_review: 'bg-sky-500/10 text-sky-300',
  failed: 'bg-red-500/10 text-red-300',
}
const STATUS_LABELS = { paid: 'Pagado', pending: 'Pendiente', pending_review: 'A revisar', failed: 'Fallido' }

function paymentMethodLabel(p) {
  if (p.isAdminGrant) return 'Asignación manual'
  if (!p.paymentMethod) return '—'
  if (p.paymentMethod === 'card') return 'Tarjeta'
  if (p.paymentMethod === 'yape_plin') return 'Yape/Plin'
  if (p.paymentMethod === 'reseller_key') return 'Clave de reseller'
  return p.paymentMethod
}

function formatMoney(cents, currency) {
  return `${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${(currency || 'usd').toUpperCase()}`
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminPayments() {
  const { user: currentUser } = useAuth()
  const [payments, setPayments] = useState(null)
  const [error, setError] = useState(null)
  const [reviewing, setReviewing] = useState(null) // id del pago en curso de aprobar/rechazar

  const load = () =>
    api
      .adminPayments()
      .then(setPayments)
      .catch((err) => setError(err.message))

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const review = async (id, action) => {
    setReviewing(id)
    setError(null)
    try {
      if (action === 'approve') await api.adminApprovePayment(id)
      else await api.adminRejectPayment(id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setReviewing(null)
    }
  }

  // Financiero: mismo criterio que Planes y precios, solo admin completo.
  if (!currentUser?.isAdmin) return <Navigate to="/admin/usuarios" replace />

  const paid = (payments || []).filter((p) => p.status === 'paid')
  const totalsByCurrency = paid.reduce((acc, p) => {
    acc[p.currency] = (acc[p.currency] || 0) + p.amountCents
    return acc
  }, {})

  return (
    <section>
      <SectionHeader icon={Receipt} title="Ventas" description="Historial de compras de planes (Stripe y Yape/Plin)." />

      {error && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {payments === null && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </p>
      )}

      {payments && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
              <p className="text-[11px] text-muted">Ventas pagadas</p>
              <p className="text-lg font-semibold text-text">{paid.length}</p>
            </div>
            {Object.entries(totalsByCurrency).map(([currency, cents]) => (
              <div key={currency} className="rounded-xl border border-border bg-surface/60 px-4 py-3">
                <p className="text-[11px] text-muted">Total cobrado ({currency.toUpperCase()})</p>
                <p className="text-lg font-semibold text-emerald-400">{formatMoney(cents, currency)}</p>
              </div>
            ))}
          </div>

          {payments.length === 0 ? (
            <p className="text-sm text-muted">Todavía no hay ninguna venta registrada.</p>
          ) : (
            <>
              {/* Tabla en desktop/tablet */}
              <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface/70 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">ID de venta</th>
                      <th className="px-3 py-2 font-medium">Usuario</th>
                      <th className="px-3 py-2 font-medium">Plan</th>
                      <th className="px-3 py-2 font-medium">Monto</th>
                      <th className="px-3 py-2 font-medium">Método</th>
                      <th className="px-3 py-2 font-medium">Estado</th>
                      <th className="px-3 py-2 font-medium">Fecha</th>
                      <th className="px-3 py-2 font-medium">Revisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <span title={p.id} className="font-mono text-xs text-muted">
                            {p.id.slice(0, 8)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <p className="font-medium">{p.userName || '—'}</p>
                          <p className="text-xs text-muted">{p.userEmail || '—'}</p>
                        </td>
                        <td className="px-3 py-2 text-muted">{p.planName || p.planId || '—'}</td>
                        <td className="px-3 py-2 font-mono">{formatMoney(p.amountCents, p.currency)}</td>
                        <td className="px-3 py-2 text-muted">
                          {p.isAdminGrant ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Asignación manual</span>
                          ) : (
                            paymentMethodLabel(p)
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] || 'bg-white/5 text-muted'}`}>
                            {STATUS_LABELS[p.status] || p.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">{formatDate(p.createdAt)}</td>
                        <td className="px-3 py-2">
                          {p.status === 'pending_review' ? (
                            <div className="flex flex-col gap-1">
                              {p.operationNumber && (
                                <span className="font-mono text-[11px] text-muted" title="Número de operación">
                                  Op. {p.operationNumber}
                                </span>
                              )}
                              <div className="flex gap-1">
                                <button
                                  onClick={() => review(p.id, 'approve')}
                                  disabled={reviewing === p.id}
                                  className="press rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                                >
                                  Aprobar
                                </button>
                                <button
                                  onClick={() => review(p.id, 'reject')}
                                  disabled={reviewing === p.id}
                                  className="press rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                                >
                                  Rechazar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas en mobile */}
              <div className="grid gap-3 md:hidden">
                {payments.map((p) => (
                  <div key={p.id} className="rounded-xl border border-border bg-surface/60 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.userName || '—'}</p>
                        <p className="truncate text-xs text-muted">{p.userEmail || '—'}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] || 'bg-white/5 text-muted'}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted">
                      <span>{p.planName || p.planId || '—'}</span>
                      <span className="font-mono text-text">{formatMoney(p.amountCents, p.currency)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                      <span title={p.id} className="font-mono">{p.id.slice(0, 8)}</span>
                      <span className={p.isAdminGrant ? 'font-medium text-primary' : ''}>{paymentMethodLabel(p)}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">{formatDate(p.createdAt)}</p>
                    {p.status === 'pending_review' && (
                      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
                        {p.operationNumber && <span className="font-mono text-[11px] text-muted">Op. {p.operationNumber}</span>}
                        <div className="flex gap-1">
                          <button
                            onClick={() => review(p.id, 'approve')}
                            disabled={reviewing === p.id}
                            className="press rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400 disabled:opacity-50"
                          >
                            Aprobar
                          </button>
                          <button
                            onClick={() => review(p.id, 'reject')}
                            disabled={reviewing === p.id}
                            className="press rounded-md bg-red-500/10 px-2 py-1 text-xs font-medium text-red-300 disabled:opacity-50"
                          >
                            Rechazar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
