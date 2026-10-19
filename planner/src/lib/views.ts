// Read-only summaries that several pages share (job cards, Today, Money).
import { addDays, format, parseISO } from 'date-fns'
import type { Store } from './store'
import type { Client, Job, Phase, Task } from './types'
import { entryHours, jobBilling, type JobBilling } from './calc'
import { jobPhaseGroups } from './phases'
import { jobStage, type JobStage } from './stages'
import { calendarItems, type CalItem } from './calendar'
import { sum, todayISO } from './utils'

export type ViewStore = Pick<Store, 'jobs' | 'clients' | 'phases' | 'tasks' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings' | 'schedule'>

export const jobLabel = (job: Pick<Job, 'job_number' | 'name'>) => job.job_number ? `${job.job_number} · ${job.name}` : job.name

export function clientFor(store: Pick<Store, 'jobs' | 'clients'>, jobId: string | null | undefined): Client | undefined {
  const job = store.jobs.find(j => j.id === jobId)
  return job ? store.clients.find(c => c.id === job.client_id) : undefined
}

/** Open tasks first by date (undated last), started work first, then manual order. */
export function taskOrder(a: Task, b: Task): number {
  const da = a.scheduled_at?.slice(0, 10) ?? a.due_date, db = b.scheduled_at?.slice(0, 10) ?? b.due_date
  if (da !== db) return da == null ? 1 : db == null ? -1 : da.localeCompare(db)
  const rank = (t: Task) => t.status === 'doing' ? 0 : t.status === 'todo' ? 1 : t.status === 'waiting' ? 2 : 3
  return rank(a) - rank(b) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
}

export interface Deadline { date: string; label: string; kind: 'job' | 'phase' | 'task' }

export interface JobSummary {
  job: Job
  client: Client | undefined
  stage: JobStage
  phases: Phase[]
  openTasks: Task[]
  nextTask: Task | undefined
  nextDeadline: Deadline | null
  hours: number
  estimate: number
  money: JobBilling
  plannedAhead: number
}

export function summarizeJob(store: ViewStore, job: Job, today = todayISO()): JobSummary {
  const phases = jobPhaseGroups(store.phases, job.id).workflow
  const openTasks = store.tasks.filter(t => t.job_id === job.id && t.status !== 'done').sort(taskOrder)
  const closed = job.status === 'complete' || job.status === 'cancelled' || job.status === 'archived'
  const deadlines: Deadline[] = []
  if (!closed) {
    if (job.due_date) deadlines.push({ date: job.due_date, label: 'Job due', kind: 'job' })
    for (const p of phases) if (p.due_date && p.status !== 'complete') deadlines.push({ date: p.due_date, label: `${p.name} due`, kind: 'phase' })
    for (const t of openTasks) if (t.due_date) deadlines.push({ date: t.due_date, label: t.title, kind: 'task' })
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date))
  const hours = sum(store.timeEntries.filter(e => e.job_id === job.id).map(entryHours))
  return {
    job,
    client: store.clients.find(c => c.id === job.client_id),
    stage: jobStage(store.phases, job.id),
    phases,
    openTasks,
    nextTask: openTasks.find(t => t.status !== 'waiting') ?? openTasks[0],
    nextDeadline: deadlines[0] ?? null,
    hours,
    estimate: sum(phases.map(p => p.estimate_hours)),
    money: jobBilling(store, job),
    plannedAhead: sum(store.schedule.filter(s => s.job_id === job.id && s.date >= today).map(s => s.hours)),
  }
}

/** Deadlines and dated tasks from open work, ready for the Today page. */
export function openAgenda(store: Pick<Store, 'jobs' | 'phases' | 'tasks' | 'clients'>): CalItem[] {
  const open = new Set(store.jobs.filter(j => j.status === 'active' || j.status === 'on_hold').map(j => j.id))
  return calendarItems(store).filter(i => !i.done && open.has(i.jobId))
}

export interface WeekDay { date: string; planned: number; logged: number; capacity: number; isToday: boolean; weekend: boolean }

/** Seven days from Monday: planned hours (active jobs), hours logged, and capacity. */
export function weekDays(store: Pick<Store, 'schedule' | 'timeEntries' | 'jobs' | 'settings' | 'me'>, monday: string, today = todayISO()): WeekDay[] {
  const active = new Set(store.jobs.filter(j => j.status === 'active').map(j => j.id))
  const weekly = store.me?.weekly_hours || store.settings.weekly_capacity || 40
  return Array.from({ length: 7 }, (_, i) => {
    const date = format(addDays(parseISO(monday), i), 'yyyy-MM-dd')
    const weekend = i >= 5
    return {
      date,
      planned: sum(store.schedule.filter(s => s.date === date && active.has(s.job_id)).map(s => s.hours)),
      logged: sum(store.timeEntries.filter(e => e.date === date && e.hours != null).map(e => e.hours)),
      capacity: weekend ? 0 : weekly / 5,
      isToday: date === today,
      weekend,
    }
  })
}

export function mondayOf(iso: string): string {
  const d = parseISO(iso)
  const diff = (d.getDay() + 6) % 7
  return format(addDays(d, -diff), 'yyyy-MM-dd')
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** Late items on open jobs: tasks past due (not waiting on someone) and phase/job deadlines. */
export function lateCount(store: Pick<Store, 'jobs' | 'phases' | 'tasks' | 'clients'>, today = todayISO()): number {
  const open = new Set(store.jobs.filter(j => j.status === 'active' || j.status === 'on_hold').map(j => j.id))
  const tasks = store.tasks.filter(t => t.status !== 'done' && t.status !== 'waiting' && open.has(t.job_id) && (t.scheduled_at?.slice(0, 10) ?? t.due_date ?? '9999') < today).length
  const other = openAgenda(store).filter(i => (i.kind === 'phase' || i.kind === 'job') && i.date < today).length
  return tasks + other
}
