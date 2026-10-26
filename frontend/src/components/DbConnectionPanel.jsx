import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { Database, X, Loader2, Zap, ChevronDown, Server } from 'lucide-react'
import { api } from '../lib/api.js'

// Nombre de cada tipo de conexión, para textos de UI — y el prompt que le pedimos a la IA
// cuando el usuario CAMBIA de una a otra: el código real del proyecto (src/lib/supabase.js
// para Supabase, src/lib/db.js para Flow Cloud) no se actualiza solo con cambiar la conexión
// acá — alguien tiene que pedirle a la IA que lo migre, si no la app sigue hablando con la
// base vieja aunque el panel ya diga "conectado" a la nueva.
function describeConnType(type) {
  return type === 'oauth' ? 'Supabase' : type === 'vps' ? 'Flow Cloud (automática)' : 'una conexión manual'
}

function migrationPrompt(targetType) {
  if (targetType === 'oauth') {
    return 'Cambié la base de datos conectada de este proyecto a Supabase. Migrá el código de datos para que use "src/lib/supabase.js" (supabase-js) — reemplazá cualquier uso de "src/lib/db.js" y borralo si ya no lo usa nada.'
  }
  if (targetType === 'vps') {
    return 'Cambié la base de datos conectada de este proyecto a Flow Cloud (la base de datos automática de FlowPro). Migrá el código de datos para que use "src/lib/db.js" (mismo patrón de uso que supabase-js: "db.from(\'tabla\').select()", y "auth.signUp/signIn" si el proyecto maneja cuentas de usuario) — reemplazá cualquier uso de "@supabase/supabase-js" o "src/lib/supabase.js" y borralos si ya no los usa nada. Recreá con "propose_db_change" las tablas que hagan falta si todavía no existen en esta base.'
  }
  return 'Cambié la base de datos conectada de este proyecto por una conexión manual. Revisá qué cliente/queries usa el código actualmente y decime si hace falta ajustar algo para que siga funcionando con la conexión nueva.'
}

export default function DbConnectionPanel({ projectId, repoFullName, onMatchResult, onSendPrompt }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [connection, setConnection] = useState(undefined) // undefined = cargando, null = sin conectar
  const [oauthStatus, setOauthStatus] = useState(null) // { oauthAvailable, connected }
  const [vpsAvailable, setVpsAvailable] = useState(false)
  const [creatingVpsDb, setCreatingVpsDb] = useState(false)
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState(null) // { top, right } en coordenadas de viewport
  const [showManual, setShowManual] = useState(false)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const [projects, setProjects] = useState(null) // null = no cargados, [] = cargando/lista
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [startingOauth, setStartingOauth] = useState(false)
  // Un usuario puede tener VARIAS cuentas de Supabase vinculadas (una propia, una de un
  // cliente, etc.) — "accounts" es esa lista, "activeAccountId" cuál de ellas está mostrando
  // los "projects" de arriba, y "showNewAccountLabel" el mini-form para ponerle nombre a una
  // cuenta ANTES de salir a vincularla (así vuelve identificada, no como "Cuenta N" a secas).
  const [accounts, setAccounts] = useState(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [activeAccountId, setActiveAccountId] = useState(null)
  const [showNewAccountLabel, setShowNewAccountLabel] = useState(false)
  const [newAccountLabel, setNewAccountLabel] = useState('')

  const [label, setLabel] = useState('Base de datos')
  const [connectionString, setConnectionString] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Cuando ya hay una conexión y el usuario elige OTRO tipo: se guarda acá la acción elegida en
  // vez de ejecutarla al toque, hasta que confirme "Cambiar conexión" (o "Mantener" la cancela).
  const [pendingSwitch, setPendingSwitch] = useState(null) // { targetType, run }

  const load = useCallback(async () => {
    onMatchResult?.(null)
    try {
      const conn = await api.dbConnection(repoFullName)
      setConnection(conn)
      if (conn) {
        api
          .dbMatchCheck(repoFullName)
          .then(onMatchResult)
          .catch(() => {})
      }
    } catch {
      setConnection(null)
    }
    api
      .supabaseOAuthStatus()
      .then(setOauthStatus)
      .catch(() => setOauthStatus({ oauthAvailable: false, connected: false }))
    api
      .vpsDbStatus()
      .then((s) => setVpsAvailable(s.available))
      .catch(() => setVpsAvailable(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoFullName])

  useEffect(() => {
    load()
  }, [load])

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true)
    setError(null)
    try {
      const list = await api.supabaseAccounts()
      setAccounts(list)
      return list
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
      return []
    } finally {
      setLoadingAccounts(false)
    }
  }, [])

  const loadProjectsFor = useCallback(async (accountId) => {
    setLoadingProjects(true)
    setError(null)
    try {
      const list = await api.supabaseProjects(accountId)
      setActiveAccountId(accountId)
      setProjects(list)
      openMenu()
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setLoadingProjects(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (searchParams.get('supabase_connected') === '1') {
      // Si el redirect trae "supabase_account_id" es porque se acaba de vincular una cuenta
      // NUEVA (ver routes/supabaseAuth.js#callback) — se salta el paso de elegirla y va directo
      // a mostrar sus proyectos, como si hubiera sido siempre la única.
      const newAccountId = searchParams.get('supabase_account_id')
      setSearchParams((p) => {
        p.delete('supabase_connected')
        p.delete('supabase_account_id')
        return p
      }, { replace: true })
      setShowNewAccountLabel(false)
      load()
      if (newAccountId) loadProjectsFor(newAccountId)
    }
    const oauthErr = searchParams.get('supabase_error')
    if (oauthErr) {
      setError(`No se pudo conectar con Supabase (${oauthErr})`)
      setSearchParams((p) => {
        p.delete('supabase_error')
        return p
      }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // El menú se renderiza en un portal a document.body, con posición fija calculada acá —
  // así queda SIEMPRE por encima del iframe de la vista previa. Un iframe es su propia capa
  // de composición en el navegador: por más z-index que tenga un elemento normal, si ambos
  // están en el mismo contenedor el iframe puede seguir pintándose arriba. Portal + fixed
  // evita depender de esa jerarquía de stacking por completo.
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onClickOutside = (e) => {
      if (menuRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      close()
    }
    document.addEventListener('mousedown', onClickOutside)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // Sin ninguna cuenta vinculada todavía: pide un nombre y sale directo a Supabase (mismo "1
  // clic" de siempre). Con una sola cuenta: la usa derecho, sin hacer elegir de una lista de 1.
  // Con 2+: muestra el selector de cuentas (ver el menú más abajo).
  const connectOneClick = async () => {
    setError(null)
    if (oauthStatus?.connected) {
      const list = accounts ?? (await loadAccounts())
      if (list.length === 1) {
        loadProjectsFor(list[0].id)
      } else {
        openMenu()
      }
      return
    }
    setNewAccountLabel('')
    setShowNewAccountLabel(true)
    openMenu()
  }

  // Vuelve de "elegir proyecto" a "elegir cuenta" — sin esto, con una sola cuenta vinculada
  // (el caso más común, incluida toda cuenta migrada del vínculo global viejo) nunca se llega
  // al botón "Vincular otra cuenta": connectOneClick salta derecho a sus proyectos.
  const backToAccounts = async () => {
    setProjects(null)
    setError(null)
    await loadAccounts()
  }

  const startNewAccountOAuth = async () => {
    setError(null)
    setStartingOauth(true)
    try {
      const { url } = await api.supabaseLoginUrl(projectId, newAccountLabel.trim())
      window.location.href = url
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
      setStartingOauth(false)
    }
  }

  const pickProject = async (project, { migrate } = {}) => {
    setSaving(true)
    setError(null)
    try {
      await api.connectDb(repoFullName, project.name, {
        projectRef: project.ref,
        projectName: project.name,
        supabaseAccountId: activeAccountId,
      })
      setOpen(false)
      setProjects(null)
      setAccounts(null)
      load()
      if (migrate) onSendPrompt?.(migrationPrompt('oauth'))
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  const connectManual = async (e, { migrate } = {}) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.connectDb(repoFullName, label, { connectionString })
      setConnectionString('')
      setOpen(false)
      load()
      if (migrate) onSendPrompt?.(migrationPrompt('manual'))
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  const createVpsDb = async ({ migrate } = {}) => {
    setCreatingVpsDb(true)
    setError(null)
    try {
      await api.createVpsDb(repoFullName)
      setOpen(false)
      load()
      if (migrate) onSendPrompt?.(migrationPrompt('vps'))
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setCreatingVpsDb(false)
    }
  }

  // Si ya hay una conexión de OTRO tipo, no ejecuta la acción de una — la deja pendiente hasta
  // que el usuario confirme el cambio (ver el bloque "pendingSwitch" del menú). Si no hay
  // conexión previa, o es del mismo tipo, corre directo como siempre.
  const requestOrRun = (targetType, run) => {
    if (connection && connection.connectionType !== targetType) {
      setPendingSwitch({ targetType, run })
    } else {
      run()
    }
  }

  const confirmSwitch = async () => {
    if (!pendingSwitch) return
    if (connection?.connectionType === 'vps') {
      if (!confirm('Cambiar de conexión borra la base de datos automática actual y TODOS sus datos para siempre. ¿Seguro que querés continuar?')) return
    }
    setSaving(true)
    setError(null)
    try {
      await api.disconnectDb(connection.id)
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
      setSaving(false)
      return
    }
    const { run } = pendingSwitch
    setPendingSwitch(null)
    setSaving(false)
    await run()
  }

  const disconnect = async () => {
    if (!connection) return
    // A diferencia de Supabase/manual (desconectar acá solo desvincula, la base sigue existiendo
    // donde sea que viva), la automática vive únicamente en nuestro Postgres — desconectarla la
    // borra de verdad, para siempre. Sin una migración automática todavía (ver Integraciones),
    // conectar Supabase después de tener la automática significa perder esos datos.
    const message =
      connection.connectionType === 'vps'
        ? 'Esto borra la base de datos automática y TODOS sus datos para siempre (no hay forma de recuperarlos). ¿Seguro que querés continuar?'
        : '¿Desconectar la base de datos de este repositorio?'
    if (!confirm(message)) return
    await api.disconnectDb(connection.id)
    load()
  }

  if (connection === undefined) return null

  return (
    <div ref={triggerRef} className="relative">
      {connection ? (
        <button
          onClick={() => (open ? setOpen(false) : openMenu())}
          title={
            connection.connectionType === 'oauth'
              ? `${connection.label} (${connection.projectRef}) · clic para cambiar o desconectar`
              : connection.connectionType === 'vps'
                ? `${connection.label} (automática, en nuestro servidor) · clic para cambiar o desconectar`
                : `${connection.label} · ${connection.connectionStringMasked} (clic para cambiar o desconectar)`
          }
          className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/15"
        >
          <Database className="size-3" /> BD conectada
        </button>
      ) : (
        <button
          onClick={() => (open ? setOpen(false) : openMenu())}
          className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted hover:bg-white/5"
        >
          <Database className="size-3" /> Conectar base de datos
        </button>
      )}

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: menuPos.top, right: menuPos.right }}
            className="fixed z-[9999] w-80 rounded-xl border border-border bg-surface p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">{connection ? 'Base de datos' : 'Conectar base de datos'}</p>
              <button
                onClick={() => {
                  setOpen(false)
                  setPendingSwitch(null)
                  setShowNewAccountLabel(false)
                }}
                className="text-muted hover:text-text"
              >
                <X className="size-4" />
              </button>
            </div>

            {connection && !pendingSwitch && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
                <span className="min-w-0 truncate text-xs text-text/90">
                  Conectado: <strong className="text-primary">{describeConnType(connection.connectionType)}</strong>
                </span>
                <button onClick={disconnect} className="shrink-0 text-xs text-red-300 hover:underline">
                  Desconectar
                </button>
              </div>
            )}

            {error && <p className="mb-3 text-xs text-red-300">{error}</p>}

            {pendingSwitch ? (
              <div className="space-y-3">
                <p className="text-xs text-text/90">
                  Tu proyecto está conectado a <strong>{describeConnType(connection.connectionType)}</strong> y su código ya
                  está armado para eso. Cambiar a <strong>{describeConnType(pendingSwitch.targetType)}</strong> le va a
                  pedir a la IA que migre el código para que hable con la base nueva.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={confirmSwitch}
                    disabled={saving}
                    className="flex-1 rounded-md bg-primary py-2 text-xs font-bold text-slate-950 disabled:opacity-60"
                  >
                    {saving ? 'Cambiando…' : 'Cambiar conexión'}
                  </button>
                  <button
                    onClick={() => setPendingSwitch(null)}
                    disabled={saving}
                    className="flex-1 rounded-md border border-border py-2 text-xs hover:bg-white/5 disabled:opacity-60"
                  >
                    Mantener
                  </button>
                </div>
              </div>
            ) : showNewAccountLabel ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  startNewAccountOAuth()
                }}
                className="space-y-2"
              >
                <p className="text-xs text-muted">
                  Nombrá esta cuenta de Supabase (ej. "Mi cuenta", "Cliente X") — así la distinguís si más adelante
                  vinculás otra.
                </p>
                <input
                  autoFocus
                  value={newAccountLabel}
                  onChange={(e) => setNewAccountLabel(e.target.value)}
                  placeholder="Nombre de la cuenta (opcional)"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={startingOauth}
                  className="flex w-full items-center justify-center gap-2 rounded-md brand-gradient py-2.5 text-xs font-bold text-slate-950 disabled:opacity-60"
                >
                  {startingOauth ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
                  {startingOauth ? 'Redirigiendo…' : 'Continuar a Supabase'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewAccountLabel(false)}
                  className="w-full text-center text-[11px] text-muted hover:text-text"
                >
                  Cancelar
                </button>
              </form>
            ) : projects ? (
              <div className="space-y-1.5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs text-muted">Elige el proyecto para este repositorio:</p>
                  <button onClick={backToAccounts} className="shrink-0 text-[11px] text-primary hover:underline">
                    Cambiar cuenta
                  </button>
                </div>
                {projects.length === 0 && <p className="text-xs text-muted">No se encontraron proyectos en tu cuenta.</p>}
                {projects.map((p) => (
                  <button
                    key={p.ref}
                    onClick={() => requestOrRun('oauth', () => pickProject(p, { migrate: true }))}
                    disabled={saving}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-60"
                  >
                    <span>{p.name}</span>
                    <span className="font-mono text-muted">{p.ref}</span>
                  </button>
                ))}
              </div>
            ) : accounts && accounts.length > 0 ? (
              <div className="space-y-1.5">
                <p className="mb-2 text-xs text-muted">Elige la cuenta de Supabase:</p>
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => loadProjectsFor(a.id)}
                    disabled={loadingProjects}
                    className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-white/5 disabled:opacity-60"
                  >
                    <span>{a.label}</span>
                    {loadingProjects && activeAccountId === a.id && <Loader2 className="size-3.5 animate-spin" />}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setNewAccountLabel('')
                    setShowNewAccountLabel(true)
                  }}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs text-muted hover:bg-white/5"
                >
                  <Zap className="size-3.5" /> Vincular otra cuenta
                </button>
              </div>
            ) : (
              <>
                {oauthStatus?.oauthAvailable && (
                  <button
                    onClick={connectOneClick}
                    disabled={startingOauth || loadingProjects || loadingAccounts}
                    className="flex w-full items-center justify-center gap-2 rounded-md brand-gradient py-2.5 text-xs font-bold text-slate-950 disabled:opacity-60"
                  >
                    {startingOauth || loadingProjects || loadingAccounts ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Zap className="size-3.5" />
                    )}
                    {oauthStatus?.connected ? 'Elegir proyecto de Supabase' : 'Conectar con Supabase (1 clic)'}
                  </button>
                )}

                {vpsAvailable && (
                  <button
                    onClick={() => requestOrRun('vps', () => createVpsDb({ migrate: true }))}
                    disabled={creatingVpsDb}
                    className={`flex w-full items-center justify-center gap-2 rounded-md border border-border py-2.5 text-xs font-semibold hover:bg-white/5 disabled:opacity-60 ${oauthStatus?.oauthAvailable ? 'mt-2' : ''}`}
                  >
                    {creatingVpsDb ? <Loader2 className="size-3.5 animate-spin" /> : <Server className="size-3.5" />}
                    {creatingVpsDb ? 'Creando base de datos…' : 'Crear base de datos automática'}
                  </button>
                )}
                {vpsAvailable && (
                  <p className="mt-1 text-[11px] text-muted">Sin necesitar una cuenta de Supabase — corre en nuestro servidor.</p>
                )}

                <button
                  onClick={() => setShowManual((s) => !s)}
                  className="mt-2 flex w-full items-center justify-center gap-1 text-[11px] text-muted hover:text-text"
                >
                  <ChevronDown className={`size-3 transition-transform ${showManual ? 'rotate-180' : ''}`} />
                  {oauthStatus?.oauthAvailable ? 'o pega el connection string manualmente' : 'Conectar manualmente'}
                </button>

                {(showManual || !oauthStatus?.oauthAvailable) && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      requestOrRun('manual', () => connectManual(e, { migrate: true }))
                    }}
                    className="mt-2 space-y-2"
                  >
                    <p className="text-[11px] text-muted">
                      Supabase → Project Settings → Database → Connection string (URI).
                    </p>
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Etiqueta (opcional)"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
                    />
                    <input
                      required
                      type="password"
                      value={connectionString}
                      onChange={(e) => setConnectionString(e.target.value)}
                      placeholder="postgresql://postgres:••••@db.xxxx.supabase.co:5432/postgres"
                      className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
                    />
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-xs font-semibold hover:bg-white/5 disabled:opacity-60"
                    >
                      {saving && <Loader2 className="size-3.5 animate-spin" />}
                      {saving ? 'Probando conexión…' : 'Conectar'}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}
