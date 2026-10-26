import { useEffect, useState } from 'react'
import { Server, Loader2, Users, Layers } from 'lucide-react'
import { api } from '../../lib/api.js'
import { SectionHeader } from '../../components/admin/AdminShared.jsx'

const SERVICE_LABELS = { backend: 'Backend (gitflow-backend)', preview: 'Orquestador de previews', nginx: 'Nginx' }

function ServiceBadge({ status }) {
  const active = status === 'active'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-300'
      }`}
    >
      <span className={`size-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-red-400'}`} />
      {active ? 'Activo' : status}
    </span>
  )
}

function Stat({ label, value, sub, warn }) {
  return (
    <div className="rounded-xl border border-border bg-surface/60 px-4 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`text-lg font-semibold ${warn ? 'text-amber-400' : 'text-text'}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  )
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const PREVIEW_STATUS_LABELS = {
  idle: 'Libre',
  cloning: 'Clonando',
  installing: 'Instalando',
  starting: 'Iniciando',
  running: 'Corriendo',
  error: 'Error',
}

export default function AdminSystem() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .adminSystemStatus()
      .then(setData)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <section>
      <SectionHeader icon={Server} title="Sistema" description="Estado del VPS, usuarios con plan activo y previews en uso." />

      {error && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {data === null && !error && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </p>
      )}

      {data && (
        <div className="space-y-8">
          {/* --- VPS --- */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-text">VPS</h3>
            <div className="flex flex-wrap gap-3">
              <Stat label="Uptime" value={formatUptime(data.vps.uptimeSec)} />
              <Stat
                label="Carga (1/5/15 min)"
                value={data.vps.loadAvg.map((n) => n.toFixed(2)).join(' / ')}
                sub={`${data.vps.cpuCount} CPU`}
              />
              <Stat
                label="Memoria usada"
                value={`${data.vps.memUsedPct}%`}
                sub={`de ${data.vps.memTotalGb} GB`}
                warn={data.vps.memUsedPct >= 85}
              />
              {data.vps.disk && (
                <Stat
                  label="Disco usado"
                  value={`${data.vps.disk.usedPct}%`}
                  sub={`${data.vps.disk.freeGb} GB libres de ${data.vps.disk.totalGb} GB`}
                  warn={data.vps.disk.usedPct >= 85}
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {Object.entries(data.vps.services).map(([key, status]) => (
                <div key={key} className="flex items-center gap-2 text-sm">
                  <span className="text-muted">{SERVICE_LABELS[key] || key}</span>
                  <ServiceBadge status={status} />
                </div>
              ))}
            </div>
          </div>

          {/* --- Usuarios --- */}
          <div>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-text">
              <Users className="size-3.5 text-primary" /> Usuarios
            </h3>
            <div className="flex flex-wrap gap-3">
              <Stat label="Con plan activo" value={data.users.active} />
              <Stat label="Total registrados" value={data.users.total} />
            </div>
          </div>

          {/* --- Previews --- */}
          <div>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-text">
              <Layers className="size-3.5 text-primary" /> Previews
            </h3>
            {!data.previews && <p className="text-sm text-muted">El orquestador de previews no está configurado en este entorno.</p>}
            {data.previews?.error && (
              <p className="text-sm text-red-300">No se pudo consultar el orquestador: {data.previews.error}</p>
            )}
            {data.previews && !data.previews.error && (
              <>
                <div className="mb-3 flex flex-wrap gap-3">
                  <Stat label="Cupos ocupados" value={`${data.previews.occupied} / ${data.previews.poolSize}`} />
                  <Stat label="Corriendo ahora" value={data.previews.running} />
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface/70 text-xs text-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Cupo</th>
                        <th className="px-3 py-2 font-medium">Proyecto</th>
                        <th className="px-3 py-2 font-medium">Estado</th>
                        <th className="px-3 py-2 font-medium">Última actividad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.previews.slots.map((s) => (
                        <tr key={s.index} className="border-t border-border">
                          <td className="px-3 py-2 font-mono text-xs text-muted">#{s.index}</td>
                          <td className="px-3 py-2">
                            {s.repoFullName ? (
                              <>
                                <p className="font-medium">{s.repoFullName}</p>
                                {s.slug && <p className="text-xs text-muted">{s.slug}.flow-pro.online</p>}
                              </>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                s.status === 'running'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : s.status === 'error'
                                    ? 'bg-red-500/10 text-red-300'
                                    : s.status === 'idle'
                                      ? 'bg-white/5 text-muted'
                                      : 'bg-amber-500/10 text-amber-300'
                              }`}
                            >
                              {PREVIEW_STATUS_LABELS[s.status] || s.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted">
                            {s.lastPing ? new Date(s.lastPing).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
