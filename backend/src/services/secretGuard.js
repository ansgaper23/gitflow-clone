// backend/src/services/secretGuard.js
// ARNÉS 2: ESCÁNER DE CREDENCIALES EXPUESTAS EN CÓDIGO CLIENTE (FLOWPRO)

const CLIENT_PATH_PATTERNS = [
  /^src\//i,
  /^public\//i,
  /^index\.html$/i
]

/**
 * Patrones deterministas de credenciales privadas de servidor que NUNCA deben
 * incluirse en texto plano en el bundle del cliente (src/ o public/).
 */
const SECRET_RULES = [
  {
    type: 'Supabase Service Role Key',
    regex: /(?:SUPABASE_SERVICE_ROLE_KEY|service_role_key|serviceRoleKey)\s*[:=]\s*['"][a-zA-Z0-9_\-\.]{20,}['"]/i,
    advice: 'Usa SUPABASE_ANON_KEY (o VITE_SUPABASE_ANON_KEY) para el cliente con RLS habilitado en Postgres. El service_role otorga control total sin restricciones de seguridad y solo debe usarse en backend/Edge Functions.'
  },
  {
    type: 'Supabase Service Role JWT',
    regex: /eyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]*"role"\s*:\s*"service_role"[a-zA-Z0-9_\-]*\.[a-zA-Z0-9_\-]+/i,
    advice: 'Se detectó un JWT de service_role de Supabase hardcodeado en el frontend. Utiliza la clave anon pública para acceso frontend.'
  },
  {
    type: 'Anthropic API Key',
    regex: /sk-ant-[a-zA-Z0-9_\-]{20,}/i,
    advice: 'Las claves de Anthropic son secretas de servidor. Traslada las llamadas a la API a un endpoint backend o Edge Function y lee la clave desde variables de entorno de servidor.'
  },
  {
    type: 'OpenAI Project / Private Key',
    regex: /sk-proj-[a-zA-Z0-9_\-]{20,}/i,
    advice: 'Las claves secretas de OpenAI no deben incluirse en el frontend. Usa variables de entorno o un proxy backend.'
  },
  {
    type: 'Stripe Live Secret Key',
    regex: /sk_live_[0-9a-zA-Z]{24,}/,
    advice: 'Se detectó una clave secreta en vivo de Stripe (sk_live_). En el cliente solo se debe usar la clave pública (pk_live_ o pk_test_).'
  },
  {
    type: 'Database Connection String with Password',
    regex: /postgres(?:ql)?:\/\/[a-zA-Z0-9_\-]+:[^@\s'"]+@[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9_\-]+/i,
    advice: 'Nunca conectes directamente con credenciales de PostgreSQL desde el frontend. Usa el cliente de base de datos provisto en "src/lib/db.js" o el proxy de backend.'
  },
  {
    type: 'Server Secret Environment Variable Hardcoded',
    regex: /(?:AWS_SECRET_ACCESS_KEY|JWT_SECRET|PRIVATE_KEY|AI_ACCOUNT_TOKEN)\s*[:=]\s*['"][^'"]{8,}['"]/i,
    advice: 'No hardcodees secretos de servidor en código frontend. Utiliza import.meta.env.* para variables públicas.'
  }
]

/**
 * Determina si la ruta corresponde a código compilado o accesible desde el cliente web.
 * @param {string} filePath
 * @returns {boolean}
 */
export function isClientSidePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  const clean = filePath.replace(/^\/+/, '').trim()
  return CLIENT_PATH_PATTERNS.some(p => p.test(clean))
}

/**
 * Escanea el contenido de un archivo en busca de credenciales privadas de servidor.
 * Solo bloquea si el archivo se ubica en el frontend (src/, public/, index.html).
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {{ hasSecret: boolean, secretType?: string, snippet?: string, advice?: string }}
 */
export function scanForExposedSecrets(filePath, content) {
  if (!content || typeof content !== 'string') {
    return { hasSecret: false }
  }

  if (!isClientSidePath(filePath)) {
    // Archivos de servidor (.env, migraciones, scripts, Edge Functions) pueden contener variables de servidor
    return { hasSecret: false }
  }

  for (const rule of SECRET_RULES) {
    const match = rule.regex.exec(content)
    if (match) {
      // Tomar un fragmento ofuscado para informar al usuario sin exponer la clave completa
      const matchedText = match[0]
      const redacted = matchedText.length > 20
        ? matchedText.slice(0, 10) + '...' + matchedText.slice(-6)
        : matchedText.slice(0, 5) + '...'

      return {
        hasSecret: true,
        secretType: rule.type,
        snippet: redacted,
        advice: rule.advice
      }
    }
  }

  return { hasSecret: false }
}
