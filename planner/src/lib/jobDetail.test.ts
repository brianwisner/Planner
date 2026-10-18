import { describe, expect, it } from 'vitest'
import { jobDetailData, jobTaskDate } from './jobDetail'
import type { Comment, Job, JobItem, Phase, ScheduleEntry, Task, TimeEntry } from './types'

type DetailStore = Parameters<typeof jobDetailData>[0]
const now = new Date('2026-10-18T10:30:00')
const stamp = '2026-10-18T00:00:00Z'
function job(patch: Partial<Job> = {}): Job {
  return { id: 'job', client_id: 'client', name: 'Synthetic residence', job_number: '', description: '', address: '',
    status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: stamp, ...patch }
}
function phase(patch: Partial<Phase> = {}): Phase {
  return { id: 'phase', job_id: 'job', name: 'Design', kind: 'design', sort_order: 2, status: 'in_progress',
    estimate_hours: 10, start_date: null, due_date: null, assignee_id: null, notes: '', ...patch }
}
function task(patch: Partial<Task> = {}): Task {
  return { id: 'task', job_id: 'job', phase_id: 'phase', title: 'Task', description: '', status: 'todo', assignee_id: null,
    due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: null, recurrence: 'none', recurrence_parent_id: null,
    sort_order: 0, completed_at: null, created_by: null, created_at: stamp, ...patch }
}
function time(patch: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'time', job_id: 'job', phase_id: 'phase', task_id: null, user_id: 'owner', date: '2026-10-18', hours: 1,
    started_at: null, rate: 100, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: stamp, ...patch }
}
function plan(patch: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return { id: 'plan', job_id: 'job', phase_id: 'phase', user_id: 'owner', date: '2026-10-18', hours: 2, note: '', created_at: stamp, ...patch }
}
function item(patch: Partial<JobItem> = {}): JobItem {
  return { id: 'item', job_id: 'job', date: '2026-10-18', category: 'Expense', description: '', quantity: 1, unit_price: 100,
    billed: false, invoice_id: null, deposit_applied: null, created_by: null, created_at: stamp, ...patch }
}
function comment(patch: Partial<Comment> = {}): Comment {
  return { id: 'comment', job_id: 'job', user_id: null, body: 'Historical note', created_at: stamp, ...patch }
}
function store(patch: Partial<DetailStore> = {}): DetailStore {
  const owner = { id: 'owner', email: null, full_name: 'Owner', color: '#123456', hourly_rate: 100, weekly_hours: 40,
    ics_token: '', created_at: stamp }
  return { jobs: [job()], phases: [phase()], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [],
    profiles: [owner], me: owner, clients: [], settings: { id: 1, company_name: 'Synthetic', default_rate: 100, weekly_capacity: 40 }, ...patch }
}

describe('job detail task and deadline context', () => {
  it('returns no model for a missing job', () => {
    expect(jobDetailData(store(), 'missing', now)).toBeNull()
  })

  it('orders phases and task partitions, preferring doing work before due-date order', () => {
    const d = jobDetailData(store({ phases: [phase({ id: 'later', sort_order: 5 }), phase({ id: 'queued', kind: 'queued', sort_order: 1 }), phase()],
      tasks: [task({ id: 'undated' }), task({ id: 'waiting', status: 'waiting', due_date: '2026-01-01' }),
        task({ id: 'overdue', due_date: '2026-10-01' }), task({ id: 'doing', status: 'doing', due_date: '2026-10-25' }),
        task({ id: 'done-older', status: 'done', completed_at: '2026-10-16T00:00:00Z' }),
        task({ id: 'done-newer', status: 'done', completed_at: '2026-10-17T00:00:00Z' }), task({ id: 'foreign', job_id: 'other' })],
    }), 'job', now)!
    expect(d.phases.map(p => p.id)).toEqual(['queued', 'phase', 'later'])
    expect(d.overview.workPhase?.id).toBe('phase')
    expect(d.readyTasks.map(t => t.id)).toEqual(['doing', 'overdue', 'undated'])
    expect(d.waitingTasks.map(t => t.id)).toEqual(['waiting'])
    expect(d.doneTasks.map(t => t.id)).toEqual(['done-newer', 'done-older'])
    expect(d.tasks.map(t => t.id)).toEqual(['doing', 'overdue', 'undated', 'waiting', 'done-newer', 'done-older'])
    expect(d.nextActionableTask?.id).toBe('doing')
  })

  it('sorts equal-day tasks by actual scheduled time, task order, and stable ID', () => {
    const d = jobDetailData(store({ tasks: [
      task({ id: 'visit-afternoon', scheduled_at: new Date('2026-10-20T14:00:00').toISOString(), due_date: '2026-01-01' }),
      task({ id: 'b', due_date: '2026-10-20', sort_order: 1 }), task({ id: 'a', due_date: '2026-10-20', sort_order: 1 }),
      task({ id: 'visit-morning', scheduled_at: new Date('2026-10-20T09:00:00').toISOString() }),
    ] }), 'job', now)!
    expect(d.readyTasks.map(t => t.id)).toEqual(['a', 'b', 'visit-morning', 'visit-afternoon'])
    expect(jobTaskDate(d.readyTasks[3])).toBe('2026-10-20')
  })

  it('keeps only unfinished operational deadlines and uses local site-visit dates', () => {
    const d = jobDetailData(store({ jobs: [job({ due_date: '2026-10-22' })],
      phases: [phase({ due_date: '2026-10-20' }), phase({ id: 'done-phase', status: 'complete', due_date: '2026-10-01' })],
      tasks: [task({ id: 'waiting', status: 'waiting', due_date: '2026-10-16' }), task({ id: 'today', due_date: '2026-10-18' }),
        task({ id: 'done', status: 'done', due_date: '2026-10-01' }), task({ id: 'visit', is_site_visit: true,
          due_date: '2026-10-01', scheduled_at: new Date('2026-10-19T09:00:00').toISOString() })],
    }), 'job', now)!
    expect(d.deadlines.map(deadline => deadline.date)).toEqual(['2026-10-16', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-22'])
    expect(d.overdueDeadlines.map(deadline => deadline.id)).toEqual(['task-waiting'])
    expect(d.upcomingDeadlines).toHaveLength(4)
    expect(d.deadlines.find(deadline => deadline.id === 'task-visit')).toMatchObject({ kind: 'site_visit', link: '/jobs/job?task=visit' })
  })

  it.each(['complete', 'cancelled', 'archived'] as const)('preserves %s history without operational alerts or next-task prompts', status => {
    const d = jobDetailData(store({ jobs: [job({ status, due_date: '2026-01-01' })],
      phases: [phase({ status: 'waiting', due_date: '2026-01-01' })], tasks: [task({ status: 'waiting', due_date: '2026-01-01' }), task({ id: 'ready' })],
      timeEntries: [time()], items: [item()], comments: [comment()], schedule: [plan()],
    }), 'job', now)!
    expect(d.operational).toBe(false)
    expect(d.nextActionableTask).toBeNull()
    expect(d.deadlines).toEqual([])
    expect(d.overdueDeadlines).toEqual([])
    expect(d.tasks).toHaveLength(2)
    expect(d.waitingTasks).toHaveLength(1)
    expect(d.recentEntries).toHaveLength(1)
    expect(d.items).toHaveLength(1)
    expect(d.comments).toHaveLength(1)
    expect(d.upcomingPlans).toHaveLength(1)
    expect(d.overview.billing).toMatchObject({ loggedHours: 1, workValue: 200 })
    expect(d.overview.remainingHours).toBe(0)
  })

  it('keeps on-hold follow-ups operational and retains general and unassigned tasks', () => {
    const d = jobDetailData(store({ jobs: [job({ status: 'on_hold' })], tasks: [task({ phase_id: null, due_date: '2026-10-18' })] }), 'job', now)!
    expect(d.operational).toBe(true)
    expect(d.nextActionableTask?.phase_id).toBeNull()
    expect(d.deadlines.map(deadline => deadline.id)).toEqual(['task-task'])
  })
})

describe('job detail worked time, money, and saved plans', () => {
  it('includes running and nonbillable effort while keeping financial hours completed-only', () => {
    const d = jobDetailData(store({ timeEntries: [time({ hours: 3, user_id: 'legacy' }), time({ id: 'nonbillable', hours: 2, billable: false }),
      time({ id: 'owner-running', hours: null, started_at: new Date('2026-10-18T10:00:00').toISOString() }),
      time({ id: 'legacy-running', user_id: 'legacy', hours: null, billable: false, started_at: new Date('2026-10-18T10:15:00').toISOString() })],
      deposits: [{ id: 'deposit', job_id: 'job', amount: 200, received_date: '2026-10-18', method: '', notes: '', created_at: stamp }],
      invoices: [{ id: 'invoice', job_id: 'job', number: 'INV-1', amount: 800, issued_date: '2026-10-18', paid_date: null, notes: '', created_at: stamp }],
    }), 'job', now)!
    expect(d.overview).toMatchObject({ actualHours: 5.75, completedHours: 5, billableHours: 3, nonBillableHours: 2, remainingHours: 4.25 })
    expect(d.overview.billing).toMatchObject({ workValue: 500, nonBillableValue: 200, feeRevenue: 1000, effectiveHourlyRate: 200, balance: 500 })
    expect(d.phaseSummaries[0]).toMatchObject({ actualHours: 5.75, completedHours: 5, remainingHours: 4.25 })
    expect(d.runningEntries).toHaveLength(2)
    expect(d.myRunningEntries.map(entry => entry.id)).toEqual(['owner-running'])
  })

  it('keeps funded separate charges out of fees without changing the existing balance model', () => {
    const d = jobDetailData(store({ timeEntries: [time({ hours: 8 }), time({ id: 'nonbillable', hours: 2, billable: false })],
      items: [item({ unit_price: 200, billed: true, invoice_id: 'invoice', deposit_applied: 0 })],
      invoices: [{ id: 'invoice', job_id: 'job', number: 'INV-1', amount: 1200, issued_date: '2026-10-18', paid_date: null, notes: '', created_at: stamp }],
    }), 'job', now)!
    expect(d.overview.billing).toMatchObject({ loggedHours: 10, workValue: 1200, feeRevenue: 1000, effectiveHourlyRate: 100, balance: 0 })
  })

  it('includes saved plans from local today forward for every ownership, with phase context', () => {
    const d = jobDetailData(store({ schedule: [
      plan({ id: 'yesterday', date: '2026-10-17', hours: 100 }),
      plan({ id: 'today-owner', created_at: '2026-10-18T00:00:00Z' }),
      plan({ id: 'today-legacy', user_id: 'legacy', phase_id: null, hours: 3, created_at: '2026-10-18T00:00:00.000001Z' }),
      plan({ id: 'tomorrow', date: '2026-10-19', user_id: 'legacy', hours: 5 }), plan({ id: 'foreign', job_id: 'other', hours: 100 }),
    ] }), 'job', new Date('2026-10-18T00:15:00'))!
    expect(d.today).toBe('2026-10-18')
    expect(d.upcomingPlans.map(row => row.entry.id)).toEqual(['today-owner', 'today-legacy', 'tomorrow'])
    expect(d.upcomingPlannedHours).toBe(10)
    expect(d.upcomingPlans[0]).toMatchObject({ phaseName: 'Design', isOwner: true })
    expect(d.upcomingPlans[1]).toMatchObject({ phaseName: 'General', isOwner: false })
  })

  it('keeps historical completed-phase overruns visible without counting them as remaining work', () => {
    const d = jobDetailData(store({ phases: [phase({ id: 'done', status: 'complete', estimate_hours: 1 }), phase({ estimate_hours: 1 })],
      timeEntries: [time({ id: 'done-time', phase_id: 'done', hours: 3 }), time({ hours: 2, billable: false })],
    }), 'job', now)!
    expect(d.phaseSummaries.find(row => row.phase.id === 'done')).toMatchObject({ actualHours: 3, remainingHours: 0, overHours: 2 })
    expect(d.phaseSummaries.find(row => row.phase.id === 'phase')).toMatchObject({ actualHours: 2, remainingHours: 0, overHours: 1 })
  })
})

describe('job detail recent history ordering', () => {
  it('orders recent time and charges by date, precise creation timestamp, then ID', () => {
    const times = [time({ id: 'whole' }), time({ id: 'micro', created_at: '2026-10-18T01:00:00.000001+01:00' }),
      time({ id: 'b', created_at: '2026-10-18T00:00:00.000002Z' }), time({ id: 'a', created_at: '2026-10-18T00:00:00.000002Z' }),
      time({ id: 'next-day', date: '2026-10-19', created_at: '2026-01-01T00:00:00Z' }), time({ id: 'foreign', job_id: 'other' })]
    const s = store({ timeEntries: times, items: times.map(entry => item({ id: entry.id, job_id: entry.job_id, date: entry.date, created_at: entry.created_at })) })
    Object.freeze(s.timeEntries)
    Object.freeze(s.items)
    const d = jobDetailData(s, 'job', now)!
    expect(d.recentEntries.map(entry => entry.id)).toEqual(['next-day', 'b', 'a', 'micro', 'whole'])
    expect(d.items.map(row => row.item.id)).toEqual(['next-day', 'b', 'a', 'micro', 'whole'])
    expect(s.timeEntries[0].id).toBe('whole')
  })

  it('orders notes newest first, including precise timestamp ties, without changing the store', () => {
    const s = store({ comments: [comment({ id: 'old' }), comment({ id: 'micro', created_at: '2026-10-18T00:00:00.000001Z' }),
      comment({ id: 'b', created_at: '2026-10-19T00:00:00Z' }), comment({ id: 'a', created_at: '2026-10-19T00:00:00Z' }),
      comment({ id: 'foreign', job_id: 'other', created_at: '2026-10-20T00:00:00Z' })] })
    Object.freeze(s.comments)
    expect(jobDetailData(s, 'job', now)!.comments.map(note => note.id)).toEqual(['b', 'a', 'micro', 'old'])
    expect(s.comments[0].id).toBe('old')
  })
})
