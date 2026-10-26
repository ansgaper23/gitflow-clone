import { Router } from 'express'
import crypto from 'node:crypto'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { requireAuth } from '../middleware/auth.js'
import { requireAdmin, requireStaff } from '../middleware/admin.js'
import { signSession } from '../services/jwt.js'
import { supabase } from '../db/supabaseClient.js'
import { RUNNERS } from '../services/aiAccounts.js'
import { isImageProvider, generateImageWithAccount } from '../services/imageGen.js'
import { isPreviewConfigured, config } from '../config.js'
import { getPreviewPool } from '../services/previewOrchestrator.js'
import { activatePlanForUser } from '../services/stripe.js'

export const adminRouter = Router()
// Requiere sesión para todo lo que cuelga de /admin; cada ruta decide si necesita
// admin completo (cuentas de IA) o alcanza con admin/colaborador (usuarios y planes).
adminRouter.use(requireAuth)

function maskKey(key = '') {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}••••${key.slice(-4)}`
}

function serialize(acc) {
  return {
    id: acc.id,
    provider: acc.provider,
    label: acc.label,
    model: acc.model,
    isActive: acc.is_active,
    priority: acc.priority,
    scope: acc.scope,
    baseUrl: acc.base_url,
    bridgeAccountId: acc.bridge_account_id,
    apiKeyMasked: maskKey(acc.api_key),
    lastUsedAt: acc.last_used_at,
    lastError: acc.last_error,
    lastErrorAt: acc.last_error_at,
    createdAt: acc.created_at,
  }
}

adminRouter.get('/ai-accounts', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('ai_accounts').select('*').order('priority', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data.map(serialize))
})

adminRouter.post('/ai-accounts', requireAdmin, async (req, res) => {
  const { provider, label, apiKey, model, priority, scope, baseUrl } = req.body
  if (!provider || !label || !apiKey || !model) {
    return res.status(400).json({ error: 'Faltan campos: provider, label, apiKey y model son obligatorios' })
  }
  if (!RUNNERS[provider] && !isImageProvider(provider)) {
    return res.status(400).json({ error: `Proveedor inválido. Usa: ${[...Object.keys(RUNNERS), 'cloudflare'].join(', ')}` })
  }
  if (scope && !['agent', 'app', 'image'].includes(scope)) {
    return res.status(400).json({ error: 'scope inválido. Usa: agent, app, image' })
  }
  const BRIDGE_PROVIDERS = ['antigravity', 'claudecode'] // motores que viven en antigravity-bridge
  // Anthropic y Gemini pegan directo a la API oficial del proveedor y ambos SDKs aceptan un base
  // URL propio (ver providers/anthropic.js y providers/gemini.js) — alcanza con un gateway
  // compatible para redirigir el tráfico ahí. Mismo criterio que supportsCustomBaseUrl en el
  // frontend (components/admin/AdminShared.jsx) — si se agrega un proveedor acá, agregarlo ahí también.
  const BASE_URL_PROVIDERS = ['anthropic', 'gemini', 'openai', ...BRIDGE_PROVIDERS]
  if (baseUrl && !BASE_URL_PROVIDERS.includes(provider)) {
    return res.status(400).json({ error: `baseUrl solo aplica a cuentas con proveedor ${BASE_URL_PROVIDERS.map((p) => `"${p}"`).join(', ')}` })
  }
  if (BRIDGE_PROVIDERS.includes(provider) && !baseUrl) {
    return res.status(400).json({ error: `baseUrl es obligatoria para "${provider}" (la URL del bridge)` })
  }

  const { data, error } = await supabase
    .from('ai_accounts')
    .insert({
      provider,
      label,
      api_key: apiKey,
      model,
      priority: priority ?? 0,
      scope: scope || 'agent',
      base_url: baseUrl?.trim() || null,
    })
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(serialize(data))
})

// --- Alta guiada de una cuenta de Antigravity (link + pegar código) ---
// El bridge no tiene un subcomando de login (agy no lo trae) — cuando corre sin credenciales
// imprime sola una URL de Google y espera el código en su stdin (confirmado en pruebas reales).
// Estas 3 rutas envuelven ese flujo de 2 pasos: arrancar (te da el link) y completar (le
// pasás el código), reusando la conexión (base_url + api_key) de CUALQUIER cuenta de
// Antigravity que ya exista — es el mismo bridge físico para todas.
async function getBridgeConnection(provider) {
  const { data } = await supabase.from('ai_accounts').select('base_url, api_key').eq('provider', provider).limit(1).maybeSingle()
  if (!data?.base_url) {
    throw new Error(`No hay ninguna cuenta de "${provider}" configurada todavía para saber a qué bridge conectarse.`)
  }
  return data
}

async function bridgeFetch(bridge, path, options = {}) {
  const res = await fetch(`${bridge.base_url.replace(/\/+$/, '')}${path}`, {
    ...options,
    headers: { 'x-api-key': bridge.api_key, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`El bridge respondió algo que no es JSON (status ${res.status}).`)
  }
  if (!res.ok) throw new Error(data.error || `El bridge respondió ${res.status}.`)
  return data
}

adminRouter.post('/ai-accounts/antigravity-login/start', requireAdmin, async (req, res) => {
  try {
    const bridge = await getBridgeConnection('antigravity')
    const data = await bridgeFetch(bridge, '/api/accounts/antigravity/start', { method: 'POST' })
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

adminRouter.post('/ai-accounts/antigravity-login/:accountId/complete', requireAdmin, async (req, res) => {
  const { code, label, model, priority, scope } = req.body
  if (!code?.trim()) return res.status(400).json({ error: 'Falta el código' })
  try {
    const bridge = await getBridgeConnection('antigravity')
    await bridgeFetch(bridge, `/api/accounts/antigravity/${req.params.accountId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    })

    // El bridge ya confirmó el login — recién ahora se da de alta la cuenta en FlowPro, lista
    // para usarse (bridge_account_id es lo que le dice a providers/antigravity.js con qué
    // credencial llamar, en vez de la de producción).
    const { data: created, error } = await supabase
      .from('ai_accounts')
      .insert({
        provider: 'antigravity',
        label: label?.trim() || 'Antigravity (cuenta nueva)',
        api_key: bridge.api_key,
        base_url: bridge.base_url,
        model: model?.trim() || 'gemini-3.1-pro-high',
        priority: priority ?? 0,
        scope: scope || 'agent',
        bridge_account_id: req.params.accountId,
      })
      .select('*')
      .single()
    if (error) throw error

    res.status(201).json(serialize(created))
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

adminRouter.post('/ai-accounts/antigravity-login/:accountId/cancel', requireAdmin, async (req, res) => {
  try {
    const bridge = await getBridgeConnection('antigravity')
    await bridgeFetch(bridge, `/api/accounts/antigravity/${req.params.accountId}/cancel`, { method: 'POST' })
    res.json({ ok: true })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

adminRouter.patch('/ai-accounts/:id', requireAdmin, async (req, res) => {
  const patch = {}
  const { label, apiKey, model, isActive, priority, scope, baseUrl } = req.body
  if (scope !== undefined && !['agent', 'app', 'image'].includes(scope)) {
    return res.status(400).json({ error: 'scope inválido. Usa: agent, app, image' })
  }
  if (label !== undefined) patch.label = label
  if (apiKey) patch.api_key = apiKey
  if (model !== undefined) patch.model = model
  if (isActive !== undefined) patch.is_active = isActive
  if (priority !== undefined) patch.priority = priority
  if (scope !== undefined) patch.scope = scope
  if (baseUrl !== undefined) patch.base_url = baseUrl?.trim() || null

  const { data, error } = await supabase
    .from('ai_accounts')
    .update(patch)
    .eq('id', req.params.id)
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(serialize(data))
})

adminRouter.delete('/ai-accounts/:id', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('ai_accounts').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.status(204).end()
})

// Tabla estática para el panel "Logs de uso": una fila por cuenta de IA CONFIGURADA (no una lista
// de llamadas que crece sola) con su consumo TOTAL acumulado — así siempre se ven las mismas N
// cuentas (las que hay en /admin), sumando de por vida en vez de una ventana de "últimas N".
adminRouter.get('/ai-usage/summary', requireAdmin, async (req, res) => {
  const { data: accounts, error: accountsErr } = await supabase.from('ai_accounts').select('*').order('priority', { ascending: true })
  if (accountsErr) return res.status(500).json({ error: accountsErr.message })

  const { data: summary, error: summaryErr } = await supabase.rpc('ai_usage_summary')
  if (summaryErr) return res.status(500).json({ error: summaryErr.message })

  const byAccount = new Map((summary || []).map((s) => [s.account_id, s]))

  const rows = accounts.map((acc) => {
    const s = byAccount.get(acc.id)
    return {
      accountId: acc.id,
      provider: acc.provider,
      label: acc.label,
      model: acc.model,
      scope: acc.scope,
      isActive: acc.is_active,
      requests: Number(s?.requests || 0),
      inputTokens: Number(s?.input_tokens || 0),
      outputTokens: Number(s?.output_tokens || 0),
      // Solo Antigravity/Claude Code lo reportan (consumen cuota de suscripciones personales, no
      // una API facturada por token) — null, no 0, para distinguir "sin costo" de "no aplica".
      costUsd: s?.cost_usd != null ? Number(s.cost_usd) : null,
      errors: Number(s?.errors || 0),
      lastUsedAt: s?.last_used_at || null,
      lastStatusCode: s?.last_status_code ?? null,
    }
  })

  const totals = rows.reduce(
    (t, r) => ({
      requests: t.requests + r.requests,
      inputTokens: t.inputTokens + r.inputTokens,
      outputTokens: t.outputTokens + r.outputTokens,
      costUsd: t.costUsd + (r.costUsd || 0),
      errors: t.errors + r.errors,
    }),
    { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, errors: 0 },
  )

  res.json({ accounts: rows, totals })
})

// "Errores" en el resumen de arriba es un contador acumulado de por vida a propósito (ver
// comentario en /ai-usage/summary) — esto es la forma de resetearlo a cero sin tocar el
// historial de requests/tokens exitosos: borra solo las filas de llamadas fallidas
// (status_code != 200), deja el resto del historial intacto.
adminRouter.post('/ai-usage/clear-errors', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('ai_usage_logs').delete().neq('status_code', 200)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

function serializeUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    githubLogin: u.github_login,
    githubConnected: Boolean(u.github_access_token),
    googleConnected: Boolean(u.google_id),
    isAdmin: u.is_admin,
    isCollaborator: u.is_collaborator,
    planId: u.plan_id,
    planExpiresAt: u.plan_expires_at,
    planActive: Boolean(u.plan_expires_at && new Date(u.plan_expires_at) > new Date()),
    creditsUsed: u.credits_used,
    createdAt: u.created_at,
  }
}

adminRouter.get('/users', requireStaff, async (req, res) => {
  const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data.map(serializeUser))
})

// Historial de ventas: cada fila de "payments" (la crea /api/plans/checkout, el webhook de
// Stripe la pasa a "paid"/"failed"). Solo admin completo, es información financiera — mismo
// criterio que ya tiene la pestaña de Planes y precios.
adminRouter.get('/payments', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('payments')
    .select(
      // "payments" tiene dos FKs a "users" (user_id y reviewed_by desde la migración de
      // Yape/Plin) — hay que nombrar la relación explícitamente o PostgREST no sabe cuál
      // embeber con "users(...)".
      'id, amount_cents, currency, status, stripe_session_id, payment_method, operation_number, reviewed_at, created_at, users!payments_user_id_fkey(email, name, github_login), plans(id, name)',
    )
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) return res.status(500).json({ error: error.message })
  res.json(
    data.map((p) => ({
      id: p.id,
      amountCents: p.amount_cents,
      currency: p.currency,
      status: p.status,
      stripeSessionId: p.stripe_session_id,
      paymentMethod: p.payment_method,
      operationNumber: p.operation_number,
      reviewedAt: p.reviewed_at,
      isAdminGrant: p.payment_method === 'admin_grant',
      createdAt: p.created_at,
      userEmail: p.users?.email || null,
      userName: p.users?.name || p.users?.github_login || null,
      planId: p.plans?.id || null,
      planName: p.plans?.name || null,
    })),
  )
})

// Aprueba un pago manual pendiente de revisión (hoy solo Yape/Plin): activa el plan del
// comprador y marca la venta como pagada. Mismo criterio de acceso que ver /admin/payments
// (información financiera), no alcanza con ser colaborador.
adminRouter.post('/payments/:id/approve', requireAdmin, async (req, res) => {
  const { data: payment, error: findErr } = await supabase.from('payments').select('*').eq('id', req.params.id).single()
  if (findErr || !payment) return res.status(404).json({ error: 'Pago no encontrado' })
  if (payment.status !== 'pending_review') return res.status(400).json({ error: 'Este pago no está pendiente de revisión' })

  const { data: plan, error: planErr } = await supabase.from('plans').select('*').eq('id', payment.plan_id).single()
  if (planErr || !plan) return res.status(404).json({ error: 'Plan no encontrado' })

  await activatePlanForUser(supabase, payment.user_id, plan)

  const { error } = await supabase
    .from('payments')
    .update({ status: 'paid', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', payment.id)
  if (error) return res.status(500).json({ error: error.message })

  res.json({ ok: true })
})

// Rechaza un pago manual pendiente de revisión (ej. el número de operación no corresponde a
// ningún cobro real): no activa nada, solo deja constancia en el historial.
adminRouter.post('/payments/:id/reject', requireAdmin, async (req, res) => {
  const { data: payment, error: findErr } = await supabase.from('payments').select('*').eq('id', req.params.id).single()
  if (findErr || !payment) return res.status(404).json({ error: 'Pago no encontrado' })
  if (payment.status !== 'pending_review') return res.status(400).json({ error: 'Este pago no está pendiente de revisión' })

  const { error } = await supabase
    .from('payments')
    .update({ status: 'failed', reviewed_by: req.user.id, reviewed_at: new Date().toISOString() })
    .eq('id', payment.id)
  if (error) return res.status(500).json({ error: error.message })

  res.json({ ok: true })
})

// Solo un admin completo puede otorgar/quitar el rol de colaborador (evita que un
// colaborador se auto-promueva o promueva a otros).
adminRouter.post('/users/:id/set-collaborator', requireAdmin, async (req, res) => {
  const { isCollaborator } = req.body
  const { data: updated, error } = await supabase
    .from('users')
    .update({ is_collaborator: Boolean(isCollaborator) })
    .eq('id', req.params.id)
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(serializeUser(updated))
})

// Activa (o extiende) un plan existente para un usuario puntual, sin pasar por el pago
// simulado — misma lógica de acumulación que /api/plans/purchase (extiende desde la fecha
// de expiración actual si sigue vigente, o desde ahora si ya venció o nunca tuvo plan).
adminRouter.post('/users/:id/grant-plan', requireStaff, async (req, res) => {
  const { planId } = req.body
  if (!planId) return res.status(400).json({ error: 'Falta planId' })

  const { data: plan, error: planErr } = await supabase.from('plans').select('*').eq('id', planId).single()
  if (planErr || !plan) return res.status(404).json({ error: 'Plan no encontrado' })

  const { data: target, error: targetErr } = await supabase
    .from('users')
    .select('plan_expires_at')
    .eq('id', req.params.id)
    .single()
  if (targetErr || !target) return res.status(404).json({ error: 'Usuario no encontrado' })

  const now = new Date()
  const currentExpiry = target.plan_expires_at ? new Date(target.plan_expires_at) : now
  const base = currentExpiry > now ? currentExpiry : now
  const newExpiry = new Date(base.getTime() + plan.duration_days * 24 * 60 * 60 * 1000)

  const { data: updated, error } = await supabase
    .from('users')
    .update({ plan_id: plan.id, plan_expires_at: newExpiry.toISOString() })
    .eq('id', req.params.id)
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })

  // Deja constancia en el historial de ventas de que este plan lo activó un admin a mano, no
  // una compra real — monto $0 y method "admin_grant" para que se distinga claramente ahí
  // (ver GET /admin/payments). stripe_session_id es NOT NULL/unique en la tabla y acá no hay
  // sesión de Stripe real, así que se genera un identificador propio para esa fila.
  await supabase.from('payments').insert({
    user_id: req.params.id,
    plan_id: plan.id,
    stripe_session_id: `admin_grant_${crypto.randomUUID()}`,
    amount_cents: 0,
    currency: plan.currency,
    status: 'paid',
    payment_method: 'admin_grant',
  })

  res.json(serializeUser(updated))
})

adminRouter.post('/users/:id/revoke-plan', requireStaff, async (req, res) => {
  const { data: updated, error } = await supabase
    .from('users')
    .update({ plan_id: null, plan_expires_at: null })
    .eq('id', req.params.id)
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(serializeUser(updated))
})

// Precios editables desde /admin sin tocar la base a mano. Mismos nombres de campo que usa
// el resto del frontend para un plan (price_cents, duration_days…) — no hace falta una
// serialización aparte, GET /api/plans (público) ya devuelve las filas tal cual.
adminRouter.patch('/plans/:id', requireAdmin, async (req, res) => {
  const patch = {}
  const { name, price_cents, duration_days, featured, sort_order } = req.body
  if (name !== undefined) patch.name = name
  if (price_cents !== undefined) {
    if (!Number.isInteger(price_cents) || price_cents <= 0) return res.status(400).json({ error: 'price_cents debe ser un entero positivo' })
    patch.price_cents = price_cents
  }
  if (duration_days !== undefined) patch.duration_days = duration_days
  if (featured !== undefined) patch.featured = Boolean(featured)
  if (sort_order !== undefined) patch.sort_order = sort_order

  const { data, error } = await supabase.from('plans').update(patch).eq('id', req.params.id).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

adminRouter.post('/ai-accounts/:id/test', requireAdmin, async (req, res) => {
  const { data: account, error } = await supabase
    .from('ai_accounts')
    .select('*')
    .eq('id', req.params.id)
    .single()
  if (error || !account) return res.status(404).json({ error: 'Cuenta no encontrada' })

  try {
    // OJO: se decide por "scope", no por "provider" — Gemini sirve tanto para texto (agent/app)
    // como para imagen, así que mirar solo el proveedor probaba generación de imagen incluso en
    // cuentas de chat, y un fallo ahí (ej. restricción geográfica del modelo de imagen) las
    // dejaba en cooldown 5 minutos por algo que no tiene nada que ver con su uso real.
    if (account.scope === 'image') {
      // Prompt descriptivo a propósito: algunos modelos de imagen (ej. el filtro NSFW de
      // Cloudflare) marcan falsos positivos con frases muy abstractas/minimalistas.
      await generateImageWithAccount(account, 'a red apple on a wooden table, product photography')
    } else {
      const runner = RUNNERS[account.provider]
      await runner({
        apiKey: account.api_key,
        baseURL: account.base_url || undefined,
        model: account.model,
        system: 'Responde únicamente con la palabra: ok',
        tools: [],
        history: [],
        userMessage: 'ping',
        executeTool: async () => 'n/a',
      })
    }
    await supabase.from('ai_accounts').update({ last_error: null, last_error_at: null }).eq('id', account.id)
    res.json({ ok: true })
  } catch (err) {
    await supabase
      .from('ai_accounts')
      .update({ last_error: String(err.message || err).slice(0, 500), last_error_at: new Date().toISOString() })
      .eq('id', account.id)
    res.status(502).json({ ok: false, error: err.message })
  }
})

// --- Panel Reseller (Fase 1, sin Stripe) — gestión desde /admin: otorgar/revocar licencia,
// cargar créditos a mano, y fijar cuánto cuesta en créditos activar cada plan. ---

function serializeResellerLicense(l, walletBalance) {
  return {
    userId: l.user_id,
    tier: l.tier,
    status: l.status,
    licenseKey: l.license_key,
    clientLimit: l.client_limit,
    expiresAt: l.expires_at,
    notes: l.notes,
    createdAt: l.created_at,
    balance: walletBalance ?? 0,
  }
}

adminRouter.get('/resellers', requireStaff, async (req, res) => {
  const { data: licenses, error } = await supabase
    .from('reseller_licenses')
    .select('*, users(email, name, github_login)')
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })

  const { data: wallets } = await supabase.from('reseller_wallets').select('user_id, balance')
  const balanceByUser = new Map((wallets || []).map((w) => [w.user_id, w.balance]))

  res.json(
    licenses.map((l) => ({
      ...serializeResellerLicense(l, balanceByUser.get(l.user_id)),
      email: l.users?.email,
      name: l.users?.name,
      githubLogin: l.users?.github_login,
    })),
  )
})

// Otorga o actualiza la licencia de un usuario — upsert por user_id. Genera license_key sola
// la primera vez (no se regenera en updates posteriores salvo que venga explícitamente vacía,
// para no invalidar una clave que el reseller ya podría tener guardada/mostrada en algún lado).
adminRouter.post('/resellers/:userId/license', requireStaff, async (req, res) => {
  const { tier, status, clientLimit, expiresAt, notes } = req.body
  if (!tier || !['basico', 'white_label'].includes(tier)) {
    return res.status(400).json({ error: 'tier inválido. Usa: basico, white_label' })
  }

  const { data: existing } = await supabase.from('reseller_licenses').select('license_key').eq('user_id', req.params.userId).maybeSingle()
  const licenseKey = existing?.license_key || `RSL-${crypto.randomBytes(8).toString('hex').toUpperCase()}`

  const { data, error } = await supabase
    .from('reseller_licenses')
    .upsert(
      {
        user_id: req.params.userId,
        tier,
        status: status || 'active',
        license_key: licenseKey,
        client_limit: clientLimit ?? null,
        expires_at: expiresAt || null,
        notes: notes || null,
      },
      { onConflict: 'user_id' },
    )
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })

  // Asegura que la wallet exista desde el momento en que se otorga la licencia (0 créditos) —
  // así "cargar créditos" de abajo siempre encuentra la fila para sumarle en vez de depender
  // del orden en que el admin haga las cosas.
  await supabase.from('reseller_wallets').upsert({ user_id: req.params.userId }, { onConflict: 'user_id', ignoreDuplicates: true })

  res.json(serializeResellerLicense(data))
})

adminRouter.post('/resellers/:userId/credits', requireStaff, async (req, res) => {
  const amount = Number(req.body.amount)
  if (!Number.isInteger(amount) || amount === 0) return res.status(400).json({ error: 'amount debe ser un entero distinto de cero' })

  const { data: newBalance, error } = await supabase.rpc('reseller_grant_credits', { p_user_id: req.params.userId, p_amount: amount })
  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('reseller_credit_transactions').insert({
    user_id: req.params.userId,
    amount,
    reason: 'admin_grant',
    created_by: req.user.id,
  })

  res.json({ balance: newBalance })
})

adminRouter.get('/reseller-plan-costs', requireStaff, async (req, res) => {
  const { data: plans, error } = await supabase.from('plans').select('id, name, duration_days').order('sort_order', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  const { data: costs } = await supabase.from('reseller_plan_costs').select('plan_id, credit_cost')
  const costByPlan = new Map((costs || []).map((c) => [c.plan_id, c.credit_cost]))
  res.json(plans.map((p) => ({ planId: p.id, name: p.name, durationDays: p.duration_days, creditCost: costByPlan.get(p.id) ?? null })))
})

adminRouter.patch('/reseller-plan-costs/:planId', requireStaff, async (req, res) => {
  const creditCost = Number(req.body.creditCost)
  if (!Number.isInteger(creditCost) || creditCost <= 0) return res.status(400).json({ error: 'creditCost debe ser un entero positivo' })

  const { error } = await supabase
    .from('reseller_plan_costs')
    .upsert({ plan_id: req.params.planId, credit_cost: creditCost }, { onConflict: 'plan_id' })
  if (error) return res.status(500).json({ error: error.message })
  res.json({ planId: req.params.planId, creditCost })
})

// --- Estado del sistema (pestaña "Sistema" de /admin): salud del VPS + cuántos usuarios con
// plan activo hay + cuántos cupos de preview están ocupados ahora mismo. Todo best-effort: un
// dato que falla (ej. orquestador caído) no debe tumbar el resto del panel. ---

function execFileP(cmd, args) {
  return new Promise((resolve) => {
    // No se usa la promoción de node:util a propósito: "systemctl is-active" devuelve código de
    // salida != 0 para servicios inactivos (no es un error de verdad, es el resultado), así que
    // se resuelve igual con lo que haya en stdout en vez de rechazar.
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(String(stdout || '').trim() || (err ? null : '')))
  })
}

async function serviceStatus(unit) {
  const out = await execFileP('systemctl', ['is-active', unit])
  return out || 'desconocido'
}

// "df -P" (formato POSIX, una línea, sin cortar nombres largos) sobre "/" — la única partición
// que importa acá, todo (app, previews, node_modules) vive bajo la misma raíz en este VPS.
async function diskUsage() {
  const out = await execFileP('df', ['-P', '/'])
  const line = out?.split('\n')[1]
  if (!line) return null
  const [, totalKb, usedKb, availKb, usedPct] = line.trim().split(/\s+/)
  const gb = (kb) => Math.round((Number(kb) / 1024 / 1024) * 10) / 10
  return { totalGb: gb(totalKb), usedGb: gb(usedKb), freeGb: gb(availKb), usedPct: Number(usedPct.replace('%', '')) }
}

adminRouter.get('/system-status', requireAdmin, async (req, res) => {
  const [backendService, previewService, nginxService, disk] = await Promise.all([
    serviceStatus('gitflow-backend'),
    serviceStatus('gitflow-preview'),
    serviceStatus('nginx'),
    diskUsage(),
  ])

  const totalMem = os.totalmem()
  const freeMem = os.freemem()

  const vps = {
    uptimeSec: Math.round(os.uptime()),
    loadAvg: os.loadavg(),
    cpuCount: os.cpus().length,
    memTotalGb: Math.round((totalMem / 1024 / 1024 / 1024) * 10) / 10,
    memUsedPct: Math.round(((totalMem - freeMem) / totalMem) * 100),
    disk,
    services: { backend: backendService, preview: previewService, nginx: nginxService },
  }

  const now = new Date().toISOString()
  const { count: totalUsers, error: totalErr } = await supabase.from('users').select('*', { count: 'exact', head: true })
  const { count: activeUsers, error: activeErr } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gt('plan_expires_at', now)
  if (totalErr || activeErr) return res.status(500).json({ error: (totalErr || activeErr).message })

  let previews = null
  if (isPreviewConfigured) {
    try {
      const pool = await getPreviewPool()
      previews = {
        poolSize: pool.length,
        running: pool.filter((s) => s.status === 'running').length,
        occupied: pool.filter((s) => s.ownerKey).length,
        slots: pool,
      }
    } catch (err) {
      previews = { error: err.message }
    }
  }

  res.json({ vps, users: { total: totalUsers ?? 0, active: activeUsers ?? 0 }, previews })
})

adminRouter.post('/users/:id/impersonate', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const token = signSession(id);
    res.json({ token, url: `${config.frontendUrl}/auth/callback?token=${token}&next=/dashboard` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
