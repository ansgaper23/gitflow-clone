import { Router } from 'express'
import crypto from 'node:crypto'
import { requireAuth } from '../middleware/auth.js'
import { requireReseller } from '../middleware/reseller.js'
import { supabase } from '../db/supabaseClient.js'
import { activatePlanForUser } from '../services/stripe.js'
import { config } from '../config.js'

export const resellerRouter = Router()

function serializeLicense(l) {
  if (!l) return null
  return {
    tier: l.tier,
    status: l.status,
    clientLimit: l.client_limit,
    expiresAt: l.expires_at,
    createdAt: l.created_at,
    license_key: l.license_key,
    shortCode: l.license_key ? l.license_key.replace('RSL-', '').substring(0, 6).toLowerCase() : null,
    payment_url: l.payment_url,
    gateways: (l.payment_url && l.payment_url.startsWith('{')) ? JSON.parse(l.payment_url) : null,
  }
}

// El dashboard del panel necesita saber, sin tirar un 403, si el usuario tiene licencia o no
// (y en qué estado) para decidir qué pantalla mostrar — a diferencia de requireReseller, que
// bloquea con error el resto de las rutas de este archivo.
resellerRouter.get('/status', requireAuth, async (req, res) => {
  const { data: license } = await supabase.from('reseller_licenses').select('*').eq('user_id', req.user.id).maybeSingle()
  const { data: wallet } = await supabase.from('reseller_wallets').select('balance').eq('user_id', req.user.id).maybeSingle()

  const active = Boolean(license && license.status === 'active' && (!license.expires_at || new Date(license.expires_at) > new Date()))
  res.json({ hasLicense: Boolean(license), active, license: serializeLicense(license), balance: wallet?.balance || 0 })
})

// --- Aceptación de invitaciones (el que llama es el CLIENTE invitado, no el reseller) ---
// Van antes del "use(requireReseller)" de abajo: ninguna de las dos exige licencia de reseller.

// Pública (sin sesión): la página de "te invitaron" necesita mostrar quién invita y a qué email
// ANTES de que la persona inicie sesión o se registre. No expone nada sensible del reseller.
resellerRouter.get('/invites/:token', async (req, res) => {
  const { data: invite } = await supabase
    .from('reseller_invites')
    .select('email, status, users(name, github_login, email)')
    .eq('token', req.params.token)
    .maybeSingle()
  if (!invite) return res.status(404).json({ error: 'Invitación no encontrada' })
  if (invite.status !== 'pending') return res.status(410).json({ error: 'Esta invitación ya fue usada' })
  const reseller = invite.users
  res.json({ email: invite.email, resellerName: reseller?.name || reseller?.github_login || reseller?.email || 'un reseller de FlowPro' })
})

// El cliente ya está logueado/registrado (con cualquier método) cuando llega acá — confirma la
// invitación y recién ahí se vincula. El chequeo de email evita que alguien use un link ajeno
// (visto el token, da igual con qué cuenta esté logueado) para autovincularse a otro reseller.
resellerRouter.post('/invites/:token/accept', requireAuth, async (req, res) => {
  const { data: invite, error: inviteErr } = await supabase
    .from('reseller_invites')
    .select('*')
    .eq('token', req.params.token)
    .maybeSingle()
  if (inviteErr) return res.status(500).json({ error: inviteErr.message })
  if (!invite) return res.status(404).json({ error: 'Invitación no encontrada' })
  if (invite.status !== 'pending') return res.status(410).json({ error: 'Esta invitación ya fue usada' })
  if (invite.email !== (req.user.email || '').toLowerCase()) {
    return res.status(403).json({ error: 'Esta invitación es para otro email — iniciá sesión con esa cuenta.' })
  }

  const { error: updateErr } = await supabase.from('users').update({ reseller_id: invite.reseller_id }).eq('id', req.user.id)
  if (updateErr) return res.status(500).json({ error: updateErr.message })

  await supabase.from('reseller_invites').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invite.id)

  res.json({ ok: true })
})


// Webhook Universal (Zapier, Make, etc.)
// No usa requireAuth porque la autenticación es vía API Key (Authorization: Bearer <license_key>)
resellerRouter.post('/webhook/activate', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta Token de API (Authorization: Bearer <license_key>)' })
  }
  const licenseKey = authHeader.split(' ')[1]

  const { email, planId } = req.body
  if (!email || !planId) {
    return res.status(400).json({ error: 'Payload incompleto. Se requiere "email" y "planId".' })
  }

  // 1. Validar reseller
  const { data: license } = await supabase.from('reseller_licenses').select('*').eq('license_key', licenseKey).maybeSingle()
  if (!license || license.status !== 'active' || (license.expires_at && new Date(license.expires_at) < new Date())) {
    return res.status(401).json({ error: 'Licencia de reseller inválida o inactiva' })
  }

  // 2. Buscar cliente por email
  const normalizedEmail = email.trim().toLowerCase()
  const { data: client } = await supabase.from('users').select('id, reseller_id, email').eq('email', normalizedEmail).maybeSingle()
  if (!client) {
    return res.status(404).json({ error: `No se encontró un usuario con el email ${normalizedEmail}` })
  }
  if (client.reseller_id !== license.user_id) {
    return res.status(403).json({ error: 'Este usuario no está vinculado a tu cuenta de reseller.' })
  }

  // 3. Validar plan y costo
  const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).maybeSingle()
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })

  const { data: planCosts } = await supabase.from('reseller_plan_costs').select('*').eq('tier', license.tier)
  const cost = planCosts.find((p) => p.plan_id === planId)
  if (!cost) {
    return res.status(400).json({ error: `El plan ${planId} no está disponible para tu tier.` })
  }

  // 4. Cobrar créditos atómicamente
  const { error: deductErr } = await supabase.rpc('reseller_spend_credits', {
    uid: license.user_id,
    amount: cost.credit_cost
  })
  if (deductErr) {
    return res.status(402).json({ error: 'No tienes créditos suficientes para activar este plan.' })
  }

  // 5. Activar el plan
  let newExpiry
  try {
    newExpiry = await activatePlanForUser(supabase, client.id, plan)
  } catch (err) {
    console.error(`Webhook: Reseller ${license.user_id} pagó ${cost.credit_cost} créditos pero falló activatePlanForUser para cliente ${client.id}:`, err)
    return res.status(500).json({ error: 'Se cobraron los créditos pero falló la activación.', detail: err.message })
  }

  // 6. Registrar transacción
  await supabase.from('reseller_credit_transactions').insert({
    user_id: license.user_id,
    amount: -cost.credit_cost,
    reason: 'webhook_activate_plan',
    related_plan_id: planId,
    related_client_id: client.id,
    description: `Activación automática vía Webhook para ${client.email}`
  })

  return res.json({ ok: true, message: `Plan activado exitosamente para ${client.email}`, newExpiry })
})

// requireReseller por sí solo asume que "req.user" ya existe...

// requireReseller por sí solo asume que "req.user" ya existe (lo llena requireAuth) — sin
// encadenarlo acá, todas las rutas de abajo explotaban con "Cannot read properties of
// undefined (reading 'id')" en vez de devolver un 401 normal para quien no tiene sesión.
resellerRouter.use(requireAuth, requireReseller)

resellerRouter.get('/wallet', async (req, res) => {
  const { data: wallet } = await supabase.from('reseller_wallets').select('*').eq('user_id', req.user.id).maybeSingle()
  const { data: transactions } = await supabase
    .from('reseller_credit_transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50)
  res.json({
    balance: wallet?.balance || 0,
    transactions: (transactions || []).map((t) => ({
      id: t.id,
      amount: t.amount,
      reason: t.reason,
      relatedPlanId: t.related_plan_id,
      relatedClientId: t.related_client_id,
      createdAt: t.created_at,
    })),
  })
})

// Solo planes que el admin habilitó para reventa (tienen fila en reseller_plan_costs) — un plan
// sin costo definido todavía no es algo que un reseller pueda activarle a un cliente.
resellerRouter.get('/plan-costs', async (req, res) => {
  const { data, error } = await supabase
    .from('reseller_plan_costs')
    .select('plan_id, credit_cost, plans(id, name, duration_days)')
  if (error) return res.status(500).json({ error: error.message })
  res.json((data || []).map((r) => ({ planId: r.plan_id, name: r.plans?.name, durationDays: r.plans?.duration_days, creditCost: r.credit_cost })))
})

resellerRouter.get('/clients', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, github_login, plan_id, plan_expires_at, created_at')
    .eq('reseller_id', req.user.id)
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })

  // "users.plan_id" no tiene foreign key declarada a "plans" (solo "payments.plan_id" la
  // tiene) — PostgREST no puede resolver un embed "plans(name)" sin esa relación, así que se
  // resuelve a mano acá, mismo criterio que ya usa el resto del admin (PlanBadge en el
  // frontend, por ejemplo, ni siquiera muestra el nombre, solo el id del plan).
  const { data: plans } = await supabase.from('plans').select('id, name')
  const nameByPlanId = new Map((plans || []).map((p) => [p.id, p.name]))

  res.json(
    (data || []).map((c) => ({
      id: c.id,
      email: c.email,
      name: c.name,
      githubLogin: c.github_login,
      planId: c.plan_id,
      planName: c.plan_id ? nameByPlanId.get(c.plan_id) || c.plan_id : null,
      planExpiresAt: c.plan_expires_at,
      planActive: Boolean(c.plan_expires_at && new Date(c.plan_expires_at) > new Date()),
      createdAt: c.created_at,
    })),
  )
})

// Gasta créditos y activa el plan en un solo paso — el orden importa: primero se cobra
// (reseller_spend_credits falla solo si no alcanza el saldo, atómico), y solo si el cobro
// salió bien se activa el plan de verdad. Si activatePlanForUser fallara después de cobrado
// (no debería, es un update simple), quedaría un crédito cobrado sin plan aplicado — se
// registra el error para poder revisarlo a mano en vez de dejarlo pasar en silencio.
resellerRouter.post('/clients/:clientId/activate-plan', async (req, res) => {
  const { planId } = req.body
  if (!planId) return res.status(400).json({ error: 'Falta planId' })

  const { data: client, error: clientErr } = await supabase
    .from('users')
    .select('id, reseller_id')
    .eq('id', req.params.clientId)
    .maybeSingle()
  if (clientErr) return res.status(500).json({ error: clientErr.message })
  if (!client || client.reseller_id !== req.user.id) {
    return res.status(404).json({ error: 'Este cliente no pertenece a tu cuenta de reseller' })
  }

  const { data: plan, error: planErr } = await supabase.from('plans').select('*').eq('id', planId).single()
  if (planErr || !plan) return res.status(404).json({ error: 'Plan no encontrado' })

  const { data: cost } = await supabase.from('reseller_plan_costs').select('credit_cost').eq('plan_id', planId).maybeSingle()
  if (!cost) return res.status(400).json({ error: 'Este plan todavía no está habilitado para reventa' })

  const { data: newBalance, error: spendErr } = await supabase.rpc('reseller_spend_credits', {
    p_user_id: req.user.id,
    p_amount: cost.credit_cost,
  })
  if (spendErr) {
    if (spendErr.message?.includes('saldo_insuficiente')) {
      return res.status(402).json({ error: `No te alcanzan los créditos (necesitás ${cost.credit_cost}).` })
    }
    return res.status(500).json({ error: spendErr.message })
  }

  let newExpiry
  try {
    newExpiry = await activatePlanForUser(supabase, client.id, plan)
  } catch (err) {
    console.error(`Reseller ${req.user.id} pagó ${cost.credit_cost} créditos pero falló activatePlanForUser para cliente ${client.id}:`, err)
    return res.status(500).json({ error: 'Se cobraron los créditos pero no se pudo activar el plan — contactá a soporte.', detail: err.message })
  }

  await supabase.from('reseller_credit_transactions').insert({
    user_id: req.user.id,
    amount: -cost.credit_cost,
    reason: 'activate_plan',
    related_plan_id: planId,
    related_client_id: client.id,
  })

  res.json({ balance: newBalance, planExpiresAt: newExpiry.toISOString() })
})

// Sin 0/O/1/I/L a propósito — son los caracteres que la gente más confunde al tipear una clave
// a mano desde el teléfono.
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateKeyCode() {
  const bytes = crypto.randomBytes(12)
  let raw = ''
  for (let i = 0; i < 12; i++) raw += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length]
  return `FP-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}

function serializeKey(k, planName) {
  return {
    id: k.id,
    code: k.code,
    planId: k.plan_id,
    planName: planName || k.plan_id,
    status: k.status,
    redeemedAt: k.redeemed_at,
    createdAt: k.created_at,
  }
}

resellerRouter.get('/keys', async (req, res) => {
  const { data, error } = await supabase
    .from('reseller_plan_keys')
    .select('*')
    .eq('reseller_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return res.status(500).json({ error: error.message })

  const { data: plans } = await supabase.from('plans').select('id, name')
  const nameByPlanId = new Map((plans || []).map((p) => [p.id, p.name]))
  res.json(data.map((k) => serializeKey(k, nameByPlanId.get(k.plan_id))))
})

// Cobra los créditos YA (mismo criterio que /clients/:id/activate-plan: primero se cobra,
// atómico, y solo si sale bien se genera la clave) — a diferencia de activar un plan a un
// cliente puntual, acá el crédito se gasta sin saber todavía quién la va a canjear.
resellerRouter.post('/keys', async (req, res) => {
  const { planId } = req.body
  if (!planId) return res.status(400).json({ error: 'Falta planId' })

  const { data: cost } = await supabase.from('reseller_plan_costs').select('credit_cost').eq('plan_id', planId).maybeSingle()
  if (!cost) return res.status(400).json({ error: 'Este plan todavía no está habilitado para reventa' })

  const { data: newBalance, error: spendErr } = await supabase.rpc('reseller_spend_credits', {
    p_user_id: req.user.id,
    p_amount: cost.credit_cost,
  })
  if (spendErr) {
    if (spendErr.message?.includes('saldo_insuficiente')) {
      return res.status(402).json({ error: `No te alcanzan los créditos (necesitás ${cost.credit_cost}).` })
    }
    return res.status(500).json({ error: spendErr.message })
  }

  // El código es único por constraint de la tabla — con 31^12 combinaciones un choque es
  // prácticamente imposible, pero por las dudas reintenta un par de veces antes de rendirse (los
  // créditos ya se cobraron, así que vale la pena el reintento en vez de fallar directo).
  let key, insertErr
  for (let attempt = 0; attempt < 3; attempt++) {
    ;({ data: key, error: insertErr } = await supabase
      .from('reseller_plan_keys')
      .insert({ reseller_id: req.user.id, plan_id: planId, code: generateKeyCode() })
      .select('*')
      .single())
    if (!insertErr) break
  }
  if (insertErr) {
    // Ya se cobraron los créditos y no se pudo generar la clave — se devuelven para no dejar al
    // reseller pagando por nada.
    await supabase.rpc('reseller_grant_credits', { p_user_id: req.user.id, p_amount: cost.credit_cost })
    return res.status(500).json({ error: 'No se pudo generar la clave, se devolvieron los créditos.', detail: insertErr.message })
  }

  await supabase.from('reseller_credit_transactions').insert({
    user_id: req.user.id,
    amount: -cost.credit_cost,
    reason: 'generate_key',
    related_plan_id: planId,
    related_key_id: key.id,
  })

  const { data: plan } = await supabase.from('plans').select('name').eq('id', planId).maybeSingle()
  res.status(201).json({ ...serializeKey(key, plan?.name), balance: newBalance })
})

// Solo mientras nadie la canjeó — anula la clave y devuelve los créditos gastados al generarla.
resellerRouter.post('/keys/:id/revoke', async (req, res) => {
  const { data: key, error: findErr } = await supabase
    .from('reseller_plan_keys')
    .select('*')
    .eq('id', req.params.id)
    .eq('reseller_id', req.user.id)
    .maybeSingle()
  if (findErr) return res.status(500).json({ error: findErr.message })
  if (!key) return res.status(404).json({ error: 'Clave no encontrada' })
  if (key.status !== 'unused') return res.status(400).json({ error: 'Esta clave ya fue canjeada o anulada, no se puede anular' })

  const { error: updateErr } = await supabase
    .from('reseller_plan_keys')
    .update({ status: 'revoked' })
    .eq('id', key.id)
    .eq('status', 'unused') // por si se canjeó justo en el medio (carrera con /redeem-key)
  if (updateErr) return res.status(500).json({ error: updateErr.message })

  const { data: cost } = await supabase.from('reseller_plan_costs').select('credit_cost').eq('plan_id', key.plan_id).maybeSingle()
  let newBalance = null
  if (cost) {
    const { data: balance } = await supabase.rpc('reseller_grant_credits', { p_user_id: req.user.id, p_amount: cost.credit_cost })
    newBalance = balance
    await supabase.from('reseller_credit_transactions').insert({
      user_id: req.user.id,
      amount: cost.credit_cost,
      reason: 'revoke_key_refund',
      related_plan_id: key.plan_id,
      related_key_id: key.id,
    })
  }

  res.json({ ok: true, balance: newBalance })
})

resellerRouter.get('/invites', async (req, res) => {
  const { data, error } = await supabase
    .from('reseller_invites')
    .select('*')
    .eq('reseller_id', req.user.id)
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data.map((i) => ({ id: i.id, email: i.email, status: i.status, createdAt: i.created_at, acceptedAt: i.accepted_at })))
})

resellerRouter.post('/invites', async (req, res) => {
  const { email } = req.body
  if (!email?.trim()) return res.status(400).json({ error: 'Falta el email' })

  const token = crypto.randomBytes(24).toString('base64url')
  const { data, error } = await supabase
    .from('reseller_invites')
    .insert({ reseller_id: req.user.id, email: email.trim().toLowerCase(), token })
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })

  res.status(201).json({
    id: data.id,
    email: data.email,
    status: data.status,
    createdAt: data.created_at,
    inviteUrl: `${config.frontendUrl}/invite/${token}`,
  })
})

resellerRouter.put('/gateways', requireAuth, requireReseller, async (req, res) => {
  const { gateways } = req.body
  const { error } = await req.supabase.from('reseller_licenses').update({ payment_url: JSON.stringify(gateways) }).eq('user_id', req.user.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

resellerRouter.put('/payment-url', requireAuth, requireReseller, async (req, res) => {
  const { url } = req.body
  const { error } = await req.supabase.from('reseller_licenses').update({ payment_url: url || null }).eq('user_id', req.user.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})
