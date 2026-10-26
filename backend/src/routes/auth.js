import { Router } from 'express'
import { config, isGithubConfigured, isGoogleConfigured } from '../config.js'
import { supabase } from '../db/supabaseClient.js'
import { signSession, verifySession } from '../services/jwt.js'
import { hashPassword, verifyPassword } from '../services/passwordAuth.js'
import { requireAuth, hasActivePlan, isTrialActive, trialExpiresAt, hasAccess } from '../middleware/auth.js'

export const authRouter = Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LINK_STATE_TTL_MS = 10 * 60 * 1000
const pendingGithubLinks = new Map() // state -> { userId, expiresAt }
const pendingGoogleLinks = new Map() // state -> { userId, expiresAt }

function createLinkState(map, userId) {
  const state = crypto.randomUUID()
  map.set(state, { userId, expiresAt: Date.now() + LINK_STATE_TTL_MS })
  return state
}

function consumeLinkState(map, state) {
  const entry = map.get(state)
  if (!entry) return null
  map.delete(state)
  if (entry.expiresAt < Date.now()) return null
  return entry.userId
}

// --- Email / contraseña ---

authRouter.post('/register', async (req, res) => {
  const { email, password, name, ref } = req.body || {}
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email inválido' })
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' })
  }
  if (!supabase) return res.status(503).json({ error: 'Backend no configurado: falta Supabase' })

  const normalizedEmail = email.trim().toLowerCase()
  const { data: existing } = await supabase.from('users').select('id').eq('email', normalizedEmail).maybeSingle()
  if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese email' })


  let reseller_id = null
  if (ref) {
    let query = supabase.from('reseller_licenses').select('user_id')
    if (ref.startsWith('RSL-')) {
      query = query.eq('license_key', ref)
    } else {
      query = query.ilike('license_key', `RSL-${ref}%`)
    }
    const { data: rl } = await query.limit(1).maybeSingle()
    if (rl) reseller_id = rl.user_id
  }
  const passwordHash = await hashPassword(password)
  const { data: created, error } = await supabase
    .from('users')
    .insert({ email: normalizedEmail, password_hash: passwordHash, name: name?.trim() || null, reseller_id })
    .select('id')
    .single()
  if (error) return res.status(500).json({ error: error.message })

  res.status(201).json({ token: signSession(created.id) })
})

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (!email || !password) return res.status(400).json({ error: 'Falta email o contraseña' })
  if (!supabase) return res.status(503).json({ error: 'Backend no configurado: falta Supabase' })

  const normalizedEmail = email.trim().toLowerCase()
  const { data: user } = await supabase.from('users').select('*').eq('email', normalizedEmail).maybeSingle()
  if (!user || !user.password_hash) return res.status(401).json({ error: 'Email o contraseña incorrectos' })

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Email o contraseña incorrectos' })

  
  let resellerPaymentUrl = null
  if (user.reseller_id) {
    const { data: rl } = await supabase.from('reseller_licenses').select('payment_url').eq('user_id', user.reseller_id).maybeSingle()
    if (rl && rl.payment_url) resellerPaymentUrl = rl.payment_url
  }

  res.json({
    resellerPaymentUrl: resellerPaymentUrl,
    resellerId: user.reseller_id, token: signSession(user.id) })
})

// --- GitHub OAuth (login normal, o "conectar" una cuenta ya logueada por email/Google) ---

authRouter.get('/github/login', (req, res) => {
  if (!isGithubConfigured) {
    return res.status(503).send('GitHub OAuth no está configurado en el backend (.env)')
  }
  let state
  if (req.query.linkToken) {
    const userId = verifySession(req.query.linkToken)
    if (userId) state = createLinkState(pendingGithubLinks, userId)
  }
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/github/callback`,
    scope: 'repo delete_repo read:user user:email',
    ...(state ? { state } : {}),
  })
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`)
})

authRouter.get('/github/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.redirect(`${config.frontendUrl}/auth?error=missing_code`)

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        code,
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return res.redirect(`${config.frontendUrl}/auth?error=token_exchange_failed`)
    }
    // La app tiene "expiring user tokens" activado en GitHub: el access_token vence en unas
    // horas (tokenData.expires_in) y viene con un refresh_token para renovarlo — ver
    // services/github.js -> getValidGithubToken(), que lo usa para renovar solo, sin que el
    // usuario tenga que reconectar cada vez que expira.
    const githubTokenFields = {
      github_refresh_token: tokenData.refresh_token || null,
      github_token_expires_at: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null,
    }

    const ghUserRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'gitflow-clone' },
    })
    const ghUser = await ghUserRes.json()

    if (!supabase) {
      return res.redirect(`${config.frontendUrl}/auth?error=supabase_not_configured`)
    }

    const linkUserId = state ? consumeLinkState(pendingGithubLinks, state) : null

    const { data: existingByGithub } = await supabase
      .from('users')
      .select('*')
      .eq('github_id', String(ghUser.id))
      .maybeSingle()

    let userId
    if (linkUserId) {
      if (existingByGithub && existingByGithub.id !== linkUserId) {
        return res.redirect(`${config.frontendUrl}/account?error=github_already_linked`)
      }
      userId = linkUserId
      await supabase
        .from('users')
        .update({
          github_id: String(ghUser.id),
          github_login: ghUser.login,
          avatar_url: ghUser.avatar_url,
          github_access_token: tokenData.access_token,
          ...githubTokenFields,
        })
        .eq('id', userId)
    } else if (existingByGithub) {
      userId = existingByGithub.id
      await supabase
        .from('users')
        .update({
          github_login: ghUser.login,
          avatar_url: ghUser.avatar_url,
          github_access_token: tokenData.access_token,
          ...githubTokenFields,
        })
        .eq('id', userId)
    } else {
      const { data: created, error } = await supabase
        .from('users')
        .insert({
          github_id: String(ghUser.id),
          github_login: ghUser.login,
          avatar_url: ghUser.avatar_url,
          email: ghUser.email,
          github_access_token: tokenData.access_token,
          ...githubTokenFields,
        })
        .select('id')
        .single()
      if (error) throw error
      userId = created.id
    }

    if (linkUserId) {
      return res.redirect(`${config.frontendUrl}/account?github_connected=1`)
    }
    const session = signSession(userId)
    res.redirect(`${config.frontendUrl}/auth/callback?token=${session}`)
  } catch (err) {
    console.error(err)
    res.redirect(`${config.frontendUrl}/auth?error=server_error`)
  }
})

// --- Google OAuth (solo login/registro, no da acceso a repos) ---

authRouter.get('/google/login', (req, res) => {
  if (!isGoogleConfigured) {
    return res.status(503).send('Google OAuth no está configurado en el backend (.env)')
  }
  let state
  if (req.query.linkToken) {
    const userId = verifySession(req.query.linkToken)
    if (userId) state = createLinkState(pendingGoogleLinks, userId)
  }
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    ...(state ? { state } : {}),
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
})

authRouter.get('/google/callback', async (req, res) => {
  const { code, state } = req.query
  if (!code) return res.redirect(`${config.frontendUrl}/auth?error=missing_code`)

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        code,
        redirect_uri: `${req.protocol}://${req.get('host')}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return res.redirect(`${config.frontendUrl}/auth?error=token_exchange_failed`)
    }

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    })
    const info = await infoRes.json() // { sub, email, name, picture }

    if (!supabase) {
      return res.redirect(`${config.frontendUrl}/auth?error=supabase_not_configured`)
    }

    const linkUserId = state ? consumeLinkState(pendingGoogleLinks, state) : null

    const { data: existingByGoogle } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', info.sub)
      .maybeSingle()

    let userId
    if (linkUserId) {
      if (existingByGoogle && existingByGoogle.id !== linkUserId) {
        return res.redirect(`${config.frontendUrl}/account?error=google_already_linked`)
      }
      userId = linkUserId
      await supabase
        .from('users')
        .update({ google_id: info.sub, name: info.name })
        .eq('id', userId)
    } else if (existingByGoogle) {
      userId = existingByGoogle.id
      await supabase
        .from('users')
        .update({ name: info.name, avatar_url: existingByGoogle.avatar_url || info.picture })
        .eq('id', userId)
    } else {
      const { data: byEmail } = info.email
        ? await supabase.from('users').select('id').eq('email', info.email.toLowerCase()).maybeSingle()
        : { data: null }

      if (byEmail) {
        userId = byEmail.id
        await supabase.from('users').update({ google_id: info.sub, name: info.name, avatar_url: info.picture }).eq('id', userId)
      } else {
        const { data: created, error } = await supabase
          .from('users')
          .insert({ google_id: info.sub, email: info.email ? info.email.toLowerCase() : null, name: info.name, avatar_url: info.picture })
          .select('id')
          .single()
        if (error) throw error
        userId = created.id
      }
    }

    if (linkUserId) {
      return res.redirect(`${config.frontendUrl}/account?google_connected=1`)
    }
    const session = signSession(userId)
    res.redirect(`${config.frontendUrl}/auth/callback?token=${session}`)
  } catch (err) {
    console.error(err)
    res.redirect(`${config.frontendUrl}/auth?error=server_error`)
  }
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = req.user

  // Igual criterio de "licencia activa" que /api/reseller/status — acá solo para decidir si
  // AppNav muestra el link al panel, no para autorizar nada (eso lo sigue haciendo
  // requireReseller en cada request real al panel).
  const { data: resellerLicense } = await supabase
    .from('reseller_licenses')
    .select('status, expires_at')
    .eq('user_id', user.id)
    .maybeSingle()
  const isReseller = Boolean(
    resellerLicense && resellerLicense.status === 'active' && (!resellerLicense.expires_at || new Date(resellerLicense.expires_at) > new Date()),
  )

  
  let resellerPaymentUrl = null
  if (user.reseller_id) {
    const { data: rl } = await supabase.from('reseller_licenses').select('payment_url').eq('user_id', user.reseller_id).maybeSingle()
    if (rl && rl.payment_url) resellerPaymentUrl = rl.payment_url
  }

  res.json({
    resellerPaymentUrl: resellerPaymentUrl,
    resellerId: user.reseller_id,
    id: user.id,
    name: user.name,
    githubLogin: user.github_login,
    githubConnected: Boolean(user.github_access_token),
    googleConnected: Boolean(user.google_id),
    avatarUrl: user.avatar_url,
    email: user.email,
    hasPassword: Boolean(user.password_hash),
    planId: user.plan_id,
    planExpiresAt: user.plan_expires_at,
    planActive: hasActivePlan(user),
    trialActive: isTrialActive(user),
    trialExpiresAt: trialExpiresAt(user),
    canUseAgent: hasAccess(user),
    creditsUsed: user.credits_used,
    isAdmin: user.is_admin,
    isCollaborator: user.is_collaborator,
    isReseller,
  })
})
