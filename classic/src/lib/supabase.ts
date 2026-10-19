import { createClient } from '@supabase/supabase-js'

// These two values identify your Supabase project. In production they are
// injected at build time from GitHub repository variables (see README).
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = createClient(
  SUPABASE_URL ?? 'https://not-configured.supabase.co',
  SUPABASE_ANON_KEY ?? 'not-configured',
)
