import { addDays, format, isValid, parseISO } from 'date-fns'
import type { ContactLogEntry, FollowUp } from './planningTypes'
import type { Job } from './types'

export interface FollowUpQuery { q: string; job: string; status: 'open' | 'done' | 'all'; due: 'all' | 'overdue' | 'today' | 'week' | 'undated' }
export function validPlanningDate(value: string): boolean {
  const date = parseISO(value)
  return /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) && isValid(date) && format(date, 'yyyy-MM-dd') === value
}
export function parseFollowUpQuery(params: URLSearchParams): FollowUpQuery {
  const status = params.get('status'), due = params.get('due'), q = params.get('q') ?? ''
  return { q: q.trim() ? q : '', job: (params.get('job') ?? '').trim(), status: status === 'all' || status === 'done' ? status : 'open', due: due === 'overdue' || due === 'today' || due === 'week' || due === 'undated' ? due : 'all' }
}
export function writeFollowUpQuery(current: URLSearchParams, patch: Partial<FollowUpQuery>) {
  const next = new URLSearchParams(current)
  for (const [key, value] of Object.entries(patch)) next.set(key, value)
  const query = parseFollowUpQuery(next)
  for (const [key, fallback] of [['q', ''], ['job', ''], ['status', 'open'], ['due', 'all']] as const) {
    if (query[key] === fallback) next.delete(key)
    else next.set(key, query[key])
  }
  return next
}
export function latestContact(log: ContactLogEntry[]): ContactLogEntry | undefined {
  return log.map((entry, index) => ({ entry, index })).sort((a, b) => b.entry.date.localeCompare(a.entry.date) || b.index - a.index)[0]?.entry
}
export function filterFollowUps(rows: FollowUp[], query: FollowUpQuery, jobs: Job[], now = new Date()) {
  const today = format(now, 'yyyy-MM-dd'), end = format(addDays(now, 6), 'yyyy-MM-dd')
  const words = query.q.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return rows.filter(row => {
    if (query.status !== 'all' && row.status !== query.status || query.job && row.job_id !== query.job) return false
    const job = jobs.find(job => job.id === row.job_id)
    const text = [row.title, row.waiting_on, row.reason, row.notes, job?.name, job?.job_number, ...row.contact_log.map(entry => entry.note)].join(' ').toLowerCase()
    if (!words.every(word => text.includes(word))) return false
    switch (query.due) {
      case 'overdue': return Boolean(row.next_follow_up_date && row.next_follow_up_date < today)
      case 'today': return row.next_follow_up_date === today
      case 'week': return Boolean(row.next_follow_up_date && row.next_follow_up_date >= today && row.next_follow_up_date <= end)
      case 'undated': return !row.next_follow_up_date
      default: return true
    }
  }).sort((a, b) => (a.next_follow_up_date ?? '9999').localeCompare(b.next_follow_up_date ?? '9999') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}
