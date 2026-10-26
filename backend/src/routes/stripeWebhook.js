import { Router } from 'express'
import { supabase } from '../db/supabaseClient.js'
import { config, isStripeConfigured } from '../config.js'
import { stripe, activatePlanForUser } from '../services/stripe.js'

export const stripeWebhookRouter = Router()

// Montado en index.js con express.raw() (no express.json()) porque Stripe firma el body
// crudo tal cual lo mandó — si pasa por un parser que lo reserializa, la firma no matchea
// nunca y todos los webhooks se rechazan como inválidos.
stripeWebhookRouter.post('/', async (req, res) => {
  if (!isStripeConfigured) return res.status(503).send('Stripe no configurado')

  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripeWebhookSecret)
  } catch (err) {
    console.error('Firma de webhook de Stripe inválida:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const { userId, planId } = session.metadata || {}

      if (userId && planId) {
        const { data: plan } = await supabase.from('plans').select('*').eq('id', planId).single()
        if (plan) await activatePlanForUser(supabase, userId, plan)
      }

      await supabase
        .from('payments')
        .update({
          status: 'paid',
          stripe_payment_intent_id: session.payment_intent,
          payment_method: (session.payment_method_types || []).join(', ') || null,
        })
        .eq('stripe_session_id', session.id)
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object
      await supabase.from('payments').update({ status: 'failed' }).eq('stripe_session_id', session.id)
    }
  } catch (err) {
    console.error('Error procesando webhook de Stripe:', err)
    return res.status(500).send('Error procesando el webhook')
  }

  res.json({ received: true })
})
