import { useState } from 'react'
import { Check, Database, Loader2, Table2 } from 'lucide-react'
import { api } from '../lib/api.js'

// Tarjeta que aparece cuando se detecta un backup de Lovable sin base de datos conectada
// todavía (ver dbImport.js/handleLovableBackupUpload). A propósito NO reutiliza QuestionCard: la
// elección acá dispara directo POST /db-import/choose-backup-db (crea/usa la base de verdad y
// carga los datos), no un turno de chat con la IA — necesita ser determinística, no una
// conversación.
export default function DbChoiceCard({ data, answered, onDone }) {
  // 'idle' | 'supabase-status' | 'supabase-accounts' | 'supabase-pick' | 'importing' | 'done' | 'error'
  const [step, setStep] = useState('idle')
  const [supabaseProjects, setSupabaseProjects] = useState(null)
  const [supabaseConnected, setSupabaseConnected] = useState(null)
  const [supabaseAccounts, setSupabaseAccounts] = useState(null)
  const [activeAccountId, setActiveAccountId] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const totalRows = data.tables.reduce((sum, t) => sum + t.rows, 0)

  const finish = async (type, extra) => {
    setStep('importing')
    setErrorMsg(null)
    try {
      const result = await api.chooseBackupDb(data.pendingImportId, type, extra)
      setStep('done')
      onDone(result.assistantMessage, { autoTurn: result.autoTurn })
    } catch (err) {
      setErrorMsg(err.detail ? `${err.message}: ${err.detail}` : err.message)
      setStep('error')
    }
  }

  const pickFlowCloud = () => finish('vps')

  const loadProjectsFor = async (accountId) => {
    try {
      const projects = await api.supabaseProjects(accountId)
      setActiveAccountId(accountId)
      setSupabaseProjects(projects)
      setStep('supabase-pick')
    } catch (err) {
      setErrorMsg(err.detail ? `${err.message}: ${err.detail}` : err.message)
      setStep('error')
    }
  }

  const pickSupabase = async () => {
    setStep('supabase-status')
    setErrorMsg(null)
    try {
      const status = await api.supabaseOAuthStatus()
      setSupabaseConnected(status.connected)
      if (!status.connected) {
        setStep('supabase-pick') // muestra el aviso de "conectá Supabase primero" (ver abajo)
        return
      }
      // Puede haber varias cuentas vinculadas — con una sola la usa derecho (mismo
      // comportamiento de siempre), con 2+ deja elegir cuál.
      const accs = await api.supabaseAccounts()
      setSupabaseAccounts(accs)
      if (accs.length === 1) {
        await loadProjectsFor(accs[0].id)
      } else {
        setStep('supabase-accounts')
      }
    } catch (err) {
      setErrorMsg(err.detail ? `${err.message}: ${err.detail}` : err.message)
      setStep('error')
    }
  }

  if (answered && step === 'idle') return null // ya se respondió en una carga anterior de la página

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Database className="size-4 shrink-0 text-primary" />
        <span className="text-xs font-medium text-text/95">¿Con qué base de datos armamos este backup?</span>
      </div>

      <div className="space-y-1 px-3 pb-3">
        {data.tables.map((t) => (
          <div key={t.name} className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5">
            <Table2 className="size-3.5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-xs text-text/85">{t.name}</span>
            <span className="shrink-0 text-[11px] text-muted">{t.rows} filas</span>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-muted">{data.tables.length} tablas, {totalRows} filas en total</p>
      </div>

      {step === 'idle' && !answered && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <button
            onClick={pickSupabase}
            className="press flex-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/85 hover:bg-white/5"
          >
            Supabase
          </button>
          <button
            onClick={pickFlowCloud}
            className="press flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-slate-950"
          >
            Flow Cloud (automática)
          </button>
        </div>
      )}

      {step === 'supabase-status' && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-xs text-muted">
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> Revisando tu cuenta de Supabase…
        </div>
      )}

      {step === 'supabase-pick' && supabaseConnected === false && (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          <p className="text-xs text-muted">
            Todavía no conectaste tu cuenta de Supabase. Conectala desde Integraciones y volvé a elegir "Supabase" acá.
          </p>
          <button
            onClick={() => onDone(null, { openIntegrations: true })}
            className="press rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/85 hover:bg-white/5"
          >
            Abrir Integraciones
          </button>
        </div>
      )}

      {step === 'supabase-accounts' && (
        <div className="space-y-1 border-t border-border px-3 py-2.5">
          <p className="mb-1 text-xs text-muted">Elegí la cuenta de Supabase:</p>
          {supabaseAccounts?.map((a) => (
            <button
              key={a.id}
              onClick={() => loadProjectsFor(a.id)}
              className="press flex w-full items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-text/85 hover:border-primary/50 hover:bg-white/5"
            >
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      )}

      {step === 'supabase-pick' && supabaseConnected && (
        <div className="space-y-1 border-t border-border px-3 py-2.5">
          {supabaseProjects?.length ? (
            supabaseProjects.map((p) => (
              <button
                key={p.ref}
                onClick={() => finish('oauth', { projectRef: p.ref, projectName: p.name, supabaseAccountId: activeAccountId })}
                className="press flex w-full items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-left text-xs text-text/85 hover:border-primary/50 hover:bg-white/5"
              >
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-[11px] text-muted">{p.ref}</span>
              </button>
            ))
          ) : (
            <p className="text-xs text-muted">No encontré ningún proyecto en tu cuenta de Supabase.</p>
          )}
        </div>
      )}

      {step === 'importing' && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-xs text-muted">
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> Armando la base e importando los datos… puede tardar un
          minuto.
        </div>
      )}

      {step === 'done' && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5 text-xs text-primary">
          <Check className="size-3.5 shrink-0" /> Listo.
        </div>
      )}

      {step === 'error' && (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          <p className="text-xs text-red-400">{errorMsg}</p>
          <button
            onClick={() => setStep('idle')}
            className="press rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text/85 hover:bg-white/5"
          >
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}
