import { describe, expect, it } from 'vitest'
import { clientRows, filterClientRows, parseClientsQuery, writeClientsQuery, type ClientsQuery } from './clients'
import type { Client, Deposit, Invoice, Job, JobItem, Phase, Task, TimeEntry } from './types'

type ClientsStore = Parameters<typeof clientRows>[0]
const now = new Date('2026-10-18T10:30:00')
const stamp = '2026-10-01T12:00:00Z'
const defaults: ClientsQuery = { q: '', focus: 'all', sort: 'name', dir: 'asc' }

function client(patch: Partial<Client> = {}): Client {
  return { id: 'client', name: 'Cedar Architecture', contact_name: 'Dana Client', email: 'dana@example.test',
    phone: '555-0100', address: '10 Elm Street', notes: 'Private meeting notes', is_sample: false, created_at: stamp, ...patch }
}
function job(patch: Partial<Job> = {}): Job {
  return { id: 'job', client_id: 'client', name: 'Seaside house', job_number: '26-003', address: '200 Ocean Road',
    description: '', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: stamp, ...patch }
}
function phase(patch: Partial<Phase> = {}): Phase {
  return { id: 'phase', job_id: 'job', name: 'Design', kind: 'design', sort_order: 2, status: 'in_progress',
    estimate_hours: 10, start_date: null, due_date: null, assignee_id: null, notes: '', ...patch }
}
function task(patch: Partial<Task> = {}): Task {
  return { id: 'task', job_id: 'job', phase_id: null, title: 'Review framing', description: '', status: 'todo',
    assignee_id: null, due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: null,
    recurrence: 'none', recurrence_parent_id: null, sort_order: 0, completed_at: null, created_by: null, created_at: stamp, ...patch }
}
function time(patch: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'time', job_id: 'job', phase_id: null, task_id: null, user_id: 'owner', date: '2026-10-18',
    hours: 1, started_at: null, rate: 100, notes: '', billable: true, billed: false, invoice_id: null,
    deposit_applied: null, created_at: stamp, ...patch }
}
function invoice(patch: Partial<Invoice> = {}): Invoice {
  return { id: 'invoice', job_id: 'job', number: 'INV-1', amount: 1000, issued_date: '2026-10-18', paid_date: null,
    notes: '', created_at: stamp, ...patch }
}
function deposit(patch: Partial<Deposit> = {}): Deposit {
  return { id: 'deposit', job_id: 'job', amount: 100, received_date: '2026-10-01', method: '', notes: '', created_at: stamp, ...patch }
}
function item(patch: Partial<JobItem> = {}): JobItem {
  return { id: 'item', job_id: 'job', date: '2026-10-01', category: 'Expense', description: 'Separate charge', quantity: 1,
    unit_price: 100, billed: false, invoice_id: null, deposit_applied: null, created_by: null, created_at: stamp, ...patch }
}
function store(patch: Partial<ClientsStore> = {}): ClientsStore {
  return { clients: [client()], jobs: [job()], phases: [], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [],
    profiles: [], settings: { id: 1, company_name: 'Synthetic', default_rate: 150, weekly_capacity: 40 }, ...patch }
}

describe('client overview rows', () => {
  it('keeps clients with no jobs, zero financial totals and an undefined hourly rate', () => {
    const [row] = clientRows(store({ jobs: [], clients: [client({ email: '  ', phone: '\t' })] }), now)
    expect(row.jobs).toEqual([])
    expect(row.openJobs).toEqual([])
    expect(row).toMatchObject({ actualHours: 0, completedHours: 0, billableHours: 0, nonBillableHours: 0,
      runningCount: 0, feeRevenue: 0, effectiveHourlyRate: null, nextDeadline: null, deadlines: [], invoices: [], unpaidInvoices: [], contactMissing: true })
    expect(row.billing).toMatchObject({ balance: 0, outstanding: 0, unbilledAmount: 0, deposits: 0, feeRevenue: 0, effectiveHourlyRate: null })
  })

  it('counts all statuses and retains archived obligations without leaking unrelated or missing-client jobs', () => {
    const jobs = [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'closed', status: 'complete' }),
      job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' }),
      job({ id: 'other', client_id: 'other-client' }), job({ id: 'missing', client_id: 'missing-client' })]
    const rows = clientRows(store({ jobs, clients: [client(), client({ id: 'other-client', name: 'Other' })],
      timeEntries: jobs.map(j => time({ id: `time-${j.id}`, job_id: j.id })),
      invoices: [invoice({ job_id: 'archived', amount: 500 }), invoice({ id: 'unrelated', job_id: 'other', amount: 9000 }),
        invoice({ id: 'missing', job_id: 'missing', amount: 9000 }), invoice({ id: 'orphan', job_id: 'absent', amount: 9000 })],
    }), now)
    const row = rows.find(row => row.client.id === 'client')!
    expect(row).toMatchObject({ activeCount: 1, onHoldCount: 1, completeCount: 1, cancelledCount: 1, archivedCount: 1,
      actualHours: 5, completedHours: 5 })
    expect(row.jobs.map(row => row.job.id)).toEqual(['archived', 'cancelled', 'closed', 'hold', 'job'])
    expect(row.openJobs.map(row => row.job.id)).toEqual(['hold', 'job'])
    expect(row.billing).toMatchObject({ outstanding: 500, invoiced: 500, unbilledAmount: 500, balance: 0 })
    expect(row.invoices.map(invoice => invoice.id)).toEqual(['invoice'])
    expect(rows).toHaveLength(2)
  })

  it('weights recorded fees by all completed hours, including nonbillable and legacy ownership, separately from running effort', () => {
    const [row] = clientRows(store({ jobs: [job(), job({ id: 'second', status: 'archived' })],
      timeEntries: [time(), time({ id: 'nonbillable', job_id: 'second', user_id: 'legacy', hours: 9, billable: false }),
        time({ id: 'running', hours: null, started_at: new Date('2026-10-18T08:30:00').toISOString() })],
      invoices: [invoice(), invoice({ id: 'second-invoice', job_id: 'second' })],
    }), now)
    expect(row).toMatchObject({ actualHours: 12, completedHours: 10, billableHours: 1, nonBillableHours: 9,
      runningCount: 1, feeRevenue: 2000, effectiveHourlyRate: 200 })
    expect(row.billing).toMatchObject({ hoursValue: 1000, nonBillableValue: 900, unbilledAmount: 100,
      balance: 1000, effectiveHourlyRate: 200 })
  })

  it('preserves funded separate charges and deposit snapshots once in the client fee basis and balance', () => {
    const [row] = clientRows(store({ timeEntries: [time({ hours: 8, billed: true, invoice_id: 'invoice', deposit_applied: 100 }),
      time({ id: 'nonbillable', hours: 2, billable: false })], deposits: [deposit({ amount: 200 })],
      items: [item({ billed: true, invoice_id: 'invoice', deposit_applied: 100 })], invoices: [invoice({ amount: 900 })],
    }), now)
    expect(row.billing).toMatchObject({ hoursValue: 1000, itemsValue: 100, workValue: 1100, deposits: 200,
      depositUsed: 200, depositRemaining: 0, invoiced: 900, outstanding: 900, feeRevenue: 1000,
      balance: 0, nonBillableValue: 200, unbilledAmount: 0, paidAmount: 200, waitingAmount: 700 })
    expect(row.effectiveHourlyRate).toBe(100)
    expect(row.billing.balance).toBe(row.billing.deposits + row.billing.invoiced - row.billing.workValue)
  })

  it('never consumes deposits or creates unbilled receivables for nonbillable hours', () => {
    const [row] = clientRows(store({ timeEntries: [time({ hours: 2, billable: false, date: '2026-10-01' }),
      time({ id: 'billable', hours: 1 })], deposits: [deposit()],
    }), now)
    expect(row.billing).toMatchObject({ loggedHours: 3, nonBillableHours: 2, depositUsed: 100, depositRemaining: 0,
      unbilledHours: 0, unbilledAmount: 0, nonBillableValue: 200, balance: -200 })
    expect(filterClientRows([row], { ...defaults, focus: 'billing' }, now)).toEqual([])
  })

  it('returns no completed hourly rate when there are only running timers and deposits', () => {
    const [row] = clientRows(store({ timeEntries: [time({ hours: null, started_at: new Date('2026-10-18T09:30:00').toISOString() })],
      deposits: [deposit()],
    }), now)
    expect(row).toMatchObject({ actualHours: 1, completedHours: 0, runningCount: 1, feeRevenue: 100, effectiveHourlyRate: null })
    expect(row.billing).toMatchObject({ workValue: 0, balance: 100, depositRemaining: 100, effectiveHourlyRate: null })
  })

  it('keeps all unfinished operational deadlines and links, excluding completed and historical work', () => {
    const jobs = [job({ due_date: '2026-10-22' }), job({ id: 'hold', status: 'on_hold', due_date: '2026-10-24' }),
      job({ id: 'closed', status: 'complete', due_date: '2026-01-01' }), job({ id: 'cancelled', status: 'cancelled' }),
      job({ id: 'archived', status: 'archived' }), job({ id: 'other', client_id: 'other-client' })]
    const [row] = clientRows(store({ jobs,
      phases: [phase({ due_date: '2026-10-21' }), phase({ id: 'done-phase', status: 'complete', due_date: '2026-01-01' })],
      tasks: [task({ id: 'visit', job_id: 'hold', due_date: '2026-10-01', is_site_visit: true,
        scheduled_at: new Date('2026-10-19T09:00:00').toISOString() }), task({ id: 'done', status: 'done', due_date: '2026-01-01' }),
        ...['closed', 'cancelled', 'archived', 'other'].map(job_id => task({ id: `task-${job_id}`, job_id, due_date: '2026-01-01' }))],
    }), now)
    expect(row.nextDeadline).toMatchObject({ id: 'task-visit', date: '2026-10-19', kind: 'site_visit', link: '/jobs/hold?task=visit' })
    expect(row.deadlines.map(item => item.id)).toEqual(['task-visit', 'phase-phase', 'job-job', 'job-hold'])
  })

  it('orders invoice history by issued date, real created instant with microseconds, then stable ID', () => {
    const invoices = [invoice({ id: 'older-issued', issued_date: '2026-10-01', created_at: '2026-10-20T00:00:00Z' }),
      invoice({ id: 'whole', created_at: '2026-10-18T12:00:00Z' }),
      invoice({ id: 'micro-1', created_at: '2026-10-18T12:00:00.000001Z' }),
      invoice({ id: 'micro-2', created_at: '2026-10-18T05:00:00.000002-07:00' }),
      invoice({ id: 'b', created_at: '2026-10-18T12:00:00.1Z' }), invoice({ id: 'a', created_at: '2026-10-18T12:00:00.100000Z' })]
    const s = store({ invoices })
    const original = invoices.map(invoice => invoice.id)
    Object.freeze(invoices)
    const [row] = clientRows(s, now)
    expect(row.invoices.map(invoice => invoice.id)).toEqual(['a', 'b', 'micro-2', 'micro-1', 'whole', 'older-issued'])
    expect(s.invoices.map(invoice => invoice.id)).toEqual(original)
  })

  it('keeps paid and zero-value invoice history while only flagging positive unpaid amounts', () => {
    const [row] = clientRows(store({ invoices: [invoice({ id: 'open', amount: 25 }), invoice({ id: 'zero', amount: 0 }),
      invoice({ id: 'paid', amount: 50, paid_date: '2026-10-18' })],
    }), now)
    expect(row.invoices).toHaveLength(3)
    expect(row.unpaidInvoices.map(invoice => invoice.id)).toEqual(['open'])
    expect(row.billing).toMatchObject({ invoiced: 75, paid: 50, outstanding: 25 })
  })

  it('recognizes either contact method and treats whitespace-only methods as missing', () => {
    const rows = clientRows(store({ clients: [client({ id: 'email', phone: '  ' }), client({ id: 'phone', email: '\t' }),
      client({ id: 'missing', email: ' ', phone: '\n', contact_name: 'Named contact' })], jobs: [],
    }), now)
    expect(rows.filter(row => row.contactMissing).map(row => row.client.id)).toEqual(['missing'])
  })
})

describe('client filters and sorting', () => {
  it('AND-matches raw search tokens across contact methods and all job history, excluding private notes', () => {
    const rows = clientRows(store({ jobs: [job({ status: 'archived' })] }), now)
    expect(filterClientRows(rows, { ...defaults, q: '  CEDAR  dana@example.test 26-003   OCEAN ' }, now)).toHaveLength(1)
    expect(filterClientRows(rows, { ...defaults, q: '555-0100 ELM seaside' }, now)).toHaveLength(1)
    expect(filterClientRows(rows, { ...defaults, q: 'cedar unknown' }, now)).toEqual([])
    expect(filterClientRows(rows, { ...defaults, q: 'private meeting' }, now)).toEqual([])
    expect(filterClientRows(rows, { ...defaults, q: ' \t ' }, now)).toHaveLength(1)
  })

  it('finds due soon and overdue clients through the seventh local date, including on-hold jobs', () => {
    const ids = ['past', 'today', 'last-day', 'later', 'closed', 'empty']
    const rows = clientRows(store({ clients: ids.map(id => client({ id, name: id })), jobs: [
      job({ id: 'past', client_id: 'past', due_date: '2026-01-01' }), job({ id: 'today', client_id: 'today', due_date: '2026-10-18' }),
      job({ id: 'last-day', client_id: 'last-day', status: 'on_hold', due_date: '2026-10-24' }),
      job({ id: 'later', client_id: 'later', due_date: '2026-10-25' }), job({ id: 'closed', client_id: 'closed', status: 'complete', due_date: '2026-10-18' }),
    ] }), now)
    expect(filterClientRows(rows, { ...defaults, focus: 'due' }, now).map(row => row.client.id)).toEqual(['last-day', 'past', 'today'])
    expect(filterClientRows(rows, { ...defaults, focus: 'open' }, now)).toHaveLength(4)
    expect(filterClientRows(rows, { ...defaults, focus: 'no_open' }, now).map(row => row.client.id)).toEqual(['closed', 'empty'])
  })

  it('distinguishes unbilled and outstanding follow-ups across archived history using the half-cent threshold', () => {
    const ids = ['unbilled', 'outstanding', 'tiny', 'nonbillable', 'covered']
    const rows = clientRows(store({ clients: ids.map(id => client({ id, name: id })), jobs: ids.map(id => job({ id, client_id: id, status: 'archived' })),
      timeEntries: [time({ job_id: 'unbilled' }), time({ id: 'nb', job_id: 'nonbillable', billable: false }), time({ id: 'covered', job_id: 'covered' })],
      invoices: [invoice({ job_id: 'outstanding', amount: 10 }), invoice({ id: 'tiny', job_id: 'tiny', amount: 0.005 })],
      deposits: [deposit({ job_id: 'covered' })],
    }), now)
    expect(filterClientRows(rows, { ...defaults, focus: 'billing' }, now).map(row => row.client.id)).toEqual(['outstanding', 'unbilled'])
    expect(filterClientRows(rows, { ...defaults, focus: 'unbilled' }, now).map(row => row.client.id)).toEqual(['unbilled'])
    expect(filterClientRows(rows, { ...defaults, focus: 'outstanding' }, now).map(row => row.client.id)).toEqual(['outstanding'])
  })

  it('sorts numeric columns in either direction without mutating rows and keeps fixed name/ID ties', () => {
    const rows = clientRows(store({ clients: [client({ id: 'b', name: 'Same' }), client({ id: 'a', name: 'same' }), client({ id: 'c', name: 'Zulu' })],
      jobs: [job({ id: 'a-job', client_id: 'a' }), job({ id: 'b-job', client_id: 'b' }),
        job({ id: 'c-job', client_id: 'c' }), job({ id: 'c-hold', client_id: 'c', status: 'on_hold' })],
      invoices: [invoice({ id: 'a', job_id: 'a-job', amount: 10 }), invoice({ id: 'b', job_id: 'b-job', amount: 10 }),
        invoice({ id: 'c', job_id: 'c-job', amount: 100 })],
      timeEntries: [time({ job_id: 'a-job' }), time({ id: 'b', job_id: 'b-job' }), time({ id: 'c', job_id: 'c-job', hours: 3 })],
    }), now)
    const original = rows.map(row => row.client.id)
    Object.freeze(rows)
    for (const sort of ['open', 'unbilled', 'outstanding'] as const) {
      expect(filterClientRows(rows, { ...defaults, sort }, now).map(row => row.client.id)).toEqual(['a', 'b', 'c'])
      expect(filterClientRows(rows, { ...defaults, sort, dir: 'desc' }, now).map(row => row.client.id)).toEqual(['c', 'a', 'b'])
    }
    expect(rows.map(row => row.client.id)).toEqual(original)
  })

  it('sorts dated clients chronologically while keeping undated clients last in both directions', () => {
    const rows = clientRows(store({ clients: ['early', 'later', 'undated'].map(id => client({ id, name: id })),
      jobs: [job({ id: 'early', client_id: 'early', due_date: '2026-10-18' }), job({ id: 'later', client_id: 'later', due_date: '2026-10-20' })],
    }), now)
    expect(filterClientRows(rows, { ...defaults, sort: 'due' }, now).map(row => row.client.id)).toEqual(['early', 'later', 'undated'])
    expect(filterClientRows(rows, { ...defaults, sort: 'due', dir: 'desc' }, now).map(row => row.client.id)).toEqual(['later', 'early', 'undated'])
  })

  it('keeps equal-deadline client ties fixed rather than reversing unrelated task IDs', () => {
    const rows = clientRows(store({ clients: [client({ id: 'a', name: 'Same' }), client({ id: 'b', name: 'same' })],
      jobs: [job({ id: 'a-job', client_id: 'a' }), job({ id: 'b-job', client_id: 'b' })],
      tasks: [task({ id: 'z-task', job_id: 'a-job', due_date: '2026-10-18' }), task({ id: 'a-task', job_id: 'b-job', due_date: '2026-10-18' })],
    }), now)
    for (const dir of ['asc', 'desc'] as const) {
      expect(filterClientRows(rows, { ...defaults, sort: 'due', dir }, now).map(row => row.client.id)).toEqual(['a', 'b'])
    }
  })
})

describe('client URL filters', () => {
  it('normalizes malformed values and blank searches while preserving nonblank raw spaces', () => {
    expect(parseClientsQuery(new URLSearchParams('q=%20%20&focus=invalid&sort=balance&dir=sideways'))).toEqual(defaults)
    expect(parseClientsQuery(new URLSearchParams('q=%20cedar%20%20house%20&focus=missing_contact&sort=due&dir=desc')))
      .toEqual({ q: ' cedar  house ', focus: 'missing_contact', sort: 'due', dir: 'desc' })
  })

  it('patches filters and removes defaults without mutating the URL or dropping unrelated repeated keys', () => {
    const current = new URLSearchParams('view=table&tag=a&tag=b&focus=billing&sort=outstanding&dir=desc')
    const next = writeClientsQuery(current, { q: 'Cedar ', focus: 'open' })
    expect(parseClientsQuery(next)).toEqual({ ...defaults, q: 'Cedar ', focus: 'open', sort: 'outstanding', dir: 'desc' })
    expect(next.getAll('tag')).toEqual(['a', 'b'])
    expect(next.get('view')).toBe('table')
    expect(current.has('q')).toBe(false)
    expect(writeClientsQuery(next, defaults).toString()).toBe('view=table&tag=a&tag=b')
    expect(writeClientsQuery(new URLSearchParams('focus=invalid&sort=invalid&dir=invalid&task=123'), {}).toString()).toBe('task=123')
  })
})
