// Supabase Edge Function: serves a personal calendar feed (.ics) that Google
// Calendar can subscribe to. URL: /functions/v1/ics?token=<ics_token>[&mine=1]
// Deploy from the Supabase dashboard (Edge Functions → Deploy a new function →
// Via Editor), name it "ics", and turn OFF "Verify JWT". See README step 5.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SHORT: Record<string, string> = {
  design: 'Design', plan_check: 'Plan check', construction: 'Construction', client_changes: 'Client changes',
}

function esc(s: string) { return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n') }
function day(iso: string) { return iso.slice(0, 10).replace(/-/g, '') }
function nextDay(iso: string) { const d = new Date(iso.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, '') }
function stamp(d: Date) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') }

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const mine = url.searchParams.get('mine') === '1'
  if (!token) return new Response('Missing token', { status: 400 })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: profile } = await db.from('profiles').select('id, full_name').eq('ics_token', token).maybeSingle()
  if (!profile) return new Response('Unknown calendar', { status: 404 })

  const [{ data: jobs }, { data: phases }, { data: tasks }] = await Promise.all([
    db.from('jobs').select('id, name, due_date, status').neq('status', 'archived'),
    db.from('phases').select('id, job_id, kind, name, due_date, status, assignee_id'),
    db.from('tasks').select('id, job_id, title, due_date, scheduled_at, is_site_visit, status, assignee_id'),
  ])
  const jobName = new Map((jobs ?? []).map(j => [j.id, j.name]))
  const okJob = (id: string) => jobName.has(id)
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wisner Engineering Planner//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(mine ? `Planner — ${profile.full_name}` : 'Wisner Planner')}`, 'X-PUBLISHED-TTL:PT1H', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H']
  const now = stamp(new Date())
  const add = (uid: string, title: string, desc: string, date: string | null, time: string | null, done: boolean) => {
    if (!date && !time) return
    lines.push('BEGIN:VEVENT', `UID:${uid}@wisner-planner`, `DTSTAMP:${now}`, `SUMMARY:${esc((done ? '✓ ' : '') + title)}`, `DESCRIPTION:${esc(desc)}`)
    if (time) {
      const s = new Date(time); const e = new Date(s.getTime() + 3600000)
      lines.push(`DTSTART:${stamp(s)}`, `DTEND:${stamp(e)}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${day(date!)}`, `DTEND;VALUE=DATE:${nextDay(date!)}`)
    }
    lines.push('END:VEVENT')
  }

  for (const j of jobs ?? []) if (!mine) add(`job-${j.id}`, `Job due: ${j.name}`, j.name, j.due_date, null, j.status === 'complete')
  for (const p of phases ?? []) if (okJob(p.job_id) && (!mine || p.assignee_id === profile.id)) add(`phase-${p.id}`, `${SHORT[p.kind] ?? p.name} due — ${jobName.get(p.job_id)}`, p.name, p.due_date, null, p.status === 'complete')
  for (const t of tasks ?? []) if (okJob(t.job_id) && (!mine || t.assignee_id === profile.id || t.assignee_id == null)) add(`task-${t.id}`, (t.is_site_visit ? 'Site visit: ' : '') + t.title, jobName.get(t.job_id) ?? '', t.due_date, t.scheduled_at, t.status === 'done')
  lines.push('END:VCALENDAR')

  return new Response(lines.join('\r\n'), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, max-age=900', 'Access-Control-Allow-Origin': '*' },
  })
})
