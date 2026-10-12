import express from 'express'
import cors from 'cors'
import { config, isSupabaseConfigured, isGithubConfigured, isSupabaseOAuthConfigured, isStripeConfigured } from './config.js'
import { supabase } from './db/supabaseClient.js'
import { authRouter } from './routes/auth.js'
import { supabaseAuthRouter } from './routes/supabaseAuth.js'
import { reposRouter } from './routes/repos.js'
import { conversationsRouter } from './routes/conversations.js'
import { changesRouter } from './routes/changes.js'
import { plansRouter } from './routes/plans.js'
import { adminRouter } from './routes/admin.js'
import { dbConnectionsRouter } from './routes/dbConnections.js'
import { dbChangesRouter } from './routes/dbChanges.js'
import { edgeFunctionChangesRouter } from './routes/edgeFunctionChanges.js'
import { dbImportRouter } from './routes/dbImport.js'
import { assetChangesRouter } from './routes/assetChanges.js'
import { previewRouter } from './routes/preview.js'
import { projectsRouter } from './routes/projects.js'
import { appAiRouter } from './routes/appAi.js'
import { agentsRouter } from './routes/agents.js'
import { analyticsRouter } from './routes/analytics.js'
import { stripeWebhookRouter } from './routes/stripeWebhook.js'
import { dbProxyRouter } from './routes/dbProxy.js'
import { dbAdminProxyRouter } from './routes/dbAdminProxy.js'
import { storageProxyRouter } from './routes/storageProxy.js'
import { turnActionsRouter } from './routes/turnActions.js'
import { resellerRouter } from './routes/reseller.js'
import { THUMBNAILS_DIR } from './services/projectThumbnail.js'
import { PROJECT_ASSETS_DIR } from './routes/projects.js'

const app = express()

app.set('trust proxy', 1)
// Pública, sin restricción de origen: la llaman las apps que construyen los usuarios, no solo
// el frontend propio de FlowPro — publicadas en <slug>.flow-pro.online o un dominio propio, no
// en config.frontendUrl. OJO: en Express, montar este cors() abierto ANTES del restrictivo de
// abajo no alcanza para "exceptuar" la ruta — un app.use() sin path (como el de abajo) corre
// para TODAS las rutas sin importar el orden de registro, y como cors() escribe el header (no
// lo agrega), el que corre después pisa el valor del que corrió antes. Por eso el restrictivo
// de abajo excluye explícitamente estos dos prefijos en vez de confiar en el orden.
app.use('/api/app-ai', cors())
// Pública también: la llama el script de tracking desde <slug>.flow-pro.online (origin
// distinto al del frontend), no desde el propio frontend de FlowPro.
app.use('/api/track', cors())
// Pública también: la llama el frontend de la app publicada (leer/escribir en la "base de
// datos automática" desde el navegador) — mismo motivo que las dos de arriba, origin distinto
// al del frontend de FlowPro. El "public_token" en la URL es la autenticación real acá, no el
// origin.
app.use('/api/db-proxy', cors())
// Mismo motivo que "/api/db-proxy": la llama el navegador de la app publicada para leer/escribir
// archivos de Storage, origin distinto al del frontend de FlowPro.
app.use('/api/storage-proxy', cors())
// Pública también: la llama el runtime reporter del preview desde *.flow-pro.online
app.use('/api/preview/runtime-report', cors())
app.use((req, res, next) => {
  if (
    req.path.startsWith('/api/app-ai') ||
    req.path.startsWith('/api/track') ||
    req.path.startsWith('/api/db-proxy') ||
    req.path.startsWith('/api/storage-proxy') ||
    req.path.startsWith('/api/preview/runtime-report') ||
    req.path.includes('/telemetry/errors')
  ) {
    return cors()(req, res, next)
  }
  return cors({ origin: config.frontendUrl })(req, res, next)
})
// Stripe firma el body crudo del webhook — tiene que montarse con express.raw() ANTES del
// express.json() global de abajo, si no la verificación de firma siempre falla.
app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter)
app.use(express.json({ limit: '2mb' }))
// Nginx ya proxea todo /api/ al backend (ver /etc/nginx/sites-available/gitflow), así que
// montar acá adentro es la forma más simple de que estas imágenes resuelvan en producción sin
// tocar la config de nginx. Nunca van a frontend/dist: ese directorio se borra y reemplaza
// entero en cada deploy del frontend.
app.use('/api/thumbnails', express.static(THUMBNAILS_DIR, { maxAge: '7d' }))
app.use('/api/project-assets', express.static(PROJECT_ASSETS_DIR, { maxAge: '7d' }))

app.get('/api/health', async (req, res) => {
  let aiAccountsActive = 0
  if (isSupabaseConfigured) {
    const { count } = await supabase
      .from('ai_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    aiAccountsActive = count || 0
  }
  res.json({
    ok: true,
    supabaseConfigured: isSupabaseConfigured,
    githubConfigured: isGithubConfigured,
    stripeConfigured: isStripeConfigured,
    aiAccountsActive,
  })
})

app.use('/api/auth', authRouter)
app.use('/api/auth/supabase', supabaseAuthRouter)
app.use('/api/repos', reposRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/changes', changesRouter)
app.use('/api/plans', plansRouter)
app.use('/api/admin', adminRouter)
app.use('/api/db-connections', dbConnectionsRouter)
app.use('/api/db-proxy', dbProxyRouter)
app.use('/api/db-admin-proxy', dbAdminProxyRouter)
app.use('/api/storage-proxy', storageProxyRouter)
app.use('/api/db-changes', dbChangesRouter)
app.use('/api/edge-function-changes', edgeFunctionChangesRouter)
app.use('/api/db-import', dbImportRouter)
app.use('/api/asset-changes', assetChangesRouter)
app.use('/api/preview', previewRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/turn', turnActionsRouter)
app.use('/api/reseller', resellerRouter)
app.use('/api/app-ai', appAiRouter)
app.use('/api/agents', agentsRouter)
app.use('/api', analyticsRouter)

app.use((err, req, res, next) => {
  console.error(err)
  // Devolver el mensaje real para poder debugear qué falló
  res.status(500).json({ error: err.message ? `Error interno: ${err.message}` : 'Error interno del servidor' })
})

app.listen(config.port, () => {
  console.log(`FlowPro backend escuchando en http://localhost:${config.port}`)
  if (!isSupabaseConfigured) console.warn('⚠ Supabase no configurado (.env) — la API fallará en la mayoría de rutas.')
  if (!isGithubConfigured) console.warn('⚠ GitHub OAuth no configurado (.env) — el login no funcionará.')
  if (!isSupabaseOAuthConfigured)
    console.warn('⚠ Supabase OAuth no configurado (.env) — el botón "Conectar con Supabase" de 1 clic no funcionará (la conexión manual sigue disponible).')
  if (!isStripeConfigured)
    console.warn('⚠ Stripe no configurado (.env) — los pagos usan el flujo simulado hasta que cargues STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET.')
})
