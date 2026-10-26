import { useEffect, useState } from 'react'
import { CreditCard, Mail, Database, ExternalLink, Loader2, ArrowLeft, Check, KeyRound, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import { api } from '../lib/api.js'
import DbConnectionPanel from './DbConnectionPanel.jsx'

// Guías con integraciones que NO necesitan backend propio (este proyecto genera apps estáticas
// tipo Vite + Supabase, sin server para el usuario): Stripe vía Payment Link (nada de claves
// secretas) y EmailJS para el formulario de contacto (manda el correo directo desde el
// navegador con una clave pública). Nada de esto requiere tocar el backend de FlowPro: los
// valores se guardan como secrets del proyecto (ya existentes) y el prompt se lo mandamos al
// chat como si lo hubiera escrito el usuario.
const INTEGRATIONS = [
  {
    id: 'stripe',
    name: 'Stripe',
    tagline: 'Cobros con tarjeta (botón de pago)',
    Icon: CreditCard,
    docsUrl: 'https://dashboard.stripe.com/payment-links',
    docsLabel: 'Crear un Payment Link en Stripe',
    steps: [
      'Entrá a tu Dashboard de Stripe y creá un Payment Link para lo que querés vender.',
      'Copiá la URL del Payment Link (empieza con https://buy.stripe.com/...).',
      'Pegala acá abajo y conectá.',
    ],
    fields: [
      {
        key: 'VITE_STRIPE_PAYMENT_LINK',
        label: 'URL del Payment Link',
        placeholder: 'https://buy.stripe.com/xxxxxxx',
      },
    ],
    prompt: () =>
      'Agregá un botón de "Comprar" que redirija a la URL de la variable de entorno VITE_STRIPE_PAYMENT_LINK (ya está configurada como secret del proyecto). No hace falta backend ni ninguna clave secreta de Stripe: es un Payment Link, así que el botón solo tiene que abrir esa URL.',
  },
  {
    id: 'email',
    name: 'Email',
    tagline: 'Formulario de contacto que te manda el email',
    Icon: Mail,
    docsUrl: 'https://www.emailjs.com/',
    docsLabel: 'Crear cuenta y plantilla en EmailJS',
    steps: [
      'Creá una cuenta gratis en EmailJS y conectá tu propio email como servicio de envío.',
      'Creá una plantilla (template) para el mensaje de contacto.',
      'Copiá el Service ID, el Template ID y la Public Key desde el panel de EmailJS.',
    ],
    fields: [
      { key: 'VITE_EMAILJS_SERVICE_ID', label: 'Service ID', placeholder: 'service_xxxxxxx' },
      { key: 'VITE_EMAILJS_TEMPLATE_ID', label: 'Template ID', placeholder: 'template_xxxxxxx' },
      { key: 'VITE_EMAILJS_PUBLIC_KEY', label: 'Public Key', placeholder: 'xxxxxxxxxxxxxxxx' },
    ],
    prompt: () =>
      'Agregá un formulario de contacto (nombre, email, mensaje) que use EmailJS (paquete @emailjs/browser) para mandar el email, usando las variables de entorno VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID y VITE_EMAILJS_PUBLIC_KEY (ya están configuradas como secrets del proyecto). No hace falta backend: EmailJS manda el correo directo desde el navegador.',
  },
]

// Gestión manual de secrets de CLIENTE (VITE_, se hornean en el build) para lo que no tiene una
// guía propia arriba — vivía antes en el panel "Publicar", pero conceptualmente es parte de
// "conectar servicios externos", así que quedó mejor acá. Distinto de "Secrets de servidor"
// (otra pestaña de este mismo panel "Más"): esos nunca se hornean en el build, solo los ve una
// Edge Function.
function ManualSecretsSection({ projectId }) {
  const [secrets, setSecrets] = useState(null)
  const [error, setError] = useState(null)
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [showValue, setShowValue] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    api
      .listProjectSecrets(projectId)
      .then((data) => setSecrets(data.secrets))
      .catch((err) => setError(err.message))
  }, [projectId])

  const add = async (e) => {
    e.preventDefault()
    if (!key.trim() || !value.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveProjectSecret(projectId, key.trim(), value.trim())
      setSecrets((prev) => [...(prev || []).filter((s) => s.key !== saved.key), saved].sort((a, b) => a.key.localeCompare(b.key)))
      setKey('')
      setValue('')
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (secret) => {
    setDeletingId(secret.id)
    try {
      await api.deleteProjectSecret(projectId, secret.id)
      setSecrets((prev) => prev.filter((s) => s.id !== secret.id))
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="border-t border-border pt-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-text/90">
        <KeyRound className="size-3.5 text-primary" /> Otras variables (manual)
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Para lo que no tiene una guía arriba. Para que el código las pueda leer con{' '}
        <code className="font-mono">import.meta.env</code>, el nombre tiene que empezar con{' '}
        <code className="font-mono text-primary">VITE_</code> (ej. VITE_MI_CLAVE). No pasan por el chat ni quedan en
        el historial de mensajes.
      </p>

      {secrets === null && !error && <p className="mt-2 text-[11px] text-muted">Cargando…</p>}
      {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

      {secrets?.length > 0 && (
        <div className="mt-2 space-y-1">
          {secrets.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5">
              <span className="truncate font-mono text-xs text-text/90">{s.key}</span>
              <button
                onClick={() => remove(s)}
                disabled={deletingId === s.id}
                title="Eliminar"
                className="press flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
              >
                {deletingId === s.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="mt-2 space-y-1.5">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="VITE_MI_VARIABLE"
          className="w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary/50"
        />
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center rounded-md border border-border bg-background/40 focus-within:border-primary/50">
            <input
              type={showValue ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Valor"
              className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none"
            />
            <button
              type="button"
              onClick={() => setShowValue((s) => !s)}
              className="shrink-0 px-2 text-muted hover:text-text"
            >
              {showValue ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={!key.trim() || !value.trim() || saving}
            className="press flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-slate-950 disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          </button>
        </div>
      </form>
    </div>
  )
}

// Contenido de la pestaña "Integraciones" del panel "Más" — antes era un panel propio
// (IntegrationsPanel), ahora vive acá adentro junto con Funciones y Secrets de servidor.
export default function IntegrationsTab({ projectId, repoFullName, onMatchResult, onSendPrompt, onDone }) {
  const [selected, setSelected] = useState(null)
  const [values, setValues] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const openIntegration = (integration) => {
    setSelected(integration)
    setValues(Object.fromEntries(integration.fields.map((f) => [f.key, ''])))
    setError(null)
  }

  const canConnect = selected && selected.fields.every((f) => values[f.key]?.trim())

  const connect = async () => {
    if (!canConnect || saving) return
    setSaving(true)
    setError(null)
    try {
      for (const field of selected.fields) {
        await api.saveProjectSecret(projectId, field.key, values[field.key].trim())
      }
      onSendPrompt(selected.prompt(values))
      onDone?.()
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!selected) {
    return (
      <div className="space-y-2">
        {repoFullName && (
          <div className="mb-1 flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Database className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-text">Base de datos</p>
                <p className="truncate text-[11px] text-muted">
                  Por defecto usás la base de datos automática de FlowPro — conectá Supabase acá si preferís esa.
                </p>
              </div>
            </div>
            <DbConnectionPanel projectId={projectId} repoFullName={repoFullName} onMatchResult={onMatchResult} onSendPrompt={onSendPrompt} />
          </div>
        )}

        <p className="text-[11px] text-muted">Conectá un servicio y la IA se encarga de agregar el código en el proyecto.</p>
        {INTEGRATIONS.map((integration) => (
          <button
            key={integration.id}
            onClick={() => openIntegration(integration)}
            className="press flex w-full items-center gap-3 rounded-lg border border-border bg-background/40 p-3 text-left hover:border-primary/40 hover:bg-white/5"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <integration.Icon className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-text">{integration.name}</p>
              <p className="truncate text-[11px] text-muted">{integration.tagline}</p>
            </div>
          </button>
        ))}

        {projectId && <ManualSecretsSection projectId={projectId} />}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setSelected(null)}
        className="press flex items-center gap-1.5 text-[11px] text-muted hover:text-text"
      >
        <ArrowLeft className="size-3.5" /> {selected.name}
      </button>

      <a
        href={selected.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
      >
        <ExternalLink className="size-3" /> {selected.docsLabel}
      </a>

      <ol className="space-y-1.5 text-[11px] text-muted">
        {selected.steps.map((step, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="shrink-0 text-primary">{i + 1}.</span> {step}
          </li>
        ))}
      </ol>

      <div className="space-y-2">
        {selected.fields.map((field) => (
          <div key={field.key}>
            <p className="text-[11px] font-medium text-text/90">{field.label}</p>
            <input
              value={values[field.key] || ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              className="mt-1 w-full rounded-md border border-border bg-background/40 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-primary/50"
            />
          </div>
        ))}
      </div>

      {error && <p className="text-[11px] text-red-300">{error}</p>}

      <button
        onClick={connect}
        disabled={!canConnect || saving}
        className="press flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
      >
        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        Conectar
      </button>
    </div>
  )
}
