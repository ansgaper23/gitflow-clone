import { Link } from 'react-router-dom'
import { Bot, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10 text-center">
      <Link to="/" className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-full brand-gradient">
          <Bot className="size-4 text-slate-950" />
        </span>
        <span className="text-lg font-semibold tracking-tight">FlowPro</span>
      </Link>

      <p className="brand-gradient bg-clip-text text-7xl font-black tracking-tight text-transparent">404</p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Esta página no existe</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        Revisá la URL o volvé al inicio para seguir construyendo tu proyecto.
      </p>

      <Link
        to="/"
        className="mt-8 flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-text/90 hover:bg-white/5"
      >
        <ArrowLeft className="size-3.5" />
        Volver al inicio
      </Link>
    </div>
  )
}
