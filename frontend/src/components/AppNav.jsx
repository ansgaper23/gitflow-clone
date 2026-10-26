import { Link, useNavigate } from 'react-router-dom'
import { Bot, Handshake, LogOut, ShieldHalf, Settings, BrainCircuit } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import ThemeToggle from './ThemeToggle.jsx'

export default function AppNav() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <Link to="/dashboard" className="flex shrink-0 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full brand-gradient">
          <Bot className="size-4 text-slate-950" />
        </span>
        <span className="font-semibold tracking-tight">
          Flow<span className="text-brand-gradient">Pro</span>
        </span>
      </Link>

      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <ThemeToggle />
        
        <Link to="/agentes" className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-text">
          <BrainCircuit className="size-4" />
          <span className="hidden sm:inline">Agentes</span>
        </Link>
        <Link to="/preferencias" className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-text">
          <Settings className="size-4" />
          <span className="hidden sm:inline">Preferencias</span>
        </Link>

        {(user?.isAdmin || user?.isCollaborator) && (
          <Link to="/admin" className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-text">
            <ShieldHalf className="size-4" />
            <span className="hidden sm:inline">Admin</span>
          </Link>
        )}
        {user?.isReseller && (
          <Link to="/reseller" className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-text">
            <Handshake className="size-4" />
            <span className="hidden sm:inline">Reseller</span>
          </Link>
        )}
        <Link to="/account" className="flex min-w-0 items-center gap-2 text-sm text-muted hover:text-text">
          {user?.avatarUrl && (
            <img src={user.avatarUrl} alt="" className="size-6 shrink-0 rounded-full" referrerPolicy="no-referrer" />
          )}
          <span className="max-w-[6rem] truncate sm:max-w-[10rem]">{user?.githubLogin || user?.name || user?.email}</span>
        </Link>
        <button
          onClick={() => {
            logout()
            navigate('/')
          }}
          className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-text"
          title="Cerrar sesión"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  )
}
