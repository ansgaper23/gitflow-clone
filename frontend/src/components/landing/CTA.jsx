import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'

const REASONS = ['Sin tarjeta de crédito', 'Código real, tuyo en GitHub', 'Cancelás cuando quieras']

export default function CTA() {
  return (
    <section className="relative z-10 bg-gradient-to-b from-transparent to-primary/5 py-24">
      <div className="mx-auto w-full max-w-4xl px-4 text-center">
        <h2 className="mb-6 text-3xl font-bold tracking-[-0.01em] sm:text-4xl">
          Tu próxima app empieza con una frase
        </h2>
        <p className="mx-auto mb-6 max-w-2xl text-lg text-muted">
          Empieza a conversar con nuestra IA especializada en código — <strong className="text-text">30 minutos
          gratis</strong>. Conecta GitHub cuando quieras, tu proyecto sigue siendo tuyo.
        </p>

        <div className="mb-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {REASONS.map((r) => (
            <span key={r} className="flex items-center gap-1.5 text-sm text-muted">
              <Check className="size-3.5 text-primary" /> {r}
            </span>
          ))}
        </div>

        <Link
          to="/auth"
          className="press glow-brand inline-block rounded-lg brand-gradient px-10 py-3 text-lg font-semibold text-slate-950 transition-opacity hover:opacity-90"
        >
          Empezar gratis por 30 minutos
        </Link>
      </div>
    </section>
  )
}
