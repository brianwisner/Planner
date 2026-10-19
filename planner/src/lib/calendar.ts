// Calendar helpers: items that should appear on a calendar, a Google Calendar
// "add event" link, and an .ics file for importing into any calendar app.
import { addDays, format } from 'date-fns'
import type { Store } from './store'
import { PHASE_KIND_SHORT } from './types'

export interface CalItem {
  id: string
  date: string          // yyyy-mm-dd
  time: string | null   // ISO datetime for timed items (site visits)
  title: string
  kind: 'phase' | 'task' | 'site_visit' | 'job'
  jobId: string
  jobName: string
  clientName?: string
  jobNumber?: string
  assigneeId: string | null
  done: boolean
  link: string          // in-app route
}

export type CalendarMode = 'month' | 'agenda'
export type CalendarStatus = 'open' | 'all' | 'done'
export type CalendarKind = CalItem['kind'] | 'all'
export type CalendarFocus = 'all' | 'overdue' | 'today' | 'upcoming' | 'visits'
export interface CalendarQuery { job: string; q: string; kind: CalendarKind; status: CalendarStatus; view: CalendarMode; month: string; focus: CalendarFocus }
const kinds: CalendarKind[] = ['all', 'job', 'phase', 'task', 'site_visit']
const statuses: CalendarStatus[] = ['open', 'all', 'done']
const focuses: CalendarFocus[] = ['all', 'overdue', 'today', 'upcoming', 'visits']

export function parseCalendarQuery(params: URLSearchParams, now = new Date(), defaultView: CalendarMode = 'month'): CalendarQuery {
  const kind = params.get('kind') as CalendarKind, status = params.get('status') as CalendarStatus, focus = params.get('focus') as CalendarFocus
  const view = params.get('view'), month = params.get('month') ?? '', q = params.get('q') ?? ''
  return { job: (params.get('job') ?? '').trim(), q: q.trim() ? q : '', kind: kinds.includes(kind) ? kind : 'all', status: statuses.includes(status) ? status : 'open', focus: focuses.includes(focus) ? focus : 'all', view: view === 'month' || view === 'agenda' ? view : defaultView, month: /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) ? month : format(now, 'yyyy-MM') }
}

/** Keep unrelated links and raw search spaces when changing a calendar control. */
export function writeCalendarQuery(current: URLSearchParams, patch: Partial<CalendarQuery>, now = new Date(), defaultView: CalendarMode = 'month') {
  const next = new URLSearchParams(current)
  for (const [key, value] of Object.entries(patch)) next.set(key, value)
  const query = parseCalendarQuery(next, now, defaultView)
  for (const [key, fallback] of [['job', ''], ['q', ''], ['kind', 'all'], ['status', 'open'], ['focus', 'all'], ['month', format(now, 'yyyy-MM')]] as const) {
    if (query[key] === fallback) next.delete(key)
    else next.set(key, query[key])
  }
  if (next.has('view')) next.set('view', query.view)
  return next
}

export function calendarOrder(a: CalItem, b: CalItem): number {
  return a.date.localeCompare(b.date) || (a.time && b.time ? new Date(a.time).getTime() - new Date(b.time).getTime() : Number(Boolean(a.time)) - Number(Boolean(b.time))) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
}

export function calendarItems(store: Pick<Store, 'jobs' | 'phases' | 'tasks' | 'clients'>): CalItem[] {
  const items: CalItem[] = []
  const jobName = (id: string) => store.jobs.find(j => j.id === id)?.name ?? ''
  const context = (id: string) => {
    const job = store.jobs.find(job => job.id === id)
    return { clientName: store.clients.find(client => client.id === job?.client_id)?.name ?? '', jobNumber: job?.job_number ?? '' }
  }
  for (const j of store.jobs) {
    if (j.due_date && j.status !== 'archived' && j.status !== 'cancelled') {
      items.push({ id: `job-${j.id}`, date: j.due_date, time: null, title: `Job due: ${j.name}`, kind: 'job', jobId: j.id, jobName: j.name, ...context(j.id), assigneeId: null, done: j.status === 'complete', link: `/jobs/${j.id}` })
    }
  }
  for (const p of store.phases) {
    const job = store.jobs.find(j => j.id === p.job_id)
    if (!p.due_date || !job || job.status === 'archived' || job.status === 'cancelled') continue
    items.push({ id: `phase-${p.id}`, date: p.due_date, time: null, title: `${PHASE_KIND_SHORT[p.kind]} due — ${job.name}`, kind: 'phase', jobId: p.job_id, jobName: job.name, ...context(job.id), assigneeId: p.assignee_id, done: p.status === 'complete' || job.status === 'complete', link: `/jobs/${p.job_id}` })
  }
  for (const t of store.tasks) {
    const validTime = t.scheduled_at && Number.isFinite(new Date(t.scheduled_at).getTime()) ? t.scheduled_at : null
    const date = validTime ? format(new Date(validTime), 'yyyy-MM-dd') : t.due_date
    if (!date) continue
    const job = store.jobs.find(j => j.id === t.job_id)
    if (!job || job.status === 'archived' || job.status === 'cancelled') continue
    items.push({ id: `task-${t.id}`, date, time: validTime, title: t.title, kind: t.is_site_visit ? 'site_visit' : 'task', jobId: t.job_id, jobName: jobName(t.job_id), ...context(job.id), assigneeId: t.assignee_id, done: t.status === 'done' || job.status === 'complete', link: `/jobs/${t.job_id}?task=${t.id}` })
  }
  return items.sort(calendarOrder)
}

function icsDate(d: Date) { return format(d, "yyyyMMdd'T'HHmmss") }
function icsDay(iso: string) { return iso.replace(/-/g, '') }
function icsEscape(s: string) { return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n') }

export function googleCalendarLink(item: CalItem, siteUrl: string): string {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
  const text = encodeURIComponent(item.title)
  const details = encodeURIComponent(`${item.jobName}\n${siteUrl}#${item.link}`)
  let dates: string
  if (item.time) {
    const start = new Date(item.time)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    dates = `${icsDate(start)}/${icsDate(end)}`
  } else {
    const d = new Date(item.date + 'T00:00:00')
    const next = addDays(d, 1)
    dates = `${icsDay(item.date)}/${icsDay(format(next, 'yyyy-MM-dd'))}`
  }
  return `${base}&text=${text}&dates=${dates}&details=${details}`
}

export function buildICS(items: CalItem[], calendarName: string): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wisner Engineering Planner//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ]
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  for (const it of items) {
    lines.push('BEGIN:VEVENT', `UID:${it.id}@wisner-planner`, `DTSTAMP:${stamp}`, `SUMMARY:${icsEscape(it.title)}`, `DESCRIPTION:${icsEscape(it.jobName)}`)
    if (it.time) {
      const s = new Date(it.time)
      lines.push(`DTSTART:${icsDate(s)}`, `DTEND:${icsDate(new Date(s.getTime() + 3600000))}`)
    } else {
      const d = new Date(it.date + 'T00:00:00')
      const next = format(addDays(d, 1), 'yyyy-MM-dd')
      lines.push(`DTSTART;VALUE=DATE:${icsDay(it.date)}`, `DTEND;VALUE=DATE:${icsDay(next)}`)
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
