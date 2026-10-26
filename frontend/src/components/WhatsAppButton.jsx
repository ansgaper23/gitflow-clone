import { MessageCircle } from 'lucide-react'

// Número de soporte de FlowPro. Si cambia, actualizar solo acá.
const SUPPORT_PHONE = '51936467898' // +51 936467898 (Perú)
const SUPPORT_MESSAGE = 'Hola, necesito ayuda con FlowPro.'

export default function WhatsAppButton() {
  const href = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(SUPPORT_MESSAGE)}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Soporte por WhatsApp"
      title="Soporte por WhatsApp"
      className="fixed bottom-5 right-5 z-50 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/20 transition-transform hover:scale-105 active:scale-95"
    >
      <MessageCircle className="size-7" fill="currentColor" strokeWidth={0} />
    </a>
  )
}
