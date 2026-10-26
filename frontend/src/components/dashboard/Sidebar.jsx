import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bot, LayoutGrid, ShieldHalf, LogOut, Clock, X, Zap, Handshake, PenSquare, Search } from 'lucide-react'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../lib/api.js'
import { getProjectDisplayName } from '../../lib/projectUtils.js'
import ThemeToggle from '../ThemeToggle.jsx'
import { useTrialCountdown, formatCountdown } from '../TrialCountdown.jsx'

// En mobile es un drawer que se desliza sobre el contenido (open/onClose lo controla
// Dashboard.jsx, disparado por el botón de hamburguesa del header móvil); a partir de `md`
// vuelve a ser la barra lateral fija de siempre, siempre visible.
export default function Sidebar({ recentProjects = [], open = false, onClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const trialRemainingMs = useTrialCountdown(user?.trialActive ? user.trialExpiresAt : null)

  // No viene en el objeto "user" (la licencia vive en su propia tabla, no en "users") — se
  // consulta aparte, una sola vez, solo para decidir si mostrar el link.
  const [resellerActive, setResellerActive] = useState(false)
  useEffect(() => {
    api
      .resellerStatus()
      .then((s) => setResellerActive(s.active))
      .catch(() => {})
  }, [])

  const go = (path) => {
    onClose?.()
    navigate(path)
  }

  return (
    <>
      {open && (
        <div className="animate-overlay-in fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={onClose} />
      )}
      <aside
        className={`bg-amoled fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r dark:border-white/[0.06] border-black/5 p-3 transition-transform duration-300 [transition-timing-function:var(--ease-spring)] md:relative md:z-auto md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-2 py-2">
          <Link to="/dashboard" className="flex items-center gap-2" onClick={onClose}>
            <span className="flex size-7 items-center justify-center rounded-full brand-gradient">
              <Bot className="size-4 text-slate-950" />
            </span>
            <span className="font-semibold tracking-tight">
              Flow<span className="text-brand-gradient">Pro</span>
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button onClick={onClose} className="press flex size-7 items-center justify-center rounded-md text-muted hover:bg-white/5 md:hidden">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <nav className="mt-5 space-y-1">
          <button
            onClick={() => {
              onClose?.();
              navigate('/dashboard');
              setTimeout(() => {
                const el = document.querySelector('textarea');
                if (el) el.focus();
              }, 50);
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-white/80 hover:text-white hover:bg-white/5 transition-colors"
          >
            <PenSquare className="size-4 text-blue-400" />
            <span>Nuevo</span>
          </button>

          <button
            onClick={() => {
              onClose?.();
              const searchInput = document.querySelector('input[type="search"], input[placeholder*="Buscar"]');
              if (searchInput) searchInput.focus();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-white/80 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Search className="size-4 text-zinc-400" />
            <span>Buscar</span>
          </button>

          <button
            onClick={() => go('/dashboard')}
            className="flex w-full items-center gap-2.5 rounded-lg bg-blue-600/15 border border-blue-500/20 px-2.5 py-2 text-left text-sm font-semibold text-blue-400"
          >
            <LayoutGrid className="size-4 text-blue-400" />
            <span>Proyectos</span>
          </button>

          {(user?.isAdmin || user?.isCollaborator) && (
            <button
              onClick={() => go('/admin')}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-white/5 hover:text-text"
            >
              <ShieldHalf className="size-4" /> Admin
            </button>
          )}
          {resellerActive && (
            <button
              onClick={() => go('/reseller')}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-white/5 hover:text-text"
            >
              <Handshake className="size-4" /> Reseller
            </button>
          )}
        </nav>

        {recentProjects.length > 0 && (
          <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
            <p className="flex items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <Clock className="size-3" /> Recientes
            </p>
            <div className="mt-1.5 space-y-0.5">
              {recentProjects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => go(`/chat/${p.id}`)}
                  className="flex items-center justify-between w-full group rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-zinc-500 group-hover:text-blue-400 transition-colors">◇</span>
                    <span className="truncate">{getProjectDisplayName(p)}</span>
                  </div>
                  <span className="size-1.5 rounded-full bg-emerald-500/80 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"></span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto space-y-2 pt-3">
          {!user?.planActive &&
            (user?.trialActive && trialRemainingMs > 0 ? (
              <Link
                to="/account"
                onClick={onClose}
                className="block rounded-xl border border-primary/30 bg-primary/10 p-3 transition-colors hover:bg-primary/15"
              >
                <p className="flex items-center gap-1.5 text-xs font-bold text-primary">
                  <Zap className="size-3.5" /> Prueba gratis: {formatCountdown(trialRemainingMs)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">Elegí un plan antes de que termine</p>
              </Link>
            ) : (
              <Link
                to="/account"
                onClick={onClose}
                className="block rounded-xl border border-gold/30 bg-gold/10 p-3 transition-colors hover:bg-gold/15"
              >
                <p className="text-xs font-bold text-gold">Activar un plan</p>
                <p className="mt-0.5 text-[11px] text-muted">Desbloqueá el chat con la IA</p>
              </Link>
            ))}
          <Link
            to="/account"
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text"
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="size-6 shrink-0 rounded-full" referrerPolicy="no-referrer" />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold">
                {(user?.name || user?.email || '?')[0]?.toUpperCase()}
              </span>
            )}
            <span className="truncate">{user?.githubLogin || user?.name || user?.email}</span>
          </Link>
          <button
            onClick={() => {
              logout()
              navigate('/')
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted transition-colors hover:bg-white/5 hover:text-text"
          >
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </div>
      </aside>
    </>
  )
}
