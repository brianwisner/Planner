import { addDays, format, isValid, parseISO, startOfWeek } from 'date-fns'
import { allHours, entryRate, HOUR_STATUS_LABEL, type HourStatus } from './calc'
import type { Store } from './store'
import type { Client, Job, Phase, Task, TimeEntry } from './types'

export type TimeRange = 'week' | 'all' | 'custom'
export type TimeStatus = 'all' | 'completed' | 'running' | HourStatus
export interface TimeQuery { job: string; range: TimeRange; week: string; from: string; to: string; q: string; billable: 'all' | 'billable' | 'nonbillable'; status: TimeStatus; page: number }
export interface TimeRow { entry: TimeEntry; job?: Job; client?: Client; phase?: Phase; task?: Task; ownerName: string; rate: number; amount: number | null; status: HourStatus | 'running' | 'incomplete'; elapsedHours: number }
type TimeStore = Pick<Store, 'timeEntries' | 'jobs' | 'clients' | 'phases' | 'tasks' | 'profiles' | 'settings' | 'invoices' | 'deposits' | 'items'>
export const TIME_PAGE_SIZE = 50
const statuses: TimeStatus[] = ['all', 'completed', 'running', 'deposit', 'partial', 'unbilled', 'billed', 'paid', 'nonbillable']

export function validTimeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value)) && format(parseISO(value), 'yyyy-MM-dd') === value
}
export function timeWeek(date = new Date()): string { return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd') }
export function timeDays(week: string): string[] { return Array.from({ length: 7 }, (_, index) => format(addDays(parseISO(week), index), 'yyyy-MM-dd')) }

export function parseTimeQuery(params: URLSearchParams, now = new Date()): TimeQuery {
  const rawWeek = params.get('week') ?? ''
  const rawPage = params.get('page') ?? ''
  const q = params.get('q') ?? ''
  return {
    job: params.get('job') ?? '', range: params.get('range') === 'all' ? 'all' : params.get('range') === 'custom' ? 'custom' : 'week',
    week: validTimeDate(rawWeek) ? timeWeek(parseISO(rawWeek)) : timeWeek(now), from: params.get('from') ?? '', to: params.get('to') ?? '',
    q: q.trim() ? q : '', billable: params.get('billable') === 'billable' ? 'billable' : params.get('billable') === 'nonbillable' ? 'nonbillable' : 'all',
    status: statuses.includes(params.get('status') as TimeStatus) ? params.get('status') as TimeStatus : 'all',
    page: /^\d+$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) && Number(rawPage) > 0 ? Number(rawPage) : 1,
  }
}
export function writeTimeQuery(current: URLSearchParams, patch: Partial<TimeQuery>, now = new Date()): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of ['job', 'range', 'week', 'from', 'to', 'q', 'billable', 'status', 'page'] as const) if (patch[key] !== undefined) next.set(key, String(patch[key]))
  const value = parseTimeQuery(next, now)
  for (const [key, fallback] of Object.entries({ job: '', range: 'week', week: timeWeek(now), from: '', to: '', q: '', billable: 'all', status: 'all', page: 1 }) as [keyof TimeQuery, string | number][]) {
    if (value[key] === fallback) next.delete(key)
    else next.set(key, String(value[key]))
  }
  return next
}
export function timeRangeError(query: TimeQuery): string | null {
  if (query.range !== 'custom') return null
  if (!query.from || !query.to) return 'Choose a start date and an end date.'
  if (!validTimeDate(query.from) || !validTimeDate(query.to)) return 'Choose valid start and end dates.'
  return query.from > query.to ? 'The end date must be on or after the start date.' : null
}

function timestampKey(iso: string): string {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  if (!match || !Number.isFinite(Date.parse(match[1] + match[3]))) return iso
  return new Date(match[1] + match[3]).toISOString().slice(0, 19) + '.' + (match[2] ?? '').padEnd(6, '0')
}
export function timeRows(store: TimeStore, now = new Date()): TimeRow[] {
  const money = allHours(store)
  const jobs = new Map(store.jobs.map(job => [job.id, job])), clients = new Map(store.clients.map(client => [client.id, client]))
  const phases = new Map(store.phases.map(phase => [phase.id, phase])), tasks = new Map(store.tasks.map(task => [task.id, task]))
  return store.timeEntries.map(entry => {
    const job = jobs.get(entry.job_id), phase = entry.phase_id ? phases.get(entry.phase_id) : undefined, task = entry.task_id ? tasks.get(entry.task_id) : undefined
    const running = entry.hours == null && Boolean(entry.started_at)
    const elapsed = running ? (now.getTime() - Date.parse(entry.started_at!)) / 3600000 : 0
    const rate = entryRate(store, entry)
    return { entry, job, client: job ? clients.get(job.client_id) : undefined, phase: phase?.job_id === entry.job_id ? phase : undefined, task: task?.job_id === entry.job_id ? task : undefined,
      ownerName: store.profiles.find(profile => profile.id === entry.user_id)?.full_name ?? 'Saved owner', rate,
      amount: entry.hours == null ? null : entry.hours * rate, status: running ? 'running' as const : entry.hours == null ? 'incomplete' as const : money.get(entry.id)?.status ?? (entry.billable === false ? 'nonbillable' as const : 'unbilled' as const),
      elapsedHours: Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0 }
  }).sort((a, b) => b.entry.date.localeCompare(a.entry.date) || (timestampKey(a.entry.created_at) < timestampKey(b.entry.created_at) ? 1 : timestampKey(a.entry.created_at) > timestampKey(b.entry.created_at) ? -1 : 0) || a.entry.id.localeCompare(b.entry.id))
}
export function filterTimeRows(rows: TimeRow[], query: TimeQuery): TimeRow[] {
  if (timeRangeError(query)) return []
  const end = timeDays(query.week)[6]
  const words = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter(row => {
    const { entry } = row
    if (query.job && entry.job_id !== query.job) return false
    if (query.range === 'week' && (entry.date < query.week || entry.date > end)) return false
    if (query.range === 'custom' && (entry.date < query.from || entry.date > query.to)) return false
    if (query.billable === 'billable' && entry.billable === false || query.billable === 'nonbillable' && entry.billable !== false) return false
    if (query.status === 'completed' ? entry.hours == null : query.status !== 'all' && row.status !== query.status) return false
    const text = [row.job?.name, row.job?.job_number, row.client?.name, row.phase?.name, row.task?.title, entry.notes, row.ownerName].join(' ').toLowerCase()
    return words.every(word => text.includes(word))
  })
}
export function timeTotals(rows: TimeRow[]) {
  const completed = rows.filter(row => row.entry.hours != null)
  const hours = completed.reduce((sum, row) => sum + row.entry.hours!, 0)
  const nonbillable = completed.filter(row => row.entry.billable === false).reduce((sum, row) => sum + row.entry.hours!, 0)
  const running = rows.filter(row => row.status === 'running')
  return { hours, billable: hours - nonbillable, nonbillable, completed: completed.length, running: running.length, elapsed: running.reduce((sum, row) => sum + row.elapsedHours, 0) }
}
export function elapsedTime(hours: number): string {
  const minutes = Math.floor(Math.max(0, hours) * 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}
export function timeStatusLabel(row: TimeRow): string {
  return row.status === 'running' ? 'Running timer' : row.status === 'incomplete' ? 'No completed hours' : HOUR_STATUS_LABEL[row.status]
}
const csvText = (value: string) => /^\s*[=+\-@]/.test(value) ? `'${value}` : value
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places
export function timeCSV(rows: TimeRow[]): (string | number | null)[][] {
  return rows.map(row => [row.entry.date, csvText(row.client?.name ?? 'Client unavailable'), csvText(row.job?.job_number ?? ''), csvText(row.job?.name ?? 'Job unavailable'), csvText(row.phase?.name ?? 'General / unavailable phase'), csvText(row.task?.title ?? ''), csvText(row.ownerName),
    row.entry.hours == null ? null : round(row.entry.hours, 4), row.status === 'running' ? round(row.elapsedHours, 4) : null, round(row.rate), row.amount == null ? null : round(row.amount), row.entry.billable === false ? 'No' : 'Yes', timeStatusLabel(row), csvText(row.entry.notes)])
}
export const TIME_CSV_HEADERS = ['Date', 'Client', 'Job #', 'Job', 'Phase', 'Task', 'Recorded owner', 'Completed hours', 'Elapsed running hours', 'Rate $', 'Recorded work value $', 'Billable', 'Billing status', 'Notes']
