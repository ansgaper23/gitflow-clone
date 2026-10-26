import { createClient } from '@supabase/supabase-js'
import { config, isSupabaseConfigured } from '../config.js'

export const supabase = isSupabaseConfigured
  ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null
