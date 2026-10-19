import { jobBilling, type HourMoney, type HourStatus, type ItemMoney, type JobBilling } from './calc'
import type { Store } from './store'
import type { Job, JobStatus } from './types'

export type BillingTab = 'jobs' | 'invoices' | 'deposits' | 'hours'
export type BillingSection = 'work' | 'invoices' | 'deposits' | 'overview'
export type WorkFilter = 'all' | 'unbilled' | 'billed' | 'paid' | 'nonbillable'
export interface BillingQuery {
  tab: BillingTab; section: BillingSection; job: string; q: string; client: string; scope: string
  status: JobStatus | 'nonarchived' | 'open' | 'all'
  focus: 'all' | 'unbilled' | 'outstanding'
  work: WorkFilter; payment: 'all' | 'unpaid' | 'paid'; detail: string
}
export const WORK_FILTERS: { key: WorkFilter; label: string }[] = [
  { key: 'unbilled', label: 'Ready to bill' }, { key: 'all', label: 'All work' },
  { key: 'billed', label: 'Billed, awaiting payment' }, { key: 'paid', label: 'Paid work' },
  { key: 'nonbillable', label: 'Nonbillable' },
]
const defaults: BillingQuery = { tab: 'jobs', section: 'work', job: '', q: '', client: '', scope: '',
  status: 'nonarchived', focus: 'all', work: 'unbilled', payment: 'unpaid', detail: '' }
const options = {
  tab: ['jobs', 'invoices', 'deposits', 'hours'], section: ['work', 'invoices', 'deposits', 'overview'],
  status: ['nonarchived', 'open', 'all', 'active', 'on_hold', 'complete', 'cancelled', 'archived'],
  focus: ['all', 'unbilled', 'outstanding'], work: WORK_FILTERS.map(filter => filter.key), payment: ['all', 'unpaid', 'paid'],
}

export function parseBillingQuery(params: URLSearchParams): BillingQuery {
  const result = { ...defaults }
  for (const key of ['job', 'q', 'client', 'scope', 'detail'] as const) {
    const value = params.get(key) ?? ''
    result[key] = value.trim() ? (key === 'q' || key === 'detail' ? value : value.trim()) : ''
  }
  for (const key of ['tab', 'section', 'status', 'focus', 'work', 'payment'] as const) {
    const value = params.get(key)
    if (value && (options[key] as readonly string[]).includes(value)) Object.assign(result, { [key]: value })
  }
  return result
}

export function writeBillingQuery(current: URLSearchParams, patch: Partial<BillingQuery>): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of Object.keys(defaults) as (keyof BillingQuery)[]) if (patch[key] !== undefined) next.set(key, patch[key]!)
  const value = parseBillingQuery(next)
  for (const key of Object.keys(defaults) as (keyof BillingQuery)[]) {
    if (value[key] === defaults[key]) next.delete(key)
    else next.set(key, value[key])
  }
  return next
}

type BillingStore = Pick<Store, 'jobs' | 'clients' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings'>
export interface BillingJobRow { job: Job; clientName: string; billing: JobBilling }
export function billingJobRows(store: BillingStore): BillingJobRow[] {
  return store.jobs.map(job => ({ job, clientName: store.clients.find(client => client.id === job.client_id)?.name ?? '',
    billing: jobBilling(store, job) })).sort((a, b) => a.billing.balance - b.billing.balance || a.job.priority - b.job.priority || a.job.id.localeCompare(b.job.id))
}
export function matchesBillingText(text: string, search: string): boolean {
  return search.trim().toLowerCase().split(/\s+/).filter(Boolean).every(word => text.toLowerCase().includes(word))
}
export function filterBillingJobs(rows: BillingJobRow[], query: BillingQuery): BillingJobRow[] {
  return rows.filter(({ job, clientName, billing }) => {
    if (query.status === 'nonarchived' ? job.status === 'archived' : query.status === 'open' ?
      job.status !== 'active' && job.status !== 'on_hold' : query.status !== 'all' && job.status !== query.status) return false
    if (query.client && job.client_id !== query.client || query.scope && job.id !== query.scope) return false
    if (!matchesBillingText([job.name, job.job_number, job.address, clientName].join(' '), query.q)) return false
    return query.focus === 'unbilled' ? billing.unbilledAmount > 0.005 : query.focus === 'outstanding' ? billing.outstanding > 0.005 : true
  })
}

export type BillingWork = (HourMoney & { kind: 'hours'; id: string }) | (ItemMoney & { kind: 'charge'; id: string })
export function workRows(charges: { hours: HourMoney[]; items: ItemMoney[] }): BillingWork[] {
  return [...charges.hours.map(row => ({ ...row, kind: 'hours' as const, id: `hours:${row.entry.id}` })),
    ...charges.items.map(row => ({ ...row, kind: 'charge' as const, id: `charge:${row.item.id}` }))]
    .sort((a, b) => (b.kind === 'hours' ? b.entry.date : b.item.date).localeCompare(a.kind === 'hours' ? a.entry.date : a.item.date) || a.id.localeCompare(b.id))
}
export function matchesWork(row: { status: HourStatus; covered: number }, filter: WorkFilter): boolean {
  return filter === 'all' || (filter === 'unbilled' ? row.status === 'unbilled' || row.status === 'partial' :
    filter === 'paid' ? row.status !== 'nonbillable' && (row.status === 'paid' || row.covered > 0.005) : row.status === filter)
}
/** Filtered amounts split deposit coverage from the invoice remainder. */
export function workAmount(row: { status: HourStatus; amount: number; covered: number }, filter: WorkFilter): number {
  if (row.status === 'nonbillable') return 0
  if (filter === 'paid') return row.status === 'paid' ? row.amount : row.covered
  if (filter === 'all') return row.amount
  return Math.max(0, row.amount - row.covered)
}
export function canInvoice(row: BillingWork): boolean {
  const source = row.kind === 'hours' ? row.entry : row.item
  return (row.status === 'unbilled' || row.status === 'partial') && !source.billed && !source.invoice_id &&
    (row.kind !== 'hours' || row.entry.billable !== false && row.entry.hours != null)
}

export function invoiceSelection(rows: BillingWork[], selected: ReadonlySet<string>, visible: ReadonlySet<string>) {
  const eligible = rows.filter(canInvoice)
  const chosen = eligible.filter(row => selected.has(row.id))
  return { chosen, eligible, hidden: chosen.filter(row => !visible.has(row.id)).length,
    entryIds: chosen.filter(row => row.kind === 'hours').map(row => row.entry.id),
    itemIds: chosen.filter(row => row.kind === 'charge').map(row => row.item.id),
    amount: chosen.reduce((total, row) => total + Math.max(0, row.amount - row.covered), 0),
  }
}
