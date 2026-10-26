import { Link } from 'react-router-dom'
import { Wallet, Hourglass, Lock, ArrowRight } from 'lucide-react'

const PAINS = [
  {
    icon: Wallet,
    title: 'Cotizaciones que dan miedo',
    text: 'Un freelancer o una agencia te cobra cientos o miles de dólares por un sitio básico — y eso antes de discutir el primer cambio.',
  },
  {
    icon: Hourglass,
    title: 'Semanas de espera',
    text: 'Mientras tu web sigue "en desarrollo", tu competencia ya está arriba, captando a los clientes que deberían ser tuyos.',
  },
  {
    icon: Lock,
    title: 'No sabés programar',
    text: 'Las herramientas "sin código" te encierran: el día que necesitás algo distinto, no podés — dependés de ellas para siempre.',
  },
]

export default function Pain() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-5xl px-4 py-24">
      <div className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">¿Te suena familiar?</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Tener presencia online <span className="text-brand-gradient">no debería doler tanto</span>
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PAINS.map((p) => (
          <div
            key={p.title}
            className="rounded-2xl border border-white/[0.06] bg-surface/40 p-6 text-left backdrop-blur-md transition-[transform,box-shadow,border-color] duration-300 [transition-timing-function:var(--ease-spring)] hover:-translate-y-1 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/10"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
              <p.icon className="size-5" />
            </span>
            <h3 className="mt-4 text-base font-bold text-text">{p.title}</h3>
            <p className="mt-1.5 text-sm text-muted">{p.text}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center sm:p-8">
        <p className="text-lg font-semibold text-text sm:text-xl">
          Con FlowPro se lo describís a la IA por chat y en minutos tenés tu app funcionando — con base de
          datos real y código real, tuyo en GitHub.
        </p>
        <p className="mt-1.5 text-sm text-muted">Sin depender de nadie. Sin esperar a nadie.</p>
        <Link
          to="/auth"
          className="press glow-brand mt-5 inline-flex items-center gap-1.5 rounded-md brand-gradient px-6 py-2.5 text-sm font-semibold text-slate-950 transition-opacity hover:opacity-90"
        >
          Empezar gratis por 30 minutos <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  )
}
