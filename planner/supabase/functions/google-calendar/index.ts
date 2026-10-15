// Supabase Edge Function: reads the signed-in person's Google Calendar.
//   POST { action: "calendars" }                      → list of their calendars
//   POST { action: "events", from, to, ids?: [...] }  → events between two ISO dates
// The Google access token is refreshed here, server-side, using the OAuth client
// secret stored in private_config (never sent to the browser).
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const authHeader = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ error: 'not_signed_in' }, 401)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: tok } = await admin.from('google_tokens').select('*').eq('user_id', user.id).maybeSingle()
  if (!tok) return json({ error: 'not_connected' }, 404)

  // Refresh the Google access token if it is missing or about to expire.
  let accessToken: string | null = tok.access_token
  if (!accessToken || !tok.expires_at || new Date(tok.expires_at).getTime() < Date.now() + 60_000) {
    const { data: cfg } = await admin.from('private_config').select('key, value').in('key', ['google_client_id', 'google_client_secret'])
    const conf = Object.fromEntries((cfg ?? []).map(r => [r.key, r.value]))
    if (!conf.google_client_id || !conf.google_client_secret) return json({ error: 'server_not_configured' }, 500)
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: conf.google_client_id, client_secret: conf.google_client_secret, refresh_token: tok.refresh_token, grant_type: 'refresh_token' }),
    })
    const data = await r.json()
    if (!r.ok || !data.access_token) {
      // Refresh token revoked or expired: forget it so the app shows "Connect" again.
      await admin.from('google_tokens').delete().eq('user_id', user.id)
      return json({ error: 'not_connected', detail: data.error ?? r.status }, 404)
    }
    accessToken = data.access_token as string
    await admin.from('google_tokens').update({ access_token: accessToken, expires_at: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('user_id', user.id)
  }

  const g = (path: string) => fetch(`https://www.googleapis.com/calendar/v3/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json())
  let body: { action?: string; from?: string; to?: string; ids?: string[] } = {}
  try { body = await req.json() } catch { /* empty body */ }

  if (body.action === 'calendars') {
    const list = await g('users/me/calendarList?minAccessRole=reader')
    const items = (list.items ?? []).map((c: Record<string, unknown>) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: Boolean(c.primary), color: c.backgroundColor ?? null }))
    return json({ calendars: items })
  }

  if (body.action === 'events') {
    const from = body.from ?? new Date().toISOString()
    const to = body.to ?? new Date(Date.now() + 30 * 86400000).toISOString()
    let ids = body.ids ?? []
    if (ids.length === 0) {
      const { data: prof } = await admin.from('profiles').select('google_calendar_ids').eq('id', user.id).maybeSingle()
      ids = prof?.google_calendar_ids?.length ? prof.google_calendar_ids : ['primary']
    }
    const results = await Promise.all(ids.map(async (id: string) => {
      const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' })
      const res = await g(`calendars/${encodeURIComponent(id)}/events?${q}`)
      return (res.items ?? []).filter((e: Record<string, unknown>) => e.status !== 'cancelled').map((e: Record<string, { date?: string; dateTime?: string }> & Record<string, unknown>) => ({
        id: `${id}:${e.id}`, calendarId: id, title: (e.summary as string) ?? '(no title)',
        start: e.start?.dateTime ?? e.start?.date ?? null, end: e.end?.dateTime ?? e.end?.date ?? null,
        allDay: Boolean(e.start?.date), link: (e.htmlLink as string) ?? null, location: (e.location as string) ?? null,
      }))
    }))
    return json({ events: results.flat() })
  }
  return json({ error: 'unknown_action' }, 400)
})
