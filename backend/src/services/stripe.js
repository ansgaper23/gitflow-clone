import Stripe from 'stripe'
import { config, isStripeConfigured } from '../config.js'

export const stripe = isStripeConfigured ? new Stripe(config.stripeSecretKey) : null

// Un plan = extender plan_expires_at por duration_days (igual que el "purchase" simulado que
// reemplaza). No hay suscripciones recurrentes de Stripe acá a propósito: los planes de
// FlowPro son cargas puntuales de N días, no una suscripción con cobro periódico automático.
export async function activatePlanForUser(supabase, userId, plan) {
  const { data: user } = await supabase.from('users').select('plan_expires_at').eq('id', userId).single()
  const now = new Date()
  const currentExpiry = user?.plan_expires_at ? new Date(user.plan_expires_at) : now
  const base = currentExpiry > now ? currentExpiry : now
  const newExpiry = new Date(base.getTime() + plan.duration_days * 24 * 60 * 60 * 1000)

  const { error } = await supabase
    .from('users')
    .update({ plan_id: plan.id, plan_expires_at: newExpiry.toISOString() })
    .eq('id', userId)
  if (error) throw error
  return newExpiry
}
