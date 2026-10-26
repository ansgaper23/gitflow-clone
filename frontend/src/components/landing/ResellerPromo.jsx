import { Rocket, HandCoins, Users, Zap, Briefcase } from 'lucide-react'
import { Link } from 'react-router-dom'

const BENEFITS = [
  {
    icon: HandCoins,
    title: 'Hasta 80% de rentabilidad',
    text: 'Comprá los créditos a precio mayorista y revéndelos al precio que tú decidas. Tú pones las reglas.',
  },
  {
    icon: Zap,
    title: 'Tu propia pasarela',
    text: 'Cobrá directamente a tus clientes mediante tus propios enlaces de MercadoPago, Yape, Stripe o Hotmart.',
  },
  {
    icon: Users,
    title: 'Dueño de tus clientes',
    text: 'Los usuarios que invites quedan vinculados a ti de por vida mediante un Link Mágico de referido único.',
  },
  {
    icon: Briefcase,
    title: 'Panel Exclusivo',
    text: 'Gestioná tus licencias, revisá el estado de tus invitaciones y mantén el control desde un dashboard dedicado.',
  },
]

export default function ResellerPromo() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-4 py-14 sm:py-28">
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-surface/40 p-6 backdrop-blur-md sm:p-12 md:p-16">
        {/* Glow accent */}
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-[100px]" />
        
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="relative z-10">
            <div className="mb-6 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-primary">
              <Rocket className="size-3.5" /> Nuevo Programa
            </div>
            
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Conviértete en <span className="text-brand-gradient">Socio de FlowPro</span> y escala tus ingresos
            </h2>
            
            <p className="mt-4 text-lg text-muted">
              Únete a nuestro programa de Resellers y obtén márgenes de rentabilidad inigualables comercializando nuestra tecnología de Inteligencia Artificial.
            </p>
            
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/reseller"
                className="press flex items-center gap-2 rounded-full brand-gradient px-6 py-3 text-sm font-bold text-slate-950 transition-opacity hover:opacity-90"
              >
                Solicitar Acceso
              </Link>
            </div>
          </div>
          
          <div className="relative z-10 grid gap-4 sm:grid-cols-2">
            {BENEFITS.map((b, i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-2xl border border-white/[0.04] bg-white/[0.02] p-5 transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <b.icon className="size-5" />
                </div>
                <h3 className="font-semibold text-text/90">{b.title}</h3>
                <p className="leading-relaxed text-muted text-sm">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
