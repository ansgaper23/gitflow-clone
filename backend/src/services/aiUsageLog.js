import { supabase } from '../db/supabaseClient.js'

// Fire-and-forget a propósito: un log es informativo, nunca debe agregar latencia a la
// respuesta real del usuario ni romperla si Supabase falla en guardar la fila.
export function logAiUsage({ accountId, provider, model, scope, inputTokens, outputTokens, costUsd, statusCode, error, latencyMs }) {
  supabase
    .from('ai_usage_logs')
    .insert({
      account_id: accountId || null,
      provider,
      model,
      scope,
      input_tokens: inputTokens || 0,
      output_tokens: outputTokens || 0,
      // Solo Antigravity/Claude Code (bridge) lo mandan por ahora — consumen cuota de
      // suscripciones personales, no facturación por token de una API real.
      cost_usd: costUsd ?? null,
      status_code: statusCode,
      error: error ? String(error).slice(0, 500) : null,
      latency_ms: latencyMs,
    })
    .then(({ error: err }) => {
      if (err) console.error('Error guardando log de uso de IA:', err.message)
    })
}
