import { supabase } from '../db/supabaseClient.js'

// Gate de acceso al panel reseller — igual patrón que requireAdmin/requireStaff, pero la fuente
// de verdad es la tabla reseller_licenses (no un flag en "users"): la licencia es el "pase" que
// FlowPro le vende/otorga al reseller, separado de si el usuario es o no admin de FlowPro.
export async function requireReseller(req, res, next) {
  const { data: license, error } = await supabase
    .from('reseller_licenses')
    .select('*')
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!license) return res.status(403).json({ error: 'No tenés una licencia de reseller', code: 'no_license' })
  if (license.status !== 'active') {
    return res.status(403).json({ error: 'Tu licencia de reseller no está activa', code: 'license_inactive' })
  }
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Tu licencia de reseller venció', code: 'license_expired' })
  }
  req.resellerLicense = license
  next()
}
