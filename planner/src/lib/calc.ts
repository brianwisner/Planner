// Calculations shared by the dashboard, reports and billing pages.
import { addDays, format } from 'date-fns'
import type { Store } from './store'
import type { Job, JobItem, Phase, Profile, TimeEntry } from './types'
import { sum } from './utils'

/** Hours for a timer that is being stopped now: quarter hours, minimum 0.25. */
export function timerHours(e: TimeEntry): number {
  return Math.max(0.25, Math.round(entryHours(e) * 4) / 4)
}

/** Default phase for new hours/schedule on a job: first unfinished phase, skipping Queued. */
export function workPhase(phases: Phase[], jobId: string): Phase | undefined {
  const jp = phases.filter(p => p.job_id === jobId)
  return jp.find(p => p.status !== 'complete' && p.kind !== 'queued') ?? jp.find(p => p.kind === 'design') ?? jp[0]
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

type MoneyStore = Pick<Store, 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings'>

/** The $/hour for a time entry: the rate saved on it, else the person's current rate. */
export function entryRate(store: Pick<Store, 'profiles' | 'settings'>, e: TimeEntry): number {
  return e.rate ?? rateFor(store.profiles.find(p => p.id === e.user_id), store.settings.default_rate)
}

export function entryAmount(store: Pick<Store, 'profiles' | 'settings'>, e: TimeEntry): number {
  return entryHours(e) * entryRate(store, e)
}

export function itemAmount(i: JobItem): number {
  return (Number(i.quantity) || 0) * (Number(i.unit_price) || 0)
}

/**
 * Where each hour or charge stands, money-wise:
 *  - deposit:  not on an invoice, paid for by the job's deposits
 *  - partial:  the deposit covers part of it, the rest still needs billing
 *  - unbilled: not on an invoice and no deposit left to cover it
 *  - billed:   on an invoice that hasn't been paid yet
 *  - paid:     on an invoice that has been paid
 * Deposits pay for un-invoiced hours AND charges oldest-first, so as work is
 * logged the deposit runs down and, once it's used up, new work shows as unbilled.
 */
export type HourStatus = 'deposit' | 'partial' | 'unbilled' | 'billed' | 'paid'

export interface HourMoney {
  entry: TimeEntry
  amount: number      // hours × rate
  covered: number     // $ of this entry paid by deposit
  status: HourStatus
}

export interface ItemMoney {
  item: JobItem
  amount: number      // quantity × unit price
  covered: number
  status: HourStatus
}

export const HOUR_STATUS_LABEL: Record<HourStatus, string> = {
  deposit: 'Paid by deposit',
  partial: 'Partly paid by deposit',
  unbilled: 'Not billed',
  billed: 'Billed, not paid',
  paid: 'Paid',
}

/** Hours and charges on one job, in date order, with deposit coverage and status. */
export function jobCharges(store: MoneyStore, jobId: string): { hours: HourMoney[]; items: ItemMoney[] } {
  const deposits = sum(store.deposits.filter(d => d.job_id === jobId).map(d => d.amount))
  const invoices = new Map(store.invoices.filter(i => i.job_id === jobId).map(i => [i.id, i]))
  type Row = { kind: 'h'; e: TimeEntry; date: string; at: string } | { kind: 'i'; it: JobItem; date: string; at: string }
  const rows: Row[] = [
    ...store.timeEntries.filter(e => e.job_id === jobId && e.hours != null).map(e => ({ kind: 'h' as const, e, date: e.date ?? '', at: e.created_at ?? '' })),
    ...store.items.filter(i => i.job_id === jobId).map(it => ({ kind: 'i' as const, it, date: it.date ?? '', at: it.created_at ?? '' })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at))
  let pool = deposits
  const hours: HourMoney[] = []
  const items: ItemMoney[] = []
  for (const r of rows) {
    const billed = r.kind === 'h' ? r.e.billed : r.it.billed
    const invoiceId = r.kind === 'h' ? r.e.invoice_id : r.it.invoice_id
    const amount = r.kind === 'h' ? entryAmount(store, r.e) : itemAmount(r.it)
    let covered = 0
    let status: HourStatus
    if (billed) {
      const inv = invoiceId ? invoices.get(invoiceId) : undefined
      status = inv?.paid_date ? 'paid' : 'billed'
    } else {
      covered = Math.max(0, Math.min(pool, amount))
      pool -= covered
      status = covered <= 0.005 ? 'unbilled' : covered >= amount - 0.005 ? 'deposit' : 'partial'
    }
    if (r.kind === 'h') hours.push({ entry: r.e, amount, covered, status })
    else items.push({ item: r.it, amount, covered, status })
  }
  return { hours, items }
}

export function jobHours(store: MoneyStore, jobId: string): HourMoney[] {
  return jobCharges(store, jobId).hours
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
  const c = jobCharges(store, jobId)
  let used = sum(c.hours.map(h => h.covered)) + sum(c.items.map(i => i.covered))
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
  hoursValue: number       // hours × their rates
  itemsValue: number       // charges (expenses, fees...)
  workValue: number        // hours + charges
  deposits: number         // deposits received
  depositUsed: number      // deposit money already used up by work
  depositRemaining: number // deposit money not yet worked against
  invoiced: number         // total of all invoices
  paid: number             // invoices that have been paid
  outstanding: number      // invoiced but not paid
  collected: number        // deposits + paid invoices (cash actually received)
  billedHours: number
  unbilledHours: number    // hours (or part-hours) nobody has paid or been billed for
  unbilledItems: number    // $ of charges not billed
  unbilledAmount: number   // $ of hours + charges not billed
  paidAmount: number       // work paid for (by deposit or paid invoice)
  waitingAmount: number    // work on unpaid invoices
  balance: number          // deposits + invoiced − work: drops as you work, rises when you bill
}

export function jobBilling(store: MoneyStore, job: Job): JobBilling {
  const { hours, items } = jobCharges(store, job.id)
  const all = [...hours, ...items]
  const deposits = sum(store.deposits.filter(d => d.job_id === job.id).map(d => d.amount))
  const inv = store.invoices.filter(i => i.job_id === job.id)
  const invoiced = sum(inv.map(i => i.amount))
  const paid = sum(inv.filter(i => i.paid_date).map(i => i.amount))
  const hoursValue = sum(hours.map(h => h.amount))
  const itemsValue = sum(items.map(i => i.amount))
  const workValue = hoursValue + itemsValue
  const depositUsed = sum(all.map(h => h.covered))
  const open = (s: HourStatus) => s === 'unbilled' || s === 'partial'
  const unbilledH = hours.filter(h => open(h.status))
  const unbilledItems = sum(items.filter(i => open(i.status)).map(i => i.amount - i.covered))
  return {
    job, fee: job.fee,
    loggedHours: sum(hours.map(h => entryHours(h.entry))),
    hoursValue, itemsValue, workValue, deposits, depositUsed, depositRemaining: deposits - depositUsed,
    invoiced, paid, outstanding: invoiced - paid, collected: deposits + paid,
    billedHours: sum(hours.filter(h => h.status === 'billed' || h.status === 'paid').map(h => entryHours(h.entry))),
    unbilledHours: sum(unbilledH.map(h => entryHours(h.entry) * (h.amount > 0 ? (h.amount - h.covered) / h.amount : 1))),
    unbilledItems,
    unbilledAmount: sum(unbilledH.map(h => h.amount - h.covered)) + unbilledItems,
    paidAmount: sum(all.map(h => h.status === 'paid' ? h.amount : h.covered)),
    waitingAmount: sum(all.filter(h => h.status === 'billed').map(h => h.amount)),
    balance: deposits + invoiced - workValue,
  }
}

/** Running job balance over time: one point per day something happened. */
export interface BalancePoint { date: string; balance: number; work: number; deposits: number; billed: number; notes: string[] }

export function balanceHistory(store: MoneyStore, jobId: string): BalancePoint[] {
  const events: { date: string; delta: number; kind: 'work' | 'deposit' | 'billed'; note: string }[] = []
  const { hours, items } = jobCharges(store, jobId)
  for (const h of hours) if (h.entry.date) events.push({ date: h.entry.date, delta: -h.amount, kind: 'work', note: '' })
  for (const i of items) if (i.item.date) events.push({ date: i.item.date, delta: -i.amount, kind: 'work', note: `Charge: ${i.item.description || i.item.category} ${fmtMoneyPlain(i.amount)}` })
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

/** The owner's full workload, including phases with legacy or no assignments. */
export function soloWorkload(store: Pick<Store, 'me' | 'phases' | 'jobs' | 'timeEntries' | 'settings'>): Omit<Workload, 'user'> {
  const openJobs = new Set(store.jobs.filter(j => j.status === 'active').map(j => j.id))
  const openPhases = store.phases.filter(p => p.status !== 'complete' && openJobs.has(p.job_id))
  const remainingHours = sum(openPhases.map(p => Math.max(0, p.estimate_hours - hoursForPhase(store.timeEntries, p.id))))
  const capacity = store.me?.weekly_hours || store.settings.weekly_capacity || 40
  const weeksOut = capacity > 0 ? remainingHours / capacity : 0
  const bookedUntil = remainingHours > 0 ? addDays(new Date(), Math.ceil(weeksOut * 7)) : null
  const weekStart = startOfWeekISO()
  const thisWeekLogged = sum(store.timeEntries.filter(e => e.date >= weekStart).map(entryHours))
  return { remainingHours, openPhases, bookedUntil, weeksOut, thisWeekLogged }
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
