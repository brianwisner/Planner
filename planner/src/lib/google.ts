// Google account sign-in and Google Calendar reading.
//
// How it works: "Continue with Google" signs the person in through Supabase and
// asks Google for read access to their calendar. Google hands back a long-lived
// refresh token once; we save it in the google_tokens table (only that person
// can see their own row). The google-calendar edge function uses it to fetch
// events, so the browser never touches Google credentials.
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export const GOOGLE_SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar.readonly'

export function siteUrl() {
  return window.location.origin + window.location.pathname
}

/** Start Google sign-in (also used for "Connect Google Calendar"). */
export async function signInWithGoogle(hintDomain?: string) {
  const queryParams: Record<string, string> = { access_type: 'offline', prompt: 'consent' }
  if (hintDomain) queryParams.hd = hintDomain
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { scopes: GOOGLE_SCOPES, queryParams, redirectTo: siteUrl() },
  })
  return error?.message ?? null
}

/** After the Google redirect, Supabase gives us Google's tokens once. Keep them. */
export async function saveGoogleTokensFromSession(session: Session | null) {
  if (!session?.provider_refresh_token || !session.user) return false
  const { error } = await supabase.from('google_tokens').upsert({
    user_id: session.user.id,
    email: session.user.email ?? null,
    refresh_token: session.provider_refresh_token,
    access_token: session.provider_token ?? null,
    expires_at: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })
  return !error
}

export async function disconnectGoogle(userId: string) {
  await supabase.from('google_tokens').delete().eq('user_id', userId)
}

export interface GoogleCalendar { id: string; name: string; primary: boolean; color: string | null }
export interface GoogleEvent {
  id: string; calendarId: string; title: string
  start: string | null; end: string | null; allDay: boolean; link: string | null; location: string | null
}

async function call<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await supabase.functions.invoke('google-calendar', { body })
  if (error) {
    // Pull the JSON error code out of a non-2xx response if there is one.
    const ctx = (error as { context?: Response }).context
    try { const j = await ctx?.json(); if (j?.error) return { error: j.error } } catch { /* ignore */ }
    return { error: error.message }
  }
  if (data?.error) return { error: data.error }
  return { data: data as T }
}

export const listGoogleCalendars = () => call<{ calendars: GoogleCalendar[] }>({ action: 'calendars' })
export const listGoogleEvents = (from: string, to: string, ids?: string[]) => call<{ events: GoogleEvent[] }>({ action: 'events', from, to, ids })

const cache = new Map<string, { at: number; events: GoogleEvent[] }>()

/** Events from the signed-in person's chosen Google calendars for a date range. */
export function useGoogleEvents(connected: boolean, fromISO: string, toISO: string, calendarIds: string[]) {
  const [events, setEvents] = useState<GoogleEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = `${fromISO}|${toISO}|${calendarIds.join(',')}`
  useEffect(() => {
    if (!connected) { setEvents([]); return }
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) { setEvents(hit.events); return }
    let cancelled = false
    setLoading(true)
    listGoogleEvents(fromISO, toISO, calendarIds).then(r => {
      if (cancelled) return
      if (r.error) { setError(r.error); setEvents([]) }
      else { setError(null); setEvents(r.data!.events); cache.set(key, { at: Date.now(), events: r.data!.events }) }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [connected, key, fromISO, toISO, calendarIds])
  return { events, error, loading }
}

export function clearGoogleCache() { cache.clear() }
