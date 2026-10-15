// Calculations shared by the dashboard, reports and billing pages.
import { addDays, format } from 'date-fns'
import type { Store } from './store'
import type { Job, Phase, Profile, TimeEntry } from './types'
import { sum } from './utils'

/** Hours for a timer that is being stopped now: quarter hours, minimum 0.25. */
export function timerHours(e: TimeEntry): number {
  return Math.max(0.25, Math.round(entryHours(e) * 4) / 4)
}

export function entryHours(e: TimeEntry): number {
  if (e.hours != null) return e.hours
  if (e.started_at) return (Date.now() - new Date(e.started_at).getTime()) / 3600000
  return 0
}

export function hoursForPhase(entries: TimeEntry[], phaseId: string): number {
  return sum(entries.filter(e => e.phase_id === phaseId).map(entryHours))
}

export function hoursForJob(entries: TimeEntry[], jobId: string): number {
  return sum(entries.filter(e => e.job_id === jobId).map(entryHours))
}

export function rateFor(user: Profile | undefined, defaultRate: number): number {
  return user?.hourly_rate ?? defaultRate
}

export interface JobBilling {
  job: Job
  loggedHours: number
  billedHours: number
  unbilledHours: number
  unbilledAmount: number   // unbilled hours × rate
  invoiced: number         // total of all invoices
  paid: number
  outstanding: number      // invoiced but not paid
  fee: number | null
}

export function jobBilling(store: Pick<Store, 'timeEntries' | 'invoices' | 'profiles' | 'settings'>, job: Job): JobBilling {
  const entries = store.timeEntries.filter(e => e.job_id === job.id && e.hours != null)
  const byUser = (e: TimeEntry) => rateFor(store.profiles.find(p => p.id === e.user_id), store.settings.default_rate)
  const billed = entries.filter(e => e.billed)
  const unbilled = entries.filter(e => !e.billed)
  const inv = store.invoices.filter(i => i.job_id === job.id)
  const invoiced = sum(inv.map(i => i.amount))
  const paid = sum(inv.filter(i => i.paid_date).map(i => i.amount))
  return {
    job,
    loggedHours: sum(entries.map(entryHours)),
    billedHours: sum(billed.map(entryHours)),
    unbilledHours: sum(unbilled.map(entryHours)),
    unbilledAmount: sum(unbilled.map(e => entryHours(e) * byUser(e))),
    invoiced, paid, outstanding: invoiced - paid, fee: job.fee,
  }
}

export interface Workload {
  user: Profile
  remainingHours: number      // estimate minus logged, across open phases they own
  openPhases: Phase[]
  bookedUntil: Date | null    // when they would be free at their weekly capacity
  weeksOut: number
  thisWeekLogged: number
}

export function teamWorkload(store: Pick<Store, 'profiles' | 'phases' | 'jobs' | 'timeEntries' | 'settings'>): Workload[] {
  const openJobs = new Set(store.jobs.filter(j => j.status === 'active').map(j => j.id))
  const weekStart = startOfWeekISO()
  return store.profiles.map(user => {
    const openPhases = store.phases.filter(p => p.assignee_id === user.id && p.status !== 'complete' && openJobs.has(p.job_id))
    const remaining = sum(openPhases.map(p => Math.max(0, p.estimate_hours - hoursForPhase(store.timeEntries, p.id))))
    const capacity = user.weekly_hours || store.settings.weekly_capacity || 40
    const weeksOut = capacity > 0 ? remaining / capacity : 0
    const bookedUntil = remaining > 0 ? addDays(new Date(), Math.ceil(weeksOut * 7)) : null
    const thisWeekLogged = sum(store.timeEntries.filter(e => e.user_id === user.id && e.date >= weekStart).map(entryHours))
    return { user, remainingHours: remaining, openPhases, bookedUntil, weeksOut, thisWeekLogged }
  })
}

export function startOfWeekISO(): string {
  const d = new Date()
  const day = d.getDay() // 0 = Sunday
  const diff = (day + 6) % 7 // Monday-based
  d.setDate(d.getDate() - diff)
  return format(d, 'yyyy-MM-dd')
}

/** Percentage of estimate used, capped at 999 to keep bars sane. */
export function pctUsed(logged: number, estimate: number): number {
  if (!estimate) return logged > 0 ? 100 : 0
  return Math.min(999, Math.round((logged / estimate) * 100))
}
