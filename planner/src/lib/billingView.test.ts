import { describe, expect, it } from 'vitest'
import { jobCharges } from './calc'
import { billingJobRows, canInvoice, filterBillingJobs, invoiceSelection, matchesWork, parseBillingQuery, workAmount, workRows, writeBillingQuery } from './billingView'
import type { Job, TimeEntry } from './types'

type Data = Parameters<typeof billingJobRows>[0]
const defaults = parseBillingQuery(new URLSearchParams())
function job(patch: Partial<Job> = {}): Job {
  return { id: 'job', client_id: 'client', job_number: '26-100', name: 'Maple residence', description: '', address: 'Ocean Road', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: '', ...patch }
}
function time(patch: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'hours', job_id: 'job', phase_id: null, task_id: null, user_id: 'legacy', date: '2026-10-18', hours: 1, started_at: null, rate: 100, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: '', ...patch }
}
function data(patch: Partial<Data> = {}): Data {
  return { clients: [{ id: 'client', name: 'Cedar Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: '' }], jobs: [job()], timeEntries: [], deposits: [], invoices: [], items: [], profiles: [], settings: { id: 1, company_name: 'Synthetic', default_rate: 150, weekly_capacity: 40 }, ...patch }
}

describe('billing view scopes and URL state', () => {
  it('normalizes malformed values but preserves direct archived links and raw search separators', () => {
    expect(parseBillingQuery(new URLSearchParams('tab=invalid&section=unknown&status=deleted&work=no&payment=no&q=%20%20'))).toEqual(defaults)
    expect(parseBillingQuery(new URLSearchParams('job=archived&tab=invoices&section=overview&status=all&q=%20Maple%20%20')))
      .toMatchObject({ job: 'archived', tab: 'invoices', section: 'overview', status: 'all', q: ' Maple  ' })
  })
  it('patches multiple filters without losing unrelated repeated parameters or mutating the URL', () => {
    const source = new URLSearchParams('tab=hours&tag=a&tag=b&keep=yes')
    const next = writeBillingQuery(source, { client: 'client', status: 'all', work: 'paid', detail: ' deposit ' })
    expect(parseBillingQuery(next)).toMatchObject({ tab: 'hours', client: 'client', status: 'all', work: 'paid', detail: ' deposit ' })
    expect(next.getAll('tag')).toEqual(['a', 'b'])
    expect(source.has('client')).toBe(false)
    expect(writeBillingQuery(next, defaults).toString()).toBe('tag=a&tag=b&keep=yes')
  })
  it('keeps completed/cancelled obligations in default totals and permits explicit archived history', () => {
    const jobs = [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'complete', status: 'complete' }), job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' })]
    const rows = billingJobRows(data({ jobs, timeEntries: jobs.map(row => time({ id: row.id, job_id: row.id })) }))
    expect(filterBillingJobs(rows, defaults).map(row => row.job.id).sort()).toEqual(['cancelled', 'complete', 'hold', 'job'])
    expect(filterBillingJobs(rows, { ...defaults, status: 'all' })).toHaveLength(5)
    expect(filterBillingJobs(rows, { ...defaults, status: 'open' }).map(row => row.job.id).sort()).toEqual(['hold', 'job'])
    expect(filterBillingJobs(rows, { ...defaults, status: 'archived' }).map(row => row.job.id)).toEqual(['archived'])
  })
  it('AND-searches client/job context and does not count nonbillable or deposit-covered work as ready', () => {
    const rows = billingJobRows(data({ jobs: [job(), job({ id: 'nb' }), job({ id: 'covered' })],
      timeEntries: [time(), time({ id: 'nb', job_id: 'nb', billable: false }), time({ id: 'covered', job_id: 'covered' })],
      deposits: [{ id: 'deposit', job_id: 'covered', amount: 100, received_date: '2026-10-18', method: '', notes: '', created_at: '' }],
    }))
    expect(filterBillingJobs(rows, { ...defaults, q: ' CEDAR  maple OCEAN 26-100 ', focus: 'unbilled' }).map(row => row.job.id)).toEqual(['job'])
    expect(filterBillingJobs(rows, { ...defaults, scope: 'missing' })).toEqual([])
    expect(filterBillingJobs(rows, { ...defaults, client: 'missing' })).toEqual([])
  })
})

describe('billing work selection and filtered amounts', () => {
  it('splits paid deposit coverage and unpaid invoice remainder without charging nonbillable value', () => {
    const row = { status: 'billed' as const, amount: 150, covered: 100 }
    expect(matchesWork(row, 'paid')).toBe(true)
    expect(workAmount(row, 'paid')).toBe(100)
    expect(workAmount(row, 'billed')).toBe(50)
    expect(workAmount(row, 'all')).toBe(150)
    expect(workAmount({ ...row, status: 'paid' }, 'paid')).toBe(150)
    expect(workAmount({ ...row, status: 'nonbillable' }, 'all')).toBe(0)
  })
  it('selects only eligible completed work, preserves mixed IDs, and reports hidden selected rows', () => {
    const s = data({ timeEntries: [time({ id: 'same' }), time({ id: 'nb', billable: false }), time({ id: 'running', hours: null, started_at: '2026-10-18T10:00:00Z' }), time({ id: 'billed', billed: true })],
      deposits: [{ id: 'deposit', job_id: 'job', amount: 50, received_date: '2026-10-18', method: '', notes: '', created_at: '' }],
      items: [{ id: 'same', job_id: 'job', date: '2026-10-18', category: 'Expense', description: '', quantity: 1, unit_price: 30, billed: false, invoice_id: null, deposit_applied: null, created_by: null, created_at: '' }],
    })
    const rows = workRows(jobCharges(s, 'job'))
    const selected = new Set(['hours:same', 'charge:same', 'hours:nb', 'hours:running', 'hours:billed', 'hours:missing'])
    const result = invoiceSelection(rows, selected, new Set(['hours:same']))
    expect(result.entryIds).toEqual(['same'])
    expect(result.itemIds).toEqual(['same'])
    expect(result.amount).toBe(80)
    expect(result.hidden).toBe(1)
    expect(selected.size).toBe(6)
  })
  it('drops stale invoice-linked or reclassified rows rather than reusing their selected IDs', () => {
    const rows = workRows(jobCharges(data({ timeEntries: [time({ invoice_id: 'legacy-link' }), time({ id: 'nb', billable: false })] }), 'job'))
    expect(rows.every(row => !canInvoice(row))).toBe(true)
    expect(invoiceSelection(rows, new Set(['hours:hours', 'hours:nb']), new Set()).chosen).toEqual([])
  })
})
