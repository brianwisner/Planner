// Calendar helpers: items that should appear on a calendar, a Google Calendar
// "add event" link, and an .ics file for importing into any calendar app.
import { format } from 'date-fns'
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
  assigneeId: string | null
  done: boolean
  link: string          // in-app route
}

export function calendarItems(store: Pick<Store, 'jobs' | 'phases' | 'tasks' | 'clients'>): CalItem[] {
  const items: CalItem[] = []
  const jobName = (id: string) => store.jobs.find(j => j.id === id)?.name ?? ''
  for (const j of store.jobs) {
    if (j.due_date && j.status !== 'archived') {
      items.push({ id: `job-${j.id}`, date: j.due_date, time: null, title: `Job due: ${j.name}`, kind: 'job', jobId: j.id, jobName: j.name, assigneeId: null, done: j.status === 'complete', link: `/jobs/${j.id}` })
    }
  }
  for (const p of store.phases) {
    const job = store.jobs.find(j => j.id === p.job_id)
    if (!p.due_date || !job || job.status === 'archived') continue
    items.push({ id: `phase-${p.id}`, date: p.due_date, time: null, title: `${PHASE_KIND_SHORT[p.kind]} due — ${job.name}`, kind: 'phase', jobId: p.job_id, jobName: job.name, assigneeId: p.assignee_id, done: p.status === 'complete', link: `/jobs/${p.job_id}` })
  }
  for (const t of store.tasks) {
    const date = t.scheduled_at ? format(new Date(t.scheduled_at), 'yyyy-MM-dd') : t.due_date
    if (!date) continue
    const job = store.jobs.find(j => j.id === t.job_id)
    if (!job || job.status === 'archived') continue
    items.push({ id: `task-${t.id}`, date, time: t.scheduled_at, title: t.title, kind: t.is_site_visit ? 'site_visit' : 'task', jobId: t.job_id, jobName: jobName(t.job_id), assigneeId: t.assignee_id, done: t.status === 'done', link: `/jobs/${t.job_id}?task=${t.id}` })
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
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
    const next = new Date(d.getTime() + 24 * 3600 * 1000)
    dates = `${icsDay(item.date)}/${icsDay(format(next, 'yyyy-MM-dd'))}`
  }
  return `${base}&text=${text}&dates=${dates}&details=${details}`
}

export function buildICS(items: CalItem[], calendarName: string): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wisner Engineering Planner//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ]
  const stamp = icsDate(new Date()) + 'Z'
  for (const it of items) {
    lines.push('BEGIN:VEVENT', `UID:${it.id}@wisner-planner`, `DTSTAMP:${stamp}`, `SUMMARY:${icsEscape(it.title)}`, `DESCRIPTION:${icsEscape(it.jobName)}`)
    if (it.time) {
      const s = new Date(it.time)
      lines.push(`DTSTART:${icsDate(s)}`, `DTEND:${icsDate(new Date(s.getTime() + 3600000))}`)
    } else {
      const d = new Date(it.date + 'T00:00:00')
      const next = format(new Date(d.getTime() + 86400000), 'yyyy-MM-dd')
      lines.push(`DTSTART;VALUE=DATE:${icsDay(it.date)}`, `DTEND;VALUE=DATE:${icsDay(next)}`)
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
