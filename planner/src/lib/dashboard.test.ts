import { describe, expect, it } from 'vitest'
import { dashboardData } from './dashboard'
import type { Invoice, Job, JobItem, Phase, Profile, ScheduleEntry, Task, TimeEntry } from './types'

type DashboardStore = Parameters<typeof dashboardData>[0]
const sunday = new Date('2026-10-18T12:00:00')

function job(patch: Partial<Job> = {}): Job {
  return { id: 'active', client_id: 'client', name: 'Active job', job_number: '', description: '', address: '',
    status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null,
    created_at: '2026-01-01T00:00:00Z', ...patch }
}
function phase(patch: Partial<Phase> = {}): Phase {
  return { id: 'phase', job_id: 'active', name: 'Design', kind: 'design', sort_order: 2,
    status: 'in_progress', estimate_hours: 10, start_date: null, due_date: null, assignee_id: null, notes: '', ...patch }
}
function task(patch: Partial<Task> = {}): Task {
  return { id: 'task', job_id: 'active', phase_id: null, title: 'Task', description: '', status: 'todo',
    assignee_id: null, due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: null,
    recurrence: 'none', recurrence_parent_id: null, sort_order: 0, completed_at: null, created_by: null,
    created_at: '2026-01-01T00:00:00Z', ...patch }
}
function time(patch: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'time', job_id: 'active', user_id: 'owner', phase_id: null, task_id: null,
    date: '2026-10-18', hours: 1, started_at: null, rate: 150, notes: '', billable: true,
    billed: false, invoice_id: null, deposit_applied: null, created_at: '2026-01-01T00:00:00Z', ...patch }
}
function invoice(patch: Partial<Invoice> = {}): Invoice {
  return { id: 'invoice', job_id: 'active', number: 'INV-1', amount: 100,
    issued_date: '2026-10-01', paid_date: null, notes: '', created_at: '2026-10-01T00:00:00Z', ...patch }
}
function schedule(patch: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return { id: 'schedule', job_id: 'active', phase_id: null, user_id: 'owner', date: '2026-10-18',
    hours: 1, note: '', created_at: '2026-01-01T00:00:00Z', ...patch }
}
const owner: Profile = { id: 'owner', email: 'test@example.test', full_name: 'Owner', color: '#123456',
  hourly_rate: 150, weekly_hours: 30, ics_token: '', created_at: '2026-01-01T00:00:00Z' }
function store(patch: Partial<DashboardStore> = {}): DashboardStore {
  return { jobs: [], phases: [], tasks: [], clients: [], timeEntries: [], invoices: [], deposits: [], items: [],
    profiles: [owner], me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 150, weekly_capacity: 35 },
    schedule: [], ...patch }
}

describe('dashboard action scopes and queue', () => {
  it('shows unfinished actions only on active and on-hold jobs, including unassigned tasks', () => {
    const jobs = [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'closed', status: 'complete' }),
      job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' })]
      .map(j => ({ ...j, due_date: '2026-10-18' }))
    const d = dashboardData(store({ jobs,
      phases: jobs.map(j => phase({ id: `${j.id}-phase`, job_id: j.id, due_date: '2026-10-18' })),
      tasks: [...jobs.map(j => task({ id: `${j.id}-task`, job_id: j.id, due_date: '2026-10-18' })),
        task({ id: 'done', status: 'done', due_date: '2026-10-18' }), task({ id: 'orphan', job_id: 'missing' })],
    }), sunday)
    expect(d.activeJobs.map(j => j.id)).toEqual(['active'])
    expect(d.onHoldJobs.map(j => j.id)).toEqual(['hold'])
    expect(d.openTasks.map(t => t.id)).toEqual(['active-task', 'hold-task'])
    expect(d.dueToday).toHaveLength(6)
    expect(new Set(d.dueToday.map(i => i.jobId))).toEqual(new Set(['active', 'hold']))
  })

  it('uses exactly seven calendar dates for upcoming deadlines and keeps overdue separate', () => {
    const d = dashboardData(store({ jobs: [job()], tasks: [
      task({ id: 'past', due_date: '2026-10-17' }), task({ id: 'today', due_date: '2026-10-18' }),
      task({ id: 'last-day', due_date: '2026-10-24' }), task({ id: 'eighth-day', due_date: '2026-10-25' }),
      task({ id: 'undated' }),
    ] }), sunday)
    expect(d.upcomingEnd).toBe('2026-10-24')
    expect(d.overdue.map(i => i.id)).toEqual(['task-past'])
    expect(d.dueToday.map(i => i.id)).toEqual(['task-today'])
    expect(d.upcoming.map(i => i.id)).toEqual(['task-today', 'task-last-day'])
    expect(d.openTasks.at(-1)?.id).toBe('undated')
  })

  it('sorts the active queue by priority and chooses the first unfinished phase by phase order', () => {
    const d = dashboardData(store({
      jobs: [job({ id: 'third', priority: 3 }), job({ id: 'second', priority: 2 }), job({ priority: 1 }),
        job({ id: 'hold', status: 'on_hold', priority: 0 })],
      phases: [phase({ id: 'late', sort_order: 5 }), phase({ id: 'done', sort_order: 0, status: 'complete' }),
        phase({ id: 'first', kind: 'queued', sort_order: 1 })],
    }), sunday)
    expect(d.queue.map(row => row.job.id)).toEqual(['active', 'second', 'third'])
    expect(d.queue[0].phase?.id).toBe('first')
    expect(d.queue[1].phase).toBeUndefined()
  })

  it('orders open tasks by date, job priority, then task order without mutating store arrays', () => {
    const s = store({ jobs: [job({ priority: 2 }), job({ id: 'priority', priority: 1 })], tasks: [
      task({ id: 'later', due_date: '2026-10-20' }), task({ id: 'b', due_date: '2026-10-18', sort_order: 2 }),
      task({ id: 'priority-task', job_id: 'priority', due_date: '2026-10-18' }),
      task({ id: 'a', due_date: '2026-10-18', sort_order: 1 }),
    ] })
    const originalTasks = s.tasks.map(t => t.id)
    Object.freeze(s.tasks)
    Object.freeze(s.jobs)
    expect(dashboardData(s, sunday).openTasks.map(t => t.id)).toEqual(['priority-task', 'a', 'b', 'later'])
    expect(s.tasks.map(t => t.id)).toEqual(originalTasks)
  })

  it('uses the local scheduled date of a site visit for both task order and deadlines', () => {
    const d = dashboardData(store({ jobs: [job()], tasks: [
      task({ id: 'visit', is_site_visit: true, due_date: '2026-10-01', scheduled_at: new Date('2026-10-20T09:00:00').toISOString() }),
      task({ id: 'today', due_date: '2026-10-18' }),
    ] }), sunday)
    expect(d.openTasks.map(t => t.id)).toEqual(['today', 'visit'])
    expect(d.overdue).toEqual([])
    expect(d.upcoming.find(item => item.id === 'task-visit')).toMatchObject({ date: '2026-10-20', kind: 'site_visit' })
  })
})

describe('dashboard weekly hours', () => {
  it('bounds completed time Monday through Sunday and preserves nonbillable and historical-owner time', () => {
    const d = dashboardData(store({ jobs: [job(), job({ id: 'archived', status: 'archived' })], timeEntries: [
      time({ id: 'previous', date: '2026-10-11', hours: 100 }),
      time({ id: 'monday', date: '2026-10-12', hours: 1 }),
      time({ id: 'sunday', date: '2026-10-18', hours: 2, billable: false }),
      time({ id: 'historical-owner', date: '2026-10-15', user_id: 'previous-owner', hours: 4 }),
      time({ id: 'archived-time', job_id: 'archived', date: '2026-10-15', hours: 3 }),
      time({ id: 'future', date: '2026-10-19', hours: 200 }),
      time({ id: 'running', hours: null, started_at: '2026-10-18T00:00:00Z' }),
    ] }), sunday)
    expect(d.weekStart).toBe('2026-10-12')
    expect(d.weekEnd).toBe('2026-10-18')
    expect(d.week).toMatchObject({ hours: 10, billableHours: 8, nonBillableHours: 2 })
    expect(d.week.entries.map(e => e.id)).toEqual(['monday', 'sunday', 'historical-owner', 'archived-time'])
    expect(d.running.map(e => e.id)).toEqual(['running'])
  })

  it('keeps running timers separate, owner-specific, and visible even for a closed job', () => {
    const d = dashboardData(store({ jobs: [job({ status: 'complete' })], timeEntries: [
      time({ id: 'older', hours: null, started_at: '2026-10-01T00:00:00Z', billable: false }),
      time({ id: 'newer', hours: null, started_at: '2026-10-18T00:00:00Z' }),
      time({ id: 'other-owner', user_id: 'legacy', hours: null, started_at: '2026-10-18T01:00:00Z' }),
    ] }), sunday)
    expect(d.running.map(e => e.id)).toEqual(['newer', 'older'])
    expect(d.week.hours).toBe(0)
    expect(d.money.loggedHours).toBe(0)
    expect(d.money.effectiveHourlyRate).toBeNull()
  })

  it('shows only remaining active-job plans from today through Sunday, separate from worked time', () => {
    const d = dashboardData(store({
      jobs: [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'closed', status: 'complete' }),
        job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' })],
      schedule: [schedule({ id: 'past', date: '2026-10-13', hours: 100 }),
        schedule({ id: 'today', date: '2026-10-14', hours: 3, user_id: 'legacy' }),
        schedule({ id: 'sunday', date: '2026-10-18', hours: 2 }),
        schedule({ id: 'next-week', date: '2026-10-19', hours: 100 }),
        ...['hold', 'closed', 'cancelled', 'archived'].map(id => schedule({ id, job_id: id, date: '2026-10-14', hours: 100 }))],
      timeEntries: [time({ date: '2026-10-14', hours: 4 })],
    }), new Date('2026-10-14T12:00:00'))
    expect(d.week).toMatchObject({ hours: 4, plannedHours: 5, capacity: 30 })
  })

  it('uses company capacity and then 40 hours if owner capacity is unavailable', () => {
    expect(dashboardData(store({ me: null }), sunday).week.capacity).toBe(35)
    const s = store({ me: { ...owner, weekly_hours: 0 } })
    expect(dashboardData(s, sunday).week.capacity).toBe(35)
    s.settings.weekly_capacity = 0
    expect(dashboardData(s, sunday).week.capacity).toBe(40)
  })
})

describe('dashboard financial history and watch rows', () => {
  it('retains closed and cancelled financial obligations while excluding archived jobs', () => {
    const d = dashboardData(store({
      jobs: [job(), job({ id: 'closed', status: 'complete' }), job({ id: 'cancelled', status: 'cancelled' }),
        job({ id: 'hold', status: 'on_hold' }), job({ id: 'archived', status: 'archived' })],
      timeEntries: [time(), time({ id: 'closed-time', job_id: 'closed', rate: 200 }),
        time({ id: 'cancelled-time', job_id: 'cancelled', rate: 250 }),
        time({ id: 'hold-time', job_id: 'hold', hours: 2, billable: false }),
        time({ id: 'archived-time', job_id: 'archived', rate: 999 })],
      deposits: [{ id: 'deposit', job_id: 'active', amount: 100, received_date: '2026-10-01', method: '', notes: '', created_at: '' }],
      invoices: [invoice({ paid_date: '2026-10-02' }), invoice({ id: 'closed-invoice', job_id: 'closed', amount: 400 }),
        invoice({ id: 'cancelled-invoice', job_id: 'cancelled', amount: 500, issued_date: '2026-10-02' }),
        invoice({ id: 'archived-invoice', job_id: 'archived', amount: 900 })],
    }), sunday)
    expect(d.money.all.map(row => row.job.id)).toEqual(['active', 'closed', 'cancelled', 'hold'])
    expect(d.money.readyToBill.map(row => row.job.id)).toEqual(['cancelled', 'closed', 'active'])
    expect(d.money.unpaidInvoices.map(row => row.invoice.id)).toEqual(['closed-invoice', 'cancelled-invoice'])
    expect(d.money).toMatchObject({ toBillAmount: 500, outstanding: 900, feeRevenue: 1100, loggedHours: 5, effectiveHourlyRate: 220 })
    expect(d.money.toBillAmount).toBe(d.money.all.reduce((total, row) => total + row.unbilledAmount, 0))
    expect(d.money.outstanding).toBe(d.money.unpaidInvoices.reduce((total, row) => total + row.invoice.amount, 0))
  })

  it('weights hourly return by all completed hours and excludes funded separate charges', () => {
    const item: JobItem = { id: 'item', job_id: 'active', date: '2026-10-18', category: 'Expense', description: '',
      quantity: 1, unit_price: 200, billed: true, invoice_id: 'invoice', deposit_applied: 0, created_by: null, created_at: '' }
    const d = dashboardData(store({ jobs: [job(), job({ id: 'second' })],
      timeEntries: [time({ hours: 8 }), time({ id: 'nonbillable', hours: 2, billable: false }), time({ id: 'second-time', job_id: 'second', hours: 2 })],
      invoices: [invoice({ amount: 1200 }), invoice({ id: 'second-invoice', job_id: 'second', amount: 400 })], items: [item],
    }), sunday)
    expect(d.money).toMatchObject({ feeRevenue: 1400, loggedHours: 12 })
    expect(d.money.effectiveHourlyRate).toBeCloseTo(1400 / 12)
    expect(d.money.effectiveHourlyRate).not.toBe(150)
  })

  it('watches unfinished active phases over estimates and waiting actions without duplicate phase rows', () => {
    const d = dashboardData(store({
      jobs: [job(), job({ id: 'hold', status: 'on_hold' }), job({ id: 'closed', status: 'complete' }), job({ id: 'cancelled', status: 'cancelled' })],
      phases: [phase({ id: 'over', status: 'waiting', estimate_hours: 10 }),
        phase({ id: 'no-estimate', estimate_hours: 0 }), phase({ id: 'complete-phase', status: 'complete', estimate_hours: 1 }),
        phase({ id: 'hold-over', job_id: 'hold', estimate_hours: 1 }), phase({ id: 'hold-wait', job_id: 'hold', status: 'waiting' }),
        phase({ id: 'closed-wait', job_id: 'closed', status: 'waiting' }), phase({ id: 'cancelled-wait', job_id: 'cancelled', status: 'waiting' })],
      timeEntries: [time({ id: 'over-billable', phase_id: 'over', hours: 2 }), time({ id: 'over-nonbillable', phase_id: 'over', hours: 10, billable: false }),
        time({ id: 'running', phase_id: 'over', hours: null, started_at: '2026-10-01T00:00:00Z' }),
        time({ id: 'no-estimate', phase_id: 'no-estimate', hours: 5 }), time({ id: 'complete', phase_id: 'complete-phase', hours: 5 }),
        time({ id: 'hold-over', job_id: 'hold', phase_id: 'hold-over', hours: 5 })],
      tasks: [task({ id: 'waiting', status: 'waiting' }), task({ id: 'hold-waiting', job_id: 'hold', status: 'waiting' }),
        task({ id: 'cancelled-waiting', job_id: 'cancelled', status: 'waiting' })],
    }), sunday)
    expect(d.watch.map(row => row.kind)).toEqual(['over_estimate', 'waiting_task', 'waiting_task', 'waiting_phase'])
    expect(d.watch[0]).toMatchObject({ phase: { id: 'over' }, loggedHours: 12, overHours: 2 })
    expect(d.watch.filter(row => row.kind !== 'waiting_task').map(row => row.phase.id)).toEqual(['over', 'hold-wait'])
  })

  it('returns empty lists and unavailable hourly return before any job data exists', () => {
    const d = dashboardData(store(), sunday)
    expect(d.queue).toEqual([])
    expect(d.openTasks).toEqual([])
    expect(d.watch).toEqual([])
    expect(d.money).toMatchObject({ all: [], readyToBill: [], unpaidInvoices: [], toBillAmount: 0,
      outstanding: 0, feeRevenue: 0, loggedHours: 0, effectiveHourlyRate: null })
  })
})
