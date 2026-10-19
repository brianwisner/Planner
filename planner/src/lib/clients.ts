import { addDays, format } from 'date-fns'
import { calendarItems, type CalItem } from './calendar'
import type { JobBilling } from './calc'
import { jobRows, type JobOverview } from './jobs'
import type { Client, Invoice } from './types'
import { sum } from './utils'

type ClientsStore = Parameters<typeof jobRows>[0]
export type ClientBilling = Omit<JobBilling, 'job' | 'fee'>
export type ClientsFocus = 'all' | 'open' | 'billing' | 'unbilled' | 'outstanding' | 'no_open' | 'missing_contact' | 'due'
export type ClientsSort = 'name' | 'open' | 'unbilled' | 'outstanding' | 'due'
export interface ClientsQuery { q: string; focus: ClientsFocus; sort: ClientsSort; dir: 'asc' | 'desc' }

export interface ClientOverview {
  client: Client
  jobs: JobOverview[] // every job, including archived financial history
  openJobs: JobOverview[] // active and on-hold follow-ups
  activeCount: number
  onHoldCount: number
  completeCount: number
  cancelledCount: number
  archivedCount: number
  billing: ClientBilling
  actualHours: number // completed and running effort across every historical owner
  completedHours: number
  billableHours: number
  nonBillableHours: number
  runningCount: number
  feeRevenue: number
  effectiveHourlyRate: number | null
  nextDeadline: CalItem | null
  deadlines: CalItem[] // unfinished deadlines on active/on-hold jobs only
  invoices: Invoice[]
  unpaidInvoices: Invoice[] // positive amounts awaiting payment
  contactMissing: boolean // neither an email address nor phone number
}

const FOCUSES: ClientsFocus[] = ['all', 'open', 'billing', 'unbilled', 'outstanding', 'no_open', 'missing_contact', 'due']
const SORTS: ClientsSort[] = ['name', 'open', 'unbilled', 'outstanding', 'due']

/** Keep raw nonblank text so URL-bound searches can accept word separators. */
export function parseClientsQuery(params: URLSearchParams): ClientsQuery {
  const q = params.get('q') ?? ''
  const focus = params.get('focus') as ClientsFocus
  const sort = params.get('sort') as ClientsSort
  return {
    q: q.trim() ? q : '', focus: FOCUSES.includes(focus) ? focus : 'all',
    sort: SORTS.includes(sort) ? sort : 'name', dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** Patch recognized filters while retaining unrelated URL parameters. */
export function writeClientsQuery(current: URLSearchParams, patch: Partial<ClientsQuery>): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of ['q', 'focus', 'sort', 'dir'] as const) {
    if (patch[key] !== undefined) next.set(key, patch[key]!)
  }
  const value = parseClientsQuery(next)
  for (const [key, fallback] of [['q', ''], ['focus', 'all'], ['sort', 'name'], ['dir', 'asc']] as const) {
    if (value[key] === fallback) next.delete(key)
    else next.set(key, value[key])
  }
  return next
}

// Compare instants without discarding PostgreSQL's fractional microseconds.
function timestampKey(iso: string): string {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  if (!match) return iso
  return new Date(match[1] + match[3]).toISOString().slice(0, 19) + '.' + (match[2] ?? '').padEnd(6, '0')
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const deadlineOrder = (a: CalItem, b: CalItem) => a.date.localeCompare(b.date) ||
  compare(timestampKey(a.time ?? ''), timestampKey(b.time ?? '')) || a.id.localeCompare(b.id)

function billingTotals(rows: JobOverview[]): ClientBilling {
  const totals: Omit<ClientBilling, 'effectiveHourlyRate'> = {
    loggedHours: 0, billableHours: 0, nonBillableHours: 0, nonBillableValue: 0,
    hoursValue: 0, itemsValue: 0, workValue: 0, deposits: 0, depositUsed: 0, depositRemaining: 0,
    invoiced: 0, paid: 0, outstanding: 0, collected: 0, feeRevenue: 0,
    billedHours: 0, unbilledHours: 0, unbilledItems: 0, unbilledAmount: 0,
    paidAmount: 0, waitingAmount: 0, balance: 0,
  }
  const keys = Object.keys(totals) as (keyof typeof totals)[]
  for (const row of rows) for (const key of keys) totals[key] += row.billing[key]
  return { ...totals, effectiveHourlyRate: totals.loggedHours > 0 ? totals.feeRevenue / totals.loggedHours : null }
}

/** Lifetime client totals reuse the same per-job effort and billing model. */
export function clientRows(store: ClientsStore, now = new Date()): ClientOverview[] {
  const rows = jobRows(store, now)
  const openJobs = store.jobs.filter(job => job.status === 'active' || job.status === 'on_hold')
  const deadlines = calendarItems({ ...store, jobs: openJobs }).filter(item => !item.done).sort(deadlineOrder)
  return [...store.clients].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)).map(client => {
    const jobs = rows.filter(row => row.job.client_id === client.id)
    const jobIds = new Set(jobs.map(row => row.job.id))
    const billing = billingTotals(jobs)
    const clientDeadlines = deadlines.filter(item => jobIds.has(item.jobId))
    const invoices = store.invoices.filter(invoice => jobIds.has(invoice.job_id)).sort((a, b) =>
      b.issued_date.localeCompare(a.issued_date) || compare(timestampKey(b.created_at), timestampKey(a.created_at)) || a.id.localeCompare(b.id))
    return {
      client, jobs, openJobs: jobs.filter(row => row.job.status === 'active' || row.job.status === 'on_hold'),
      activeCount: jobs.filter(row => row.job.status === 'active').length,
      onHoldCount: jobs.filter(row => row.job.status === 'on_hold').length,
      completeCount: jobs.filter(row => row.job.status === 'complete').length,
      cancelledCount: jobs.filter(row => row.job.status === 'cancelled').length,
      archivedCount: jobs.filter(row => row.job.status === 'archived').length,
      billing, actualHours: sum(jobs.map(row => row.actualHours)), completedHours: billing.loggedHours,
      billableHours: billing.billableHours, nonBillableHours: billing.nonBillableHours,
      runningCount: sum(jobs.map(row => row.runningCount)), feeRevenue: billing.feeRevenue,
      effectiveHourlyRate: billing.effectiveHourlyRate,
      nextDeadline: clientDeadlines[0] ?? null, deadlines: clientDeadlines, invoices,
      unpaidInvoices: invoices.filter(invoice => !invoice.paid_date && invoice.amount > 0.005),
      contactMissing: !client.email.trim() && !client.phone.trim(),
    }
  })
}

/** Filters and sorting never change source rows or their lifetime totals. */
export function filterClientRows(rows: ClientOverview[], query: ClientsQuery, now = new Date()): ClientOverview[] {
  const words = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const dueEnd = format(addDays(now, 6), 'yyyy-MM-dd')
  const filtered = rows.filter(row => {
    const { client } = row
    const text = [client.name, client.contact_name, client.email, client.phone, client.address,
      ...row.jobs.flatMap(({ job }) => [job.name, job.job_number, job.address])].join(' ').toLowerCase()
    if (!words.every(word => text.includes(word))) return false
    switch (query.focus) {
      case 'open': return row.openJobs.length > 0
      case 'no_open': return row.openJobs.length === 0
      case 'billing': return row.billing.unbilledAmount > 0.005 || row.billing.outstanding > 0.005
      case 'unbilled': return row.billing.unbilledAmount > 0.005
      case 'outstanding': return row.billing.outstanding > 0.005
      case 'missing_contact': return row.contactMissing
      case 'due': return row.nextDeadline != null && row.nextDeadline.date <= dueEnd
      default: return true
    }
  })
  const direction = query.dir === 'desc' ? -1 : 1
  return filtered.sort((a, b) => {
    let order = 0
    switch (query.sort) {
      case 'open': order = a.openJobs.length - b.openJobs.length; break
      case 'unbilled': order = a.billing.unbilledAmount - b.billing.unbilledAmount; break
      case 'outstanding': order = a.billing.outstanding - b.billing.outstanding; break
      case 'due':
        // Undated clients stay last in either direction.
        if (!a.nextDeadline || !b.nextDeadline) {
          if (Boolean(a.nextDeadline) !== Boolean(b.nextDeadline)) return a.nextDeadline ? -1 : 1
        } else order = a.nextDeadline.date.localeCompare(b.nextDeadline.date) ||
          compare(timestampKey(a.nextDeadline.time ?? ''), timestampKey(b.nextDeadline.time ?? ''))
        break
      default: order = a.client.name.localeCompare(b.client.name, undefined, { sensitivity: 'base' })
    }
    return direction * order || a.client.name.localeCompare(b.client.name, undefined, { sensitivity: 'base' }) || a.client.id.localeCompare(b.client.id)
  })
}
