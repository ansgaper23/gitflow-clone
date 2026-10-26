import { useEffect, useMemo, useState } from 'react'
import { Search, Users, X } from 'lucide-react'
import { api } from '../../lib/api.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { SectionHeader, PlanBadge, UserActions } from '../../components/admin/AdminShared.jsx'

export default function AdminUsers() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [plans, setPlans] = useState([])
  const [grantSelection, setGrantSelection] = useState({})
  const [userBusyId, setUserBusyId] = useState(null)
  const [usersError, setUsersError] = useState(null)
  const [query, setQuery] = useState('')

  const loadUsers = () => {
    setUsersLoading(true)
    api
      .adminUsers()
      .then(setUsers)
      .catch((err) => setUsersError(err.message))
      .finally(() => setUsersLoading(false))
  }

  useEffect(() => {
    loadUsers()
    api.plans().then(setPlans).catch(() => {})
  }, [])

  const grantPlan = async (userId) => {
    const planId = grantSelection[userId] || plans[0]?.id
    if (!planId) return
    setUserBusyId(userId)
    setUsersError(null)
    try {
      const updated = await api.grantPlan(userId, planId)
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)))
    } catch (err) {
      setUsersError(err.message)
    } finally {
      setUserBusyId(null)
    }
  }

  const revokePlan = async (userId) => {
    setUserBusyId(userId)
    setUsersError(null)
    try {
      const updated = await api.revokePlan(userId)
      setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)))
    } catch (err) {
      setUsersError(err.message)
    } finally {
      setUserBusyId(null)
    }
  }

  const toggleCollaborator = async (u) => {
    setUserBusyId(u.id)
    setUsersError(null)
    try {
      const updated = await api.setCollaborator(u.id, !u.isCollaborator)
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)))
    } catch (err) {
      setUsersError(err.message)
    } finally {
      setUserBusyId(null)
    }
  }

  const impersonate = async (u) => {
    setUserBusyId(u.id)
    setUsersError(null)
    try {
      const { url } = await api.impersonateUser(u.id)
      window.open(url, '_blank')
    } catch (err) {
      setUsersError(err.message)
    } finally {
      setUserBusyId(null)
    }
  }

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      [u.name, u.email, u.githubLogin, u.id]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q)),
    )
  }, [users, query])

  return (
    <section>
      <SectionHeader
        icon={Users}
        title="Usuarios"
        description="Todos los usuarios registrados. Puedes activarles un plan manualmente, sin pasar por el pago."
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, email o usuario de GitHub…"
          className="w-full rounded-lg border border-border bg-surface px-9 py-2 text-sm outline-none focus:border-primary"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-text"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {usersError && (
        <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{usersError}</p>
      )}
      {usersLoading && <p className="text-sm text-muted">Cargando usuarios…</p>}
      {!usersLoading && filteredUsers.length === 0 && (
        <p className="text-sm text-muted">{query ? 'Ningún usuario coincide con la búsqueda.' : 'No hay usuarios registrados todavía.'}</p>
      )}

      {/* Tabla en desktop/tablet: entra cómodo y se lee de un vistazo. */}
      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface/70 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Usuario</th>
              <th className="px-3 py-2 font-medium">Login</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Mensajes</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <p className="font-medium">{u.name || u.githubLogin || u.email || u.id.slice(0, 8)}</p>
                  <p className="text-xs text-muted">{u.email}</p>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {u.isAdmin && (
                      <span className="inline-block rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        Admin
                      </span>
                    )}
                    {u.isCollaborator && (
                      <span className="inline-block rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                        Colaborador
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted">
                  {u.githubLogin && <p>GitHub: @{u.githubLogin}</p>}
                  {u.googleConnected && <p>Google conectado</p>}
                  {!u.githubLogin && !u.googleConnected && <p>Solo email</p>}
                </td>
                <td className="px-3 py-2">
                  <PlanBadge user={u} />
                </td>
                <td className="px-3 py-2 text-muted">{u.creditsUsed}</td>
                <td className="px-3 py-2">
                  <UserActions
                    u={u}
                    plans={plans}
                    grantSelection={grantSelection}
                    setGrantSelection={setGrantSelection}
                    userBusyId={userBusyId}
                    grantPlan={grantPlan}
                    revokePlan={revokePlan}
                    toggleCollaborator={toggleCollaborator}
                      impersonate={impersonate}
                    currentUser={currentUser}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarjetas en mobile: una tabla ancha de 5 columnas no entra ni scrolleando bien en
          pantallas angostas — cada fila se apila como su propia tarjeta con los mismos datos
          y las mismas acciones. */}
      <div className="grid gap-3 md:hidden">
        {filteredUsers.map((u) => (
          <div key={u.id} className="rounded-xl border border-border bg-surface/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{u.name || u.githubLogin || u.email || u.id.slice(0, 8)}</p>
                <p className="truncate text-xs text-muted">{u.email}</p>
              </div>
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {u.isAdmin && (
                  <span className="inline-block rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                    Admin
                  </span>
                )}
                {u.isCollaborator && (
                  <span className="inline-block rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                    Colaborador
                  </span>
                )}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>{u.githubLogin ? `GitHub: @${u.githubLogin}` : u.googleConnected ? 'Google conectado' : 'Solo email'}</span>
              <span>·</span>
              <span>{u.creditsUsed} mensajes</span>
            </div>

            <div className="mt-2">
              <PlanBadge user={u} />
            </div>

            <div className="mt-3 border-t border-border/70 pt-3">
              <UserActions
                u={u}
                plans={plans}
                grantSelection={grantSelection}
                setGrantSelection={setGrantSelection}
                userBusyId={userBusyId}
                grantPlan={grantPlan}
                revokePlan={revokePlan}
                toggleCollaborator={toggleCollaborator}
                      impersonate={impersonate}
                currentUser={currentUser}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
