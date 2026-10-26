import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { api } from '../../lib/api.js'

const FALLBACK_PLANS = [
  { id: '1d', name: '1 día de acceso', duration_days: 1, price_cents: 999, currency: 'USD', featured: false },
  { id: '7d', name: '7 días de acceso', duration_days: 7, price_cents: 1799, currency: 'USD', featured: false },
  { id: '15d', name: '15 días de acceso', duration_days: 15, price_cents: 2399, currency: 'USD', featured: false },
  { id: '30d', name: '30 días de acceso', duration_days: 30, price_cents: 3899, currency: 'USD', featured: true },
  { id: '90d', name: '3 meses de acceso', duration_days: 90, price_cents: 11599, currency: 'USD', featured: false },
]

// Lo mismo que ya aplica el backend al conectar un dominio propio (ver MIN_DOMAIN_PLAN_DAYS en
// routes/projects.js) — se repite acá el número, no la lógica, para no importar código de
// servidor al bundle del frontend por un solo entero.
const MIN_DOMAIN_PLAN_DAYS = 30

// Beneficios reales de cada plan, no relleno de marketing: los primeros tres los tiene
// cualquier plan pago, el dominio propio solo lo desbloquean los planes de 30 días o más
// (mismo límite que ya exige el backend en /projects/:id/domain).
function planBenefits(plan) {
  const benefits = ['Mensajes y generación con IA ilimitados', 'Publicación gratis en tu subdominio de FlowPro', 'Soporte por WhatsApp']
  if (plan.duration_days >= MIN_DOMAIN_PLAN_DAYS) benefits.push('Dominio propio (tu-marca.com)')
  return benefits
}

function formatPrice(cents, currency) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(cents / 100)
}

export default function Pricing() {
  const [plans, setPlans] = useState(FALLBACK_PLANS)

  useEffect(() => {
    api
      .plans()
      .then((data) => data?.length && setPlans(data))
      .catch(() => {})
  }, [])

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-28">
      <div className="mb-10 max-w-2xl">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-primary">Planes</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Elige el ideal para ti</h2>
        <p className="mt-3 text-muted">
          Programa con FlowPro y evoluciona tus proyectos con más autonomía. Empezá con 30 minutos gratis, sin
          tarjeta — elegí un plan solo si te sirvió.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative flex flex-col justify-between gap-6 rounded-2xl border p-6 text-center backdrop-blur-md transition-[transform,box-shadow,border-color] duration-300 [transition-timing-function:var(--ease-spring)] hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10 ${
              plan.featured ? 'border-gold ring-1 ring-gold/50 bg-surface/70' : 'border-white/[0.06] bg-surface/40'
            }`}
          >
            {plan.featured && (
              <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-gold px-6 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#3D2B00]">
                Más elegido
              </span>
            )}
            <div className="flex flex-1 flex-col justify-center gap-2 min-h-[70px]">
              <h3 className="text-base font-bold leading-tight sm:text-lg">{plan.name}</h3>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/90">Ilimitado</p>
            </div>
            <p className="text-4xl font-extrabold tracking-tighter tabular-nums">
              {formatPrice(plan.price_cents, plan.currency)}
            </p>
            <ul className="flex flex-col gap-1.5 text-left text-xs text-muted">
              {planBenefits(plan).map((benefit) => (
                <li key={benefit} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> {benefit}
                </li>
              ))}
            </ul>
            <Link
              to="/auth"
              className="mt-2 w-full rounded-md brand-gradient py-2 text-sm font-bold text-slate-950 transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Elegir plan
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
