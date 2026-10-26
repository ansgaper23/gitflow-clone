import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-primary/20 py-8 text-center text-sm text-muted">
      <div className="mx-auto max-w-6xl px-4">
        <div className="mb-4 flex justify-center gap-6">
          <Link to="/terminos" className="transition-colors hover:text-primary">Términos de Uso</Link>
          <Link to="/privacidad" className="transition-colors hover:text-primary">Política de Privacidad</Link>
          <a href="mailto:admin@flow-pro.online" className="transition-colors hover:text-primary">Contacto</a>
          <a
            href="https://wa.me/51936467898?text=Hola%2C%20necesito%20ayuda%20con%20FlowPro."
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-primary"
          >
            WhatsApp
          </a>
        </div>
        <p className="text-xs">FlowPro · {new Date().getFullYear()}</p>
      </div>
    </footer>
  )
}
