import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function LegalLayout({ title, updated, children }) {
  return (
    <div className="min-h-screen bg-aurora">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-16">
        <Link to="/" className="press inline-flex items-center gap-1.5 text-sm text-muted hover:text-text">
          <ArrowLeft className="size-4" /> Volver a FlowPro
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">Última actualización: {updated}</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-text/90 sm:text-base">
          {children}
        </div>
      </div>
    </div>
  )
}
