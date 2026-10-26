import { supabase } from '../db/supabaseClient.js'

// Tras aprobar un cambio, el usuario espera una confirmación en el chat (estilo Lovable),
// no solo que la tarjeta cambie de estado en silencio. Insertamos un mensaje corto y
// determinista (sin gastar cuota de IA) confirmando qué se aplicó y qué puede seguir.
export async function insertFollowUpMessage(conversationId, content) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role: 'assistant', content })
    .select('*')
    .single()
  if (error) {
    console.error('No se pudo insertar el mensaje de seguimiento:', error.message)
    return null
  }
  return data
}

export function buildFollowUpText(kind, summary) {
  const label =
    kind === 'db'
      ? 'ejecuté el cambio de base de datos'
      : kind === 'function'
        ? 'desplegué la función de servidor'
        : kind === 'storage'
        ? 'subí el archivo a Supabase Storage'
        : kind === 'asset'
          ? 'subí el archivo a tu repositorio'
          : 'apliqué el cambio'
  return `✅ Listo, ${label}: **${summary}**.\n\n¿Quieres que siga con algo más en este proyecto?`
}
