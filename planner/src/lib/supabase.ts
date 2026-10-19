import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMockClient } from '../demo/mockSupabase'

// These two values identify your Supabase project. In production they are
// read at build time from planner/.env.production.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** `npm run demo` swaps in an in-memory database filled with made-up jobs. */
export const DEMO: boolean = __DEMO__

export const isConfigured = DEMO || Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase: SupabaseClient = DEMO
  ? createMockClient() as unknown as SupabaseClient
  : createClient(SUPABASE_URL ?? 'https://not-configured.supabase.co', SUPABASE_ANON_KEY ?? 'not-configured')
