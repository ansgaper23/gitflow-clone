import 'dotenv/config'

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback
  return value
}

export const config = {
  port: process.env.PORT || 8787,
  jwtSecret: required('JWT_SECRET', 'dev-secret-change-me'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:8787',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  supabaseOAuthClientId: process.env.SUPABASE_OAUTH_CLIENT_ID,
  supabaseOAuthClientSecret: process.env.SUPABASE_OAUTH_CLIENT_SECRET,
  previewOrchestratorUrl: process.env.PREVIEW_ORCHESTRATOR_URL,
  previewOrchestratorSecret: process.env.PREVIEW_ORCHESTRATOR_SECRET,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  // Pago manual por Yape/Plin (Perú): no hay API pública para cobrar sin cuenta de negocio, así
  // que se muestra este número/QR fijo y el pago se confirma a mano desde /admin (ver
  // routes/plans.js "yape-checkout" y routes/admin.js "payments/:id/approve"). yapePlinQrUrl es
  // opcional: si no se define, el checkout solo muestra el número para pagar.
  yapePlinPhone: process.env.YAPE_PLIN_PHONE,
  yapePlinQrUrl: process.env.YAPE_PLIN_QR_URL,
  usdPenRate: Number(process.env.USD_PEN_RATE) || 3.75,
  pdnsApiUrl: process.env.PDNS_API_URL,
  pdnsApiKey: process.env.PDNS_API_KEY,
  vpsPublicIp: process.env.VPS_PUBLIC_IP,
  // Connection string de un rol admin (NO el superusuario "postgres") con CREATEDB/CREATEROLE en
  // el Postgres propio del VPS — permite ofrecer "base de datos automática" como alternativa a
  // conectar Supabase, sin pedirle al usuario ninguna cuenta externa. Solo tiene sentido en el
  // VPS de producción (Postgres corre en 127.0.0.1 ahí, nunca expuesto a internet).
  vpsPgAdminUrl: process.env.VPS_PG_ADMIN_URL,
}

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey)
export const isGithubConfigured = Boolean(config.githubClientId && config.githubClientSecret)
export const isGoogleConfigured = Boolean(config.googleClientId && config.googleClientSecret)
export const isSupabaseOAuthConfigured = Boolean(config.supabaseOAuthClientId && config.supabaseOAuthClientSecret)
export const isPreviewConfigured = Boolean(config.previewOrchestratorUrl && config.previewOrchestratorSecret)
export const isStripeConfigured = Boolean(config.stripeSecretKey && config.stripeWebhookSecret)
export const isYapePlinConfigured = Boolean(config.yapePlinPhone)
export const isDnsConfigured = Boolean(config.pdnsApiUrl && config.pdnsApiKey && config.vpsPublicIp)
export const isVpsPgConfigured = Boolean(config.vpsPgAdminUrl)
