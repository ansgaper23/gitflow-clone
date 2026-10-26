import { useEffect, useState } from 'react'
import { Copy, Loader2, X } from 'lucide-react'
import { api } from '../lib/api.js'

// Checkout de Yape/Plin (Perú): no hay confirmación automática (Yape/Plin no tienen API de
// cobro sin cuenta de negocio), así que este flujo es "paga por fuera y confirmá acá": muestra
// el QR/número, el usuario paga desde su propia app y pega el número de operación, y el pago
// queda "en revisión" hasta que un admin lo aprueba desde /admin (ver AdminPayments.jsx).
export default function YapePlinModal({ plan, onClose }) {
  const [checkout, setCheckout] = useState(null) // { paymentId, phone, qrUrl, amountUsd, amountPen }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [operationNumber, setOperationNumber] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .yapeCheckout(plan.id)
      .then((data) => {
        setCheckout(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const copyPhone = async () => {
    if (!checkout?.phone) return
    try {
      await navigator.clipboard.writeText(checkout.phone)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard puede fallar sin HTTPS/permiso; el número ya está visible para copiar a mano.
    }
  }

  const submitProof = async (e) => {
    e.preventDefault()
    if (!operationNumber.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await api.confirmYapePayment(checkout.paymentId, operationNumber.trim())
      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="animate-materialize-in w-full max-w-sm rounded-xl border border-border bg-surface p-5"
        style={{ '--materialize-origin': 'center' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Pagar con Yape / Plin</h3>
          <button onClick={onClose} className="text-muted hover:text-text">
            <X className="size-5" />
          </button>
        </div>

        {loading && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Preparando el pago…
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        {checkout && !submitted && (
          <>
            <p className="mt-1 text-sm text-muted">{plan.name}</p>
            <p className="mt-1 text-2xl font-bold">
              S/ {checkout.amountPen.toFixed(2)}
              <span className="ml-2 text-sm font-normal text-muted">≈ ${checkout.amountUsd.toFixed(2)} USD</span>
            </p>

            {checkout.qrUrl ? (
              <img src={checkout.qrUrl} alt="QR de Yape/Plin" className="mx-auto mt-4 w-48 rounded-lg border border-border" />
            ) : (
              <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Todavía no hay un QR cargado — pagá con el número de abajo desde tu app Yape o Plin.
              </p>
            )}

            <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
              <div>
                <p className="text-[11px] text-muted">Número de Yape/Plin</p>
                <p className="font-mono text-sm">{checkout.phone}</p>
              </div>
              <button onClick={copyPhone} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-white/5">
                <Copy className="size-3" /> {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>

            <form onSubmit={submitProof} className="mt-4">
              <label className="text-xs text-muted">Número de operación (lo ves en el comprobante de tu app)</label>
              <input
                value={operationNumber}
                onChange={(e) => setOperationNumber(e.target.value)}
                placeholder="Ej. 000123456"
                className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <button
                type="submit"
                disabled={submitting || !operationNumber.trim()}
                className="press mt-3 flex w-full items-center justify-center gap-2 rounded-md brand-gradient py-2 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? 'Enviando…' : 'Ya pagué, confirmar'}
              </button>
            </form>
          </>
        )}

        {submitted && (
          <div className="mt-6 rounded-md border border-primary/30 bg-primary/10 px-3 py-3 text-sm text-primary">
            Recibimos tu confirmación — estamos verificando el pago. Se activa apenas lo aprobamos, normalmente en poco
            tiempo. Podés cerrar esta ventana.
          </div>
        )}
      </div>
    </div>
  )
}
