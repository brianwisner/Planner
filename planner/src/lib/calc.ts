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

type MoneyStore = Pick<Store, 'timeEntries' | 'invoices' | 'deposits' | 'profiles' | 'settings'>

/** The $/hour for a time entry: the rate saved on it, else the person's current rate. */
export function entryRate(store: Pick<Store, 'profiles' | 'settings'>, e: TimeEntry): number {
  return e.rate ?? rateFor(store.profiles.find(p => p.id === e.user_id), store.settings.default_rate)
}

export function entryAmount(store: Pick<Store, 'profiles' | 'settings'>, e: TimeEntry): number {
  return entryHours(e) * entryRate(store, e)
}

/**
 * Where each hour stands, money-wise:
 *  - deposit:  not on an invoice, paid for by the job's deposits
 *  - partial:  the deposit covers part of it, the rest still needs billing
 *  - unbilled: not on an invoice and no deposit left to cover it
 *  - billed:   on an invoice that hasn't been paid yet
 *  - paid:     on an invoice that has been paid
 * Deposits pay for un-invoiced hours oldest-first, so as you log hours the
 * deposit runs down and, once it's used up, new hours show as unbilled.
 */
export type HourStatus = 'deposit' | 'partial' | 'unbilled' | 'billed' | 'paid'

export interface HourMoney {
  entry: TimeEntry
  amount: number      // hours × rate
  covered: number     // $ of this entry paid by deposit
  status: HourStatus
}

export const HOUR_STATUS_LABEL: Record<HourStatus, string> = {
  deposit: 'Paid by deposit',
  partial: 'Partly paid by deposit',
  unbilled: 'Not billed',
  billed: 'Billed, not paid',
  paid: 'Paid',
}

export function jobHours(store: MoneyStore, jobId: string): HourMoney[] {
  const deposits = sum(store.deposits.filter(d => d.job_id === jobId).map(d => d.amount))
  const invoices = new Map(store.invoices.filter(i => i.job_id === jobId).map(i => [i.id, i]))
  const entries = store.timeEntries
    .filter(e => e.job_id === jobId && e.hours != null)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
  let pool = deposits
  return entries.map(e => {
    const amount = entryAmount(store, e)
    if (e.billed) {
      const inv = e.invoice_id ? invoices.get(e.invoice_id) : undefined
      return { entry: e, amount, covered: 0, status: inv?.paid_date ? 'paid' : 'billed' }
    }
    const covered = Math.max(0, Math.min(pool, amount))
    pool -= covered
    const status: HourStatus = covered <= 0.005 ? 'unbilled' : covered >= amount - 0.005 ? 'deposit' : 'partial'
    return { entry: e, amount, covered, status }
  })
}

/** Money status of every completed time entry, across all jobs. */
export function allHours(store: MoneyStore): Map<string, HourMoney> {
  const jobIds = new Set(store.timeEntries.map(e => e.job_id))
  const out = new Map<string, HourMoney>()
  for (const id of jobIds) for (const h of jobHours(store, id)) out.set(h.entry.id, h)
  return out
}

/** How much of each deposit has been worked against (oldest deposit used first). */
export function depositUsage(store: MoneyStore, jobId: string): Map<string, number> {
  let used = sum(jobHours(store, jobId).map(h => h.covered))
  const out = new Map<string, number>()
  for (const d of store.deposits.filter(d => d.job_id === jobId)) {
    const u = Math.min(d.amount, used)
    out.set(d.id, u)
    used -= u
  }
  return out
}

export interface JobBilling {
  job: Job
  fee: number | null
  loggedHours: number
  workValue: number        // all hours × their rates
  deposits: number         // deposits received
  depositUsed: number      // deposit money already used up by hours
  depositRemaining: number // deposit money not yet worked against
  invoiced: number         // total of all invoices
  paid: number             // invoices that have been paid
  outstanding: number      // invoiced but not paid
  collected: number        // deposits + paid invoices (cash actually received)
  billedHours: number
  unbilledHours: number    // hours (or part-hours) nobody has paid or been billed for
  unbilledAmount: number
  paidAmount: number       // work paid for (by deposit or paid invoice)
  waitingAmount: number    // work on unpaid invoices
  balance: number          // deposits + invoiced − work: drops as you work, rises when you bill
}

export function jobBilling(store: MoneyStore, job: Job): JobBilling {
  const hours = jobHours(store, job.id)
  const deposits = sum(store.deposits.filter(d => d.job_id === job.id).map(d => d.amount))
  const inv = store.invoices.filter(i => i.job_id === job.id)
  const invoiced = sum(inv.map(i => i.amount))
  const paid = sum(inv.filter(i => i.paid_date).map(i => i.amount))
  const workValue = sum(hours.map(h => h.amount))
  const depositUsed = sum(hours.map(h => h.covered))
  const unbilled = hours.filter(h => h.status === 'unbilled' || h.status === 'partial')
  const unbilledAmount = sum(unbilled.map(h => h.amount - h.covered))
  return {
    job, fee: job.fee,
    loggedHours: sum(hours.map(h => entryHours(h.entry))),
    workValue, deposits, depositUsed, depositRemaining: deposits - depositUsed,
    invoiced, paid, outstanding: invoiced - paid, collected: deposits + paid,
    billedHours: sum(hours.filter(h => h.status === 'billed' || h.status === 'paid').map(h => entryHours(h.entry))),
    unbilledHours: sum(unbilled.map(h => entryHours(h.entry) * (h.amount > 0 ? (h.amount - h.covered) / h.amount : 1))),
    unbilledAmount,
    paidAmount: sum(hours.map(h => h.status === 'paid' ? h.amount : h.covered)),
    waitingAmount: sum(hours.filter(h => h.status === 'billed').map(h => h.amount)),
    balance: deposits + invoiced - workValue,
  }
}

/** Running job balance over time: one point per day something happened. */
export interface BalancePoint { date: string; balance: number; work: number; deposits: number; billed: number; notes: string[] }

export function balanceHistory(store: MoneyStore, jobId: string): BalancePoint[] {
  const events: { date: string; delta: number; kind: 'work' | 'deposit' | 'billed'; note: string }[] = []
  for (const h of jobHours(store, jobId)) if (h.entry.date) events.push({ date: h.entry.date, delta: -h.amount, kind: 'work', note: '' })
  for (const d of store.deposits.filter(d => d.job_id === jobId)) events.push({ date: d.received_date, delta: d.amount, kind: 'deposit', note: `Deposit ${fmtMoneyPlain(d.amount)}` })
  for (const i of store.invoices.filter(i => i.job_id === jobId)) events.push({ date: i.issued_date, delta: i.amount, kind: 'billed', note: `Invoice ${i.number} ${fmtMoneyPlain(i.amount)}` })
  events.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const out: BalancePoint[] = []
  let bal = 0
  for (const ev of events) {
    bal += ev.delta
    let pt = out[out.length - 1]
    if (!pt || pt.date !== ev.date) { pt = { date: ev.date, balance: 0, work: 0, deposits: 0, billed: 0, notes: [] }; out.push(pt) }
    pt.balance = bal
    if (ev.kind === 'work') pt.work += -ev.delta
    if (ev.kind === 'deposit') pt.deposits += ev.delta
    if (ev.kind === 'billed') pt.billed += ev.delta
    if (ev.note) pt.notes.push(ev.note)
  }
  return out
}

function fmtMoneyPlain(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
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
