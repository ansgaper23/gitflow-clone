import { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { Users, DollarSign, Zap, Receipt, Handshake, Server, Menu, X } from 'lucide-react'
import AppNav from '../../components/AppNav.jsx'
import { useAuth } from '../../context/AuthContext.jsx'

const TABS = [
  { to: '/admin/usuarios', label: 'Usuarios', icon: Users, adminOnly: false },
  { to: '/admin/precios', label: 'Planes y precios', icon: DollarSign, adminOnly: true },
  { to: '/admin/ventas', label: 'Ventas', icon: Receipt, adminOnly: true },
  { to: '/admin/ia', label: 'Cuentas de IA', icon: Zap, adminOnly: true },
  { to: '/admin/resellers', label: 'Resellers', icon: Handshake, adminOnly: false },
  { to: '/admin/sistema', label: 'Sistema', icon: Server, adminOnly: true },
]

// Layout compartido de /admin: encabezado + pestañas + la página activa (Outlet). Cada sección
// vive en su propia ruta en vez de las tres apiladas en una sola pantalla.
export default function AdminLayout() {
  const { user: currentUser } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const tabs = TABS.filter((t) => !t.adminOnly || currentUser?.isAdmin)
  const activeTab = tabs.find((t) => location.pathname.startsWith(t.to)) || tabs[0]

  return (
    <div className="min-h-screen bg-aurora">
      <AppNav />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">Panel de administración</h1>
        <p className="mt-1 text-sm text-muted">
          {currentUser?.isAdmin
            ? 'Gestiona los usuarios registrados, los precios de los planes y las cuentas de IA que usa el agente.'
            : 'Gestiona los usuarios registrados: puedes activarles o revocarles un plan.'}
        </p>

        {/* Celular: la fila de pestañas de abajo no entra sin deformar la página — se reemplaza
            por un botón que despliega las secciones apiladas verticalmente. */}
        <div className="relative mt-6 sm:hidden">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2.5 text-sm font-medium"
          >
            <span className="flex items-center gap-1.5">
              {activeTab && <activeTab.icon className="size-3.5 text-primary" />} {activeTab?.label}
            </span>
            {menuOpen ? <X className="size-4 text-muted" /> : <Menu className="size-4 text-muted" />}
          </button>
          {menuOpen && (
            <nav className="mt-1 space-y-0.5 rounded-lg border border-border bg-surface p-1.5 shadow-lg">
              {tabs.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-medium ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-white/5 hover:text-text'
                    }`
                  }
                >
                  <t.icon className="size-3.5" /> {t.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>

        {/* Tablet/desktop: pestañas horizontales de siempre. */}
        <nav className="mt-6 hidden gap-1 overflow-x-auto border-b border-border sm:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text'
                }`
              }
            >
              <t.icon className="size-3.5" /> {t.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
