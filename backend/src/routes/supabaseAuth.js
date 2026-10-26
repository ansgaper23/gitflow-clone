import { Router } from 'express'
import { config, isSupabaseOAuthConfigured } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { buildAuthorizeUrl, createState, consumeState, exchangeCodeForTokens } from '../services/supabaseOAuth.js'

export const supabaseAuthRouter = Router()

supabaseAuthRouter.get('/login-url', requireAuth, (req, res) => {
  const { projectId, label } = req.query
  if (!projectId) return res.status(400).json({ error: 'Falta el parámetro projectId' })
  if (!isSupabaseOAuthConfigured) {
    return res.status(503).json({ error: 'La conexión de 1 clic con Supabase no está configurada en el backend (.env)' })
  }
  // El label lo eligió el usuario ANTES de salir a Supabase (ver DbConnectionPanel) — viaja en
  // el state porque el callback vuelve sin body, solo query params fijos.
  const state = createState(req.user.id, projectId, label?.trim() || null)
  res.json({ url: buildAuthorizeUrl(state) })
})

supabaseAuthRouter.get('/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query

  const entry = state ? consumeState(state) : null
  if (!entry) {
    return res.redirect(`${config.frontendUrl}/dashboard?supabase_error=invalid_state`)
  }
  const redirectBase = `${config.frontendUrl}/chat/${entry.projectId}`

  if (oauthError || !code) {
    return res.redirect(`${redirectBase}?supabase_error=${encodeURIComponent(oauthError || 'missing_code')}`)
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // INSERT de una cuenta nueva, no update — así vincular otra cuenta desde un proyecto B nunca
    // pisa la que ya usa el proyecto A (antes esto vivía en 4 columnas de "users", un solo
    // vínculo global por usuario).
    const { count } = await supabase
      .from('supabase_oauth_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', entry.userId)
    const label = entry.label || `Cuenta ${(count || 0) + 1}`

    const { data: account, error } = await supabase
      .from('supabase_oauth_accounts')
      .insert({
        user_id: entry.userId,
        label,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
      })
      .select('id')
      .single()
    if (error) throw error

    res.redirect(`${redirectBase}?supabase_connected=1&supabase_account_id=${account.id}`)
  } catch (err) {
    console.error(err)
    res.redirect(`${redirectBase}?supabase_error=server_error`)
  }
})
