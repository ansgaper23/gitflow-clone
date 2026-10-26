import { Router } from 'express'
import crypto from 'node:crypto'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { config, isStripeConfigured, isYapePlinConfigured } from '../config.js'
import { stripe, activatePlanForUser } from '../services/stripe.js'

export const plansRouter = Router()

plansRouter.get('/', async (req, res) => {
  const { data, error } = await supabase.from('plans').select('*').order('sort_order', { ascending: true })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// Crea una sesión de Stripe Checkout para el plan elegido (pago único: el webhook de abajo
// extiende plan_expires_at cuando Stripe confirma el pago, no acá — nunca activar el plan en
// esta respuesta, porque el usuario puede cerrar la pestaña antes de pagar de verdad).
plansRouter.post('/checkout', requireAuth, async (req, res) => {
  if (!isStripeConfigured) return res.status(503).json({ error: 'Stripe no está configurado en el backend (.env)' })
  const { planId } = req.body
  const { data: plan, error: planErr } = await supabase.from('plans').select('*').eq('id', planId).single()
  if (planErr || !plan) return res.status(404).json({ error: 'Plan no encontrado' })

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: plan.currency.toLowerCase(),
            product_data: { name: `FlowPro — ${plan.name}` },
            unit_amount: plan.price_cents,
          },
          quantity: 1,
        },
      ],
      customer_email: req.user.email || undefined,
      client_reference_id: req.user.id,
      metadata: { userId: req.user.id, planId: plan.id },
      success_url: `${config.frontendUrl}/account?stripe=success`,
      cancel_url: `${config.frontendUrl}/account?stripe=cancelled`,
    })

    const { error: insertErr } = await supabase.from('payments').insert({
      user_id: req.user.id,
      plan_id: plan.id,
      stripe_session_id: session.id,
      amount_cents: plan.price_cents,
      currency: plan.currency,
      status: 'pending',
    })
    if (insertErr) throw insertErr

    res.json({ url: session.url })
  } catch (err) {
    console.error(err)
    res.status(502).json({ error: 'No se pudo iniciar el pago con Stripe', detail: err.message })
  }
})

// Si hay número de Yape/Plin configurado en el backend, el frontend muestra esa opción de pago
// además de Stripe. Público (no requiere sesión) para que la página de planes decida qué
// botones mostrar antes de que el usuario esté logueado.
plansRouter.get('/yape-info', (req, res) => {
  res.json({ configured: isYapePlinConfigured })
})

// Arranca un pago manual por Yape/Plin: no hay confirmación automática (no hay API de cobro sin
// cuenta de negocio), así que esto solo registra el intento en "payments" con status "pending"
// y devuelve el número/QR y el monto en soles para que el usuario pague por fuera. El plan NO
// se activa acá — recién cuando el usuario manda el número de operación (ver /confirm abajo) y
// un admin lo aprueba desde /admin/payments/:id/approve.
plansRouter.post('/yape-checkout', requireAuth, async (req, res) => {
  if (!isYapePlinConfigured) return res.status(503).json({ error: 'Yape/Plin no está configurado en el backend (.env)' })
  const { planId } = req.body
  const { data: plan, error: planErr } = await supabase.from('plans').select('*').eq('id', planId).single()
  if (planErr || !plan) return res.status(404).json({ error: 'Plan no encontrado' })

  const amountUsd = plan.price_cents / 100
  const amountPen = Math.round(amountUsd * config.usdPenRate * 100) / 100

  const { data: payment, error: insertErr } = await supabase
    .from('payments')
    .insert({
      user_id: req.user.id,
      plan_id: plan.id,
      // stripe_session_id es NOT NULL/unique y acá no hay sesión de Stripe real, así que se
      // genera un identificador propio para esta fila (mismo criterio que "admin_grant_" en
      // routes/admin.js).
      stripe_session_id: `yape_${crypto.randomUUID()}`,
      amount_cents: plan.price_cents,
      currency: plan.currency,
      status: 'pending',
      payment_method: 'yape_plin',
    })
    .select('*')
    .single()
  if (insertErr) return res.status(500).json({ error: insertErr.message })

  res.json({
    paymentId: payment.id,
    phone: config.yapePlinPhone,
    qrUrl: config.yapePlinQrUrl || null,
    amountUsd,
    amountPen,
  })
})

// El usuario pega acá el número de operación después de pagar por fuera. Pasa el pago a
// "pending_review" para que un admin lo vea en /admin y lo apruebe o rechace a mano.
plansRouter.post('/yape-checkout/:paymentId/confirm', requireAuth, async (req, res) => {
  const operationNumber = (req.body.operationNumber || '').trim()
  if (!operationNumber) return res.status(400).json({ error: 'Falta el número de operación' })

  const { data: payment, error: findErr } = await supabase
    .from('payments')
    .select('*')
    .eq('id', req.params.paymentId)
    .eq('user_id', req.user.id)
    .single()
  if (findErr || !payment) return res.status(404).json({ error: 'Pago no encontrado' })
  if (payment.status !== 'pending') return res.status(400).json({ error: 'Este pago ya fue confirmado o está en revisión' })

  const { error } = await supabase
    .from('payments')
    .update({ status: 'pending_review', operation_number: operationNumber })
    .eq('id', payment.id)
  if (error) return res.status(500).json({ error: error.message })

  res.json({ ok: true })
})

// Canjea una clave generada por un reseller (ver POST /reseller/keys): el que canjea puede ser
// cualquier usuario logueado, no hace falta que esté vinculado a ese reseller (a diferencia del
// flujo de "cliente invitado" del panel reseller). El "update ... where status = 'unused'" hace
// el reclamo atómico — si dos pestañas canjean la misma clave a la vez, solo una gana la carrera
// y la otra ve 0 filas afectadas.
plansRouter.post('/redeem-key', requireAuth, async (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase()
  if (!code) return res.status(400).json({ error: 'Falta la clave' })

  const { data: claimedKey, error: claimErr } = await supabase
    .from('reseller_plan_keys')
    .update({ status: 'redeemed', redeemed_by: req.user.id, redeemed_at: new Date().toISOString() })
    .eq('code', code)
    .eq('status', 'unused')
    .select('*')
    .maybeSingle()
  if (claimErr) return res.status(500).json({ error: claimErr.message })

  if (!claimedKey) {
    const { data: existing } = await supabase.from('reseller_plan_keys').select('id').eq('code', code).maybeSingle()
    return res.status(existing ? 400 : 404).json({ error: existing ? 'Esta clave ya fue usada o fue anulada' : 'Clave inválida' })
  }

  const { data: plan, error: planErr } = await supabase.from('plans').select('*').eq('id', claimedKey.plan_id).single()
  if (planErr || !plan) return res.status(404).json({ error: 'Plan no encontrado' })

  let newExpiry
  try {
    newExpiry = await activatePlanForUser(supabase, req.user.id, plan)
  } catch (err) {
    console.error(`Clave ${claimedKey.id} canjeada pero falló activatePlanForUser para usuario ${req.user.id}:`, err)
    return res.status(500).json({ error: 'La clave se marcó como usada pero no se pudo activar el plan — contactá a soporte.', detail: err.message })
  }

  await supabase.from('payments').insert({
    user_id: req.user.id,
    plan_id: plan.id,
    stripe_session_id: `reseller_key_${crypto.randomUUID()}`,
    amount_cents: 0,
    currency: plan.currency,
    status: 'paid',
    payment_method: 'reseller_key',
  })

  res.json({ planId: plan.id, planExpiresAt: newExpiry.toISOString() })
})

// Pago simulado, solo para desarrollo local sin credenciales de Stripe: activa el plan al
// instante sin cobrar nada. Se desactiva solo con que Stripe esté configurado, para que nadie
// pueda "comprar" gratis un plan en producción llamando a este endpoint directamente.
plansRouter.post('/purchase', requireAuth, async (req, res) => {
  if (isStripeConfigured) return res.status(403).json({ error: 'Los pagos simulados están deshabilitados. Usa /plans/checkout.' })
  const { planId } = req.body
  const { data: plan, error: planErr } = await supabase.from('plans').select('*').eq('id', planId).single()
  if (planErr || !plan) return res.status(404).json({ error: 'Plan no encontrado' })

  try {
    const newExpiry = await activatePlanForUser(supabase, req.user.id, plan)
    res.json({ planId: plan.id, planExpiresAt: newExpiry.toISOString(), simulated: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
