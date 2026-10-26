import { MessageSquareText, Code2, Server, Shield } from 'lucide-react'

const FEATURES = [
  {
    icon: MessageSquareText,
    title: 'Tú aportas la idea. FlowPro le da vida.',
    text: 'Describe lo que quieres en lenguaje sencillo. Mira cómo FlowPro crea software listo para producción contigo en tiempo real.',
    span: 'col-span-1 md:col-span-2',
    bgColor: 'bg-white/5'
  },
  {
    icon: Code2,
    title: 'Perfecciona tu diseño',
    text: 'Itera sobre tu creación hasta que el resultado final te convenza.',
    span: 'col-span-1 md:col-span-1',
    bgColor: 'bg-white/5'
  },
  {
    icon: Server,
    title: 'Alojamiento, resuelto',
    text: 'FlowPro se encarga del alojamiento, el SSL y la infraestructura de backend. Tu código y tus datos siguen siendo tuyos. Siempre.',
    span: 'col-span-1 md:col-span-1',
    bgColor: 'bg-white/10'
  },
  {
    icon: Shield,
    title: 'Seguro y protegido, de serie',
    text: 'Satisface los requisitos de seguridad y cumplimiento normativo con análisis automáticos y registros.',
    span: 'col-span-1 md:col-span-2',
    bgColor: 'bg-primary/20'
  },
]

export default function HowItWorks() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-4 py-24 sm:py-32">
      <div className="mb-16 text-center">
        <h2 className="mt-3 text-[2.5rem] font-semibold tracking-tight text-white sm:text-[3.5rem] leading-[1.1]">
          Una sola plataforma. <br />
          Posibilidades infinitas.
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-[1.1rem] text-white/70">
          Cuenta con FlowPro de principio a fin: desde el alojamiento y la autenticación hasta las integraciones.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {FEATURES.map((feature, i) => (
          <div
            key={i}
            className={`group relative overflow-hidden rounded-[2rem] border border-white/10 ${feature.bgColor} p-10 transition-all hover:bg-white/10 backdrop-blur-md ${feature.span}`}
          >
            <div className="relative z-10">
              <div className="mb-8 inline-flex size-14 items-center justify-center rounded-2xl bg-white/10 shadow-[0_2px_10px_rgba(0,0,0,0.2)] border border-white/20">
                <feature.icon className="size-6 text-white" />
              </div>
              <h3 className="mb-4 text-2xl font-semibold text-white">{feature.title}</h3>
              <p className="text-[15px] text-white/70 leading-relaxed max-w-md">{feature.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
