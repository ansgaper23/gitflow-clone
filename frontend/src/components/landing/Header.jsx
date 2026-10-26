import { Link } from 'react-router-dom'
import { Bot } from 'lucide-react'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-transparent backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-r from-[#4F88FF] to-[#FB65C2]">
            <Bot className="size-4 text-white" />
          </span>
          <span className="font-semibold tracking-tight text-white">
            Flow<span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4F88FF] to-[#FB65C2]">Pro</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="press rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10"
          >
            Entrar
          </Link>
          <Link
            to="/auth"
            className="press rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 shadow-[0_0_15px_rgba(255,255,255,0.3)]"
          >
            Empezar GRATIS
          </Link>
        </div>
      </div>
    </header>
  )
}
