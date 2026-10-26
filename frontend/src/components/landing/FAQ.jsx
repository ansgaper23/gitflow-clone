import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

// El contenido acá tiene que ser un espejo fiel del JSON-LD FAQPage en index.html — si un
// crawler ve una respuesta distinta a la marcada como structured data, Google puede ignorar
// o penalizar el rich snippet. Cambiá los dos juntos.
const FAQS = [
  {
    q: '¿Necesito saber programar para usar FlowPro?',
    a: 'No. Describís lo que querés en lenguaje natural y la IA escribe el código y lo aplica sola — la vista previa se actualiza al toque, sin que tengas que aprobar nada. En pedidos grandes de varias etapas, te va mostrando el avance y confirma con vos antes de seguir a la próxima.',
  },
  {
    q: '¿Qué pasa cuando se terminan los 30 minutos gratis?',
    a: 'Podés seguir viendo tu proyecto, pero para seguir chateando con la IA y publicar cambios nuevos necesitás activar un plan. No se te cobra nada automáticamente — no pedimos tarjeta para la prueba gratis.',
  },
  {
    q: '¿El código de mi app es mío?',
    a: 'Sí. Cada proyecto vive en un repositorio real de GitHub a tu nombre. Podés exportarlo, clonarlo o seguir editándolo vos mismo en cualquier momento, con o sin FlowPro.',
  },
  {
    q: '¿Necesito conectar GitHub para empezar?',
    a: 'No para arrancar — podés describir tu app y empezar a chatear con la IA de una. Conectás GitHub cuando quieras guardar el código en un repositorio propio.',
  },
  {
    q: '¿Puedo publicar mi sitio con un dominio propio?',
    a: 'Sí. Publicar tu app funciona con cualquier plan activo (o durante tu prueba gratis). Conectar un dominio propio en vez del que te da FlowPro requiere el plan de 30 días o superior.',
  },
  {
    q: '¿Puedo cancelar cuando quiera?',
    a: 'Sí, no hay contratos ni renovación forzada — elegís el plan por la duración que necesitás y listo.',
  },
]

function Item({ item, open, onToggle }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-surface/40 backdrop-blur-md">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="press flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-semibold text-text sm:text-base">{item.q}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="px-5 pb-4 text-sm text-muted">{item.a}</p>}
    </div>
  )
}

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <section className="relative z-10 mx-auto w-full max-w-3xl px-4 py-24">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-primary">Preguntas frecuentes</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Lo que la gente pregunta antes de empezar</h2>
      </div>

      <div className="space-y-3">
        {FAQS.map((item, i) => (
          <Item key={item.q} item={item} open={openIndex === i} onToggle={() => setOpenIndex(openIndex === i ? -1 : i)} />
        ))}
      </div>
    </section>
  )
}
