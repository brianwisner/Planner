import { describe, expect, it } from 'vitest'
import { filterJobRows, jobRows, parseJobsQuery, writeJobsQuery, type JobsQuery } from './jobs'
import type { Job, Phase, Task, TimeEntry } from './types'

type JobsStore = Parameters<typeof jobRows>[0]
const now = new Date('2026-10-18T10:30:00')
const defaults: JobsQuery = { view: 'table', status: 'open', client: '', q: '', focus: 'all' }

function job(patch: Partial<Job> = {}): Job {
  return { id: 'job', client_id: 'client', name: 'Cedar residence', job_number: '24-103', address: '10 Elm Street',
    description: '', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null,
    created_at: '2026-01-01T00:00:00Z', ...patch }
}
function phase(patch: Partial<Phase> = {}): Phase {
  return { id: 'phase', job_id: 'job', name: 'Design', kind: 'design', sort_order: 2, status: 'in_progress',
    estimate_hours: 10, start_date: null, due_date: null, assignee_id: null, notes: '', ...patch }
}
function task(patch: Partial<Task> = {}): Task {
  return { id: 'task', job_id: 'job', phase_id: null, title: 'Review framing', description: '', status: 'todo',
    assignee_id: null, due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: null,
    recurrence: 'none', recurrence_parent_id: null, sort_order: 0, completed_at: null, created_by: null,
    created_at: '2026-01-01T00:00:00Z', ...patch }
}
function time(patch: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'time', job_id: 'job', phase_id: 'phase', task_id: null, user_id: 'owner', date: '2026-10-18',
    hours: 1, started_at: null, rate: 100, notes: '', billable: true, billed: false, invoice_id: null,
    deposit_applied: null, created_at: '2026-01-01T00:00:00Z', ...patch }
}
function store(patch: Partial<JobsStore> = {}): JobsStore {
  return { jobs: [job()], phases: [], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], profiles: [],
    clients: [{ id: 'client', name: 'Acme Architecture', contact_name: '', email: '', phone: '', address: '', notes: '',
      is_sample: false, created_at: '' }], settings: { id: 1, company_name: 'Synthetic', default_rate: 150, weekly_capacity: 40 }, ...patch }
}

describe('job overview rows', () => {
  it('orders phases before choosing the current and work phases, while preserving source order', () => {
    const s = store({ phases: [phase({ id: 'later', kind: 'construction', sort_order: 5 }),
      phase({ id: 'done', kind: 'bidding', status: 'complete', sort_order: 0 }),
      phase({ id: 'design', kind: 'design', sort_order: 2 }), phase({ id: 'queue', kind: 'queued', sort_order: 1 })] })
    const original = s.phases.map(p => p.id)
    Object.freeze(s.phases)
    const row = jobRows(s, now)[0]
    expect(row.phases.map(p => p.id)).toEqual(['done', 'queue', 'design', 'later'])
    expect(row.currentPhase?.id).toBe('queue')
    expect(row.workPhase?.id).toBe('design')
    expect(s.phases.map(p => p.id)).toEqual(original)
  })

  it('keeps all worked effort and running time separate from completed money denominators', () => {
    const s = store({ phases: [phase()], timeEntries: [time({ hours: 3, user_id: 'legacy-owner' }),
      time({ id: 'nonbillable', hours: 2, billable: false }),
      time({ id: 'running', hours: null, started_at: new Date('2026-10-18T10:00:00').toISOString() })],
      invoices: [{ id: 'invoice', job_id: 'job', number: 'INV-1', amount: 1000, issued_date: '2026-10-18',
        paid_date: null, notes: '', created_at: '' }],
    })
    const row = jobRows(s, now)[0]
    expect(row).toMatchObject({ actualHours: 5.5, completedHours: 5, billableHours: 3, nonBillableHours: 2,
      currentPhaseHours: 5.5, runningCount: 1, estimatedHours: 10, remainingHours: 4.5 })
    expect(row.billing).toMatchObject({ hoursValue: 500, feeRevenue: 1000, effectiveHourlyRate: 200 })
  })

  it('does not turn nonbillable work into invoices or deposit consumption', () => {
    const row = jobRows(store({ timeEntries: [time({ hours: 2, billable: false, date: '2026-10-17' }), time({ id: 'billable', hours: 3 })],
      deposits: [{ id: 'deposit', job_id: 'job', amount: 100, received_date: '2026-10-16', method: '', notes: '', created_at: '' }],
    }), now)[0]
    expect(row).toMatchObject({ actualHours: 5, completedHours: 5, billableHours: 3, nonBillableHours: 2 })
    expect(row.billing).toMatchObject({ workValue: 500, nonBillableValue: 200, depositUsed: 100, unbilledAmount: 200, balance: -400 })
  })

  it('finds the earliest open deadline across jobs, phases, and tasks and keeps its source link', () => {
    const row = jobRows(store({ jobs: [job({ due_date: '2026-10-22' })],
      phases: [phase({ due_date: '2026-10-20' }), phase({ id: 'completed', status: 'complete', due_date: '2026-10-01' })],
      tasks: [task({ due_date: '2026-10-18' }), task({ id: 'done', status: 'done', due_date: '2026-10-01' })],
    }), now)[0]
    expect(row.nextDeadline).toMatchObject({ id: 'task-task', date: '2026-10-18', kind: 'task', link: '/jobs/job?task=task' })
    expect(row.nextTask?.id).toBe('task')
    expect(row.openTaskCount).toBe(1)
  })

  it('uses local scheduled visit dates consistently for next task and next deadline', () => {
    const row = jobRows(store({ jobs: [job({ due_date: '2026-10-22' })], tasks: [
      task({ id: 'visit', is_site_visit: true, due_date: '2026-10-01', scheduled_at: new Date('2026-10-20T09:00:00').toISOString() }),
      task({ id: 'later', due_date: '2026-10-21' }),
    ] }), now)[0]
    expect(row.nextTask?.id).toBe('visit')
    expect(row.nextTaskDate).toBe('2026-10-20')
    expect(row.nextDeadline).toMatchObject({ date: '2026-10-20', kind: 'site_visit', link: '/jobs/job?task=visit' })
  })

  it('retains on-hold follow-ups but removes operational actions from complete, cancelled and archived jobs', () => {
    const jobs = [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'closed', status: 'complete' }),
      job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' })].map(j => ({ ...j, due_date: '2026-10-18' }))
    const rows = jobRows(store({ jobs,
      phases: jobs.map(j => phase({ id: `phase-${j.id}`, job_id: j.id, status: 'waiting', estimate_hours: 1, due_date: '2026-10-17' })),
      tasks: jobs.map(j => task({ id: `task-${j.id}`, job_id: j.id, status: 'waiting', due_date: '2026-10-16' })),
      timeEntries: jobs.map(j => time({ id: `time-${j.id}`, job_id: j.id, phase_id: `phase-${j.id}`, hours: 3 })),
    }), now)
    for (const row of rows.filter(row => row.job.status === 'active' || row.job.status === 'on_hold')) {
      expect(row).toMatchObject({ openTaskCount: 1, waitingTaskCount: 1, waitingPhaseCount: 1, waiting: true, overEstimate: true })
      expect(row.nextDeadline?.date).toBe('2026-10-16')
    }
    for (const row of rows.filter(row => !['active', 'on_hold'].includes(row.job.status))) {
      expect(row).toMatchObject({ actualHours: 3, remainingHours: 0, openTaskCount: 0, waitingTaskCount: 0,
        waitingPhaseCount: 0, waiting: false, overEstimate: false, nextTask: null, nextDeadline: null })
      expect(row.billing.loggedHours).toBe(3)
    }
  })

  it('sorts job priorities with stable ties and falls back to the last ordered completed phase', () => {
    const rows = jobRows(store({ jobs: [job({ id: 'third', priority: 3 }), job({ id: 'b', priority: 1 }), job({ id: 'a', priority: 1 })],
      phases: [phase({ id: 'last', job_id: 'a', sort_order: 5, status: 'complete' }), phase({ id: 'first', job_id: 'a', sort_order: 1, status: 'complete' })],
    }), now)
    expect(rows.map(row => row.job.id)).toEqual(['a', 'b', 'third'])
    expect(rows[0].currentPhase?.id).toBe('last')
    expect(rows[0].remainingHours).toBe(0)
  })
})

describe('job filters', () => {
  it('supports open, every explicit status, and all without dropping historical rows', () => {
    const rows = jobRows(store({ jobs: [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'closed', status: 'complete' }),
      job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' })] }), now)
    expect(filterJobRows(rows, defaults, now).map(row => row.job.id)).toEqual(['hold', 'job'])
    expect(filterJobRows(rows, { ...defaults, status: 'all' }, now)).toHaveLength(5)
    for (const status of ['active', 'on_hold', 'complete', 'cancelled', 'archived'] as const) {
      expect(filterJobRows(rows, { ...defaults, status }, now).map(row => row.job.status)).toEqual([status])
    }
  })

  it('trims and AND-matches search words across job name, number, client and address', () => {
    const rows = jobRows(store({ jobs: [job(), job({ id: 'other', name: 'Cedar office', job_number: '99-001', address: 'Oak Road', client_id: 'other-client' })] }), now)
    expect(filterJobRows(rows, { ...defaults, q: '  CEDAR  24-103   acme ELM  ' }, now).map(row => row.job.id)).toEqual(['job'])
    expect(filterJobRows(rows, { ...defaults, q: 'cedar nonexistent' }, now)).toEqual([])
    expect(filterJobRows(rows, { ...defaults, client: 'client', q: '  ' }, now).map(row => row.job.id)).toEqual(['job'])
  })

  it('focuses due soon and overdue jobs using seven dates including today and all overdue dates', () => {
    const rows = jobRows(store({ jobs: [job({ id: 'past', due_date: '2026-01-01' }), job({ id: 'today', due_date: '2026-10-18' }),
      job({ id: 'last-day', due_date: '2026-10-24' }), job({ id: 'eighth-day', due_date: '2026-10-25' }),
      job({ id: 'undated' }), job({ id: 'closed', status: 'complete', due_date: '2026-10-18' })] }), now)
    expect(filterJobRows(rows, { ...defaults, status: 'all', focus: 'due' }, now).map(row => row.job.id)).toEqual(['last-day', 'past', 'today'])
  })

  it('finds waiting jobs and only unfinished estimated phase overruns', () => {
    const rows = jobRows(store({ jobs: [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'waiting' }), job({ id: 'finished-overrun' })],
      phases: [phase({ id: 'over', estimate_hours: 2 }), phase({ id: 'waiting-phase', job_id: 'waiting', status: 'waiting' }),
        phase({ id: 'finished', job_id: 'finished-overrun', status: 'complete', estimate_hours: 1 }), phase({ id: 'unestimated', estimate_hours: 0 })],
      timeEntries: [time({ phase_id: 'over', hours: 3 }), time({ id: 'finished-time', job_id: 'finished-overrun', phase_id: 'finished', hours: 10 }),
        time({ id: 'no-estimate-time', phase_id: 'unestimated', hours: 100 })],
    }), now)
    expect(filterJobRows(rows, { ...defaults, focus: 'waiting' }, now).map(row => row.job.id)).toEqual(['hold', 'waiting'])
    expect(filterJobRows(rows, { ...defaults, focus: 'over_estimate' }, now).map(row => row.job.id)).toEqual(['job'])
  })

  it('finds billable or unpaid history without presenting nonbillable or deposit-covered effort as receivables', () => {
    const rows = jobRows(store({ jobs: [job({ id: 'nonbillable' }), job({ id: 'covered' }), job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'closed', status: 'complete' })],
      timeEntries: [time({ job_id: 'nonbillable', billable: false }), time({ id: 'covered-time', job_id: 'covered' }),
        time({ id: 'cancelled-time', job_id: 'cancelled' })],
      deposits: [{ id: 'deposit', job_id: 'covered', amount: 100, received_date: '2026-10-18', method: '', notes: '', created_at: '' }],
      invoices: [{ id: 'invoice', job_id: 'closed', number: 'INV-1', amount: 500, issued_date: '2026-10-18', paid_date: null, notes: '', created_at: '' }],
    }), now)
    expect(filterJobRows(rows, { ...defaults, status: 'all', focus: 'billing' }, now).map(row => row.job.id)).toEqual(['cancelled', 'closed'])
  })
})

describe('job URL filters', () => {
  it('uses recognized defaults for malformed view, status and focus values', () => {
    expect(parseJobsQuery(new URLSearchParams('view=unknown&status=deleted&focus=urgent&client=%20abc%20&q=%20%20')))
      .toEqual({ ...defaults, client: 'abc' })
    expect(parseJobsQuery(new URLSearchParams('view=board&status=all&focus=over_estimate&q=Cedar')))
      .toEqual({ ...defaults, view: 'board', status: 'all', focus: 'over_estimate', q: 'Cedar' })
  })

  it('patches URL filters without mutating the source or losing view and unrelated deep-link parameters', () => {
    const source = new URLSearchParams('view=gantt&status=active&focus=due&task=123&tag=a&tag=b')
    const next = writeJobsQuery(source, { q: 'Cedar ', client: 'client' })
    expect(parseJobsQuery(next)).toEqual({ ...defaults, view: 'gantt', status: 'active', focus: 'due', q: 'Cedar ', client: 'client' })
    expect(next.get('task')).toBe('123')
    expect(next.getAll('tag')).toEqual(['a', 'b'])
    expect(source.has('q')).toBe(false)
    const reset = writeJobsQuery(next, { status: 'open', focus: 'all', client: '', q: '' })
    expect(reset.toString()).toBe('view=gantt&task=123&tag=a&tag=b')
  })

  it('normalizes invalid recognized parameters when writing and removes default table view', () => {
    const result = writeJobsQuery(new URLSearchParams('view=bad&status=bad&focus=bad&task=123'), { view: 'table' })
    expect(result.toString()).toBe('task=123')
  })
})
