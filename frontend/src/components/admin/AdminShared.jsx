import { UserCog } from 'lucide-react'

export const PROVIDER_DEFAULTS = {
  anthropic: { model: 'claude-sonnet-5', label: 'Anthropic (Claude)' },
  openai: { model: 'gpt-4o', label: 'OpenAI' },
  gemini: { model: 'gemini-flash-lite-latest', label: 'Gemini' },
  deepseek: { model: 'deepseek-v4-flash', label: 'DeepSeek' },
  orcarouter: { model: 'gpt-4o', label: 'OrcaRouter' },
  cloudflare: { model: '@cf/black-forest-labs/flux-1-schnell', label: 'Cloudflare Workers AI' },
  antigravity: { model: 'gemini-3.1-pro-high', label: 'Antigravity (bridge)' },
  claudecode: { model: 'sonnet', label: 'Claude Code (bridge)' },
}

// Antigravity y Claude Code son los dos motores del mismo antigravity-bridge (comparten la
// mecÃ¡nica de Base URL obligatoria + las mismas limitaciones de alcance) â€” se agrupan acÃ¡ para no
// repetir la lista de providers en cada lugar de la UI que necesita distinguirlos del resto.
export const BRIDGE_PROVIDERS = ['antigravity', 'claudecode']
export function isBridgeProvider(provider) {
  return BRIDGE_PROVIDERS.includes(provider)
}

// Anthropic y Gemini pegan directo a la API oficial del proveedor (@anthropic-ai/sdk /
// @google/genai) â€” ambos SDKs aceptan un base URL propio, asÃ­ que alcanza con un gateway
// compatible (ver providers/gemini.js y providers/anthropic.js) para redirigir el trÃ¡fico ahÃ­.
// DeepSeek/OrcaRouter/Cloudflare van a un endpoint fijo del proveedor y no lo tienen por ahora.
export function supportsCustomBaseUrl(provider) {
  return provider === 'anthropic' || provider === 'gemini' || provider === 'openai' || isBridgeProvider(provider)
}

export const emptyForm = {
  provider: 'anthropic',
  label: '',
  apiKey: '',
  model: PROVIDER_DEFAULTS.anthropic.model,
  priority: 0,
  scope: 'agent',
  baseUrl: '',
}

export const SCOPE_LABEL = {
  agent: 'Agente de código',
  app: 'IA dentro de apps',
  image: 'Generación de imágenes',
}

// Orden fijo en que se muestran las categorías en el listado de /admin â€” coincide con el orden
// de las opciones del selector "Uso", para que la agrupación visual no salte de forma rara.
export const SCOPE_ORDER = ['agent', 'app', 'image']

// Encabezado de sección, compartido entre las tres páginas del panel para que se vean como un
// mismo sistema en vez de pantallas armadas en momentos distintos.
export function SectionHeader({ icon: Icon, title, description }) {
  return (
    <div className="mb-4 flex items-start gap-2.5">
      <span className="glow-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg brand-gradient text-slate-950">
        <Icon className="size-4" />
      </span>
      <div>
        <h2 className="text-base font-semibold text-brand-gradient">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
    </div>
  )
}

export function PlanBadge({ user }) {
  if (!user.planActive) return <span className="text-xs text-muted">Sin plan</span>
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
      {user.planId} Â· hasta {new Date(user.planExpiresAt).toLocaleDateString('es-ES')}
    </span>
  )
}

// Acciones de una fila de usuario: mismo contenido para la fila de tabla (desktop) y la tarjeta
// (mobile), asÃ­ no hay dos copias del comportamiento para mantener sincronizadas.
import { LogIn } from 'lucide-react';
export function UserActions({ u, plans, grantSelection, setGrantSelection, userBusyId, grantPlan, revokePlan, toggleCollaborator, impersonate, currentUser }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={grantSelection[u.id] || plans[0]?.id || ''}
        onChange={(e) => setGrantSelection((s) => ({ ...s, [u.id]: e.target.value }))}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none"
      >
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => grantPlan(u.id)}
        disabled={userBusyId === u.id}
        className="press rounded-md brand-gradient px-2 py-1 text-xs font-bold text-slate-950 transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        Activar
      </button>
      {u.planActive && (
        <button
          onClick={() => revokePlan(u.id)}
          disabled={userBusyId === u.id}
          className="rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        >
          Revocar
        </button>
      )}
      {currentUser?.isAdmin && impersonate && (
          <button
            onClick={() => impersonate(u)}
            disabled={userBusyId === u.id}
            title='Generar Magic Link e Iniciar sesión como este usuario'
            className='flex items-center gap-1 rounded-md border border-brand/40 px-2 py-1 text-xs text-brand hover:bg-brand/10 disabled:opacity-50'
          >
            <LogIn className="size-3" /> Entrar
          </button>
        )}
        {currentUser?.isAdmin && !u.isAdmin && (
        <button
          onClick={() => toggleCollaborator(u)}
          disabled={userBusyId === u.id}
          title={u.isCollaborator ? 'Quitar rol de colaborador' : 'Hacer colaborador (puede activar planes, sin acceso a IA)'}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
            u.isCollaborator ? 'border-gold/40 text-gold hover:bg-gold/10' : 'border-border text-muted hover:bg-white/5'
          }`}
        >
          <UserCog className="size-3" /> {u.isCollaborator ? 'Quitar colaborador' : 'Hacer colaborador'}
        </button>
      )}
    </div>
  )
}
