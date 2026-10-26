import { Code2, Rocket, GraduationCap, Users, Briefcase, Smartphone } from 'lucide-react'

// Casos de uso ilustrativos (no reseñas de usuarios reales) — muestran distintas formas de usar
// FlowPro sin fingir ser testimonios verificados de clientes.
const USE_CASES = [
  { icon: Code2, role: 'Freelancer con un cliente urgente', text: 'Le pedís que arregle un bug en el checkout y en minutos tenés el cambio aplicado y listo para mandar.' },
  { icon: Rocket, role: 'Fundador validando una idea', text: 'Cada cambio real queda commiteado en tu GitHub — podés probar tu idea en producción con historial completo de todo lo que se tocó.' },
  { icon: GraduationCap, role: 'Estudiante aprendiendo a programar', text: 'Cada propuesta de cambio es una clase real: ves exactamente qué se modificó y por qué.' },
  { icon: Users, role: 'Equipo chico sin dev de sobra', text: 'Se encarga de las tareas repetitivas para que el equipo se enfoque en lo que de verdad importa.' },
  { icon: Briefcase, role: 'Dueño de negocio sin saber programar', text: 'Pedís ajustes por chat y revisás el resultado con tu equipo, sin depender de nadie más.' },
  { icon: Smartphone, role: 'Contratista con varios clientes', text: 'El historial de conversación por proyecto te deja retomar cada uno sin perder el contexto.' },
]

function Card({ c }) {
  return (
    <div className="flex w-[300px] shrink-0 flex-col gap-3 rounded-2xl border border-white/[0.06] bg-surface/40 p-5 text-left backdrop-blur-md">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full brand-gradient text-slate-950">
          <c.icon className="size-4.5" />
        </span>
        <p className="text-sm font-semibold text-text">{c.role}</p>
      </div>
      <p className="text-sm text-muted">{c.text}</p>
    </div>
  )
}

const columns = [USE_CASES.slice(0, 2), USE_CASES.slice(2, 4), USE_CASES.slice(4, 6)]
const durations = ['32s', '38s', '35s']

export default function Testimonials() {
  return (
    <section className="relative z-10 py-24">
      <div className="mx-auto w-full max-w-7xl px-4">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold tracking-tight">
            Así usa la gente <span className="text-brand-gradient">FlowPro</span>
          </h2>
          <p className="mt-2 text-muted">Casos de uso típicos — desde un ajuste rápido hasta un producto entero.</p>
        </div>

        <div className="flex h-[520px] justify-center gap-6 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_88%,transparent)]">
          {columns.map((col, ci) => (
            <div key={ci} className={`w-[300px] shrink-0 ${ci > 0 ? 'hidden md:block' : ''}`}>
              <div
                className="flex flex-col gap-6 pb-6 animate-scroll-testimonials"
                style={{ animationDuration: durations[ci] }}
              >
                {[...col, ...col, ...col].map((c, i) => (
                  <Card key={i} c={c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
