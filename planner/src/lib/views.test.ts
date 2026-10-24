import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lateCount, mondayOf, summarizeJob, taskOrder, weekDays } from './views'
import type { Client, Job, Phase, Task } from './types'

const job = (over: Partial<Job> = {}): Job => ({ id: 'j', client_id: 'c', job_number: '26-1', name: 'Job', description: '', address: '', status: 'active', priority: 1, fee: null, job_type_id: null, size: null, use_in_estimates: true, estimate_note: '', closeout_reason: '', queued_date: null, start_date: null, due_date: null, created_at: '2026-01-01T00:00:00Z', ...over })
const task = (over: Partial<Task>): Task => ({ id: 't', job_id: 'j', phase_id: null, title: 'T', description: '', status: 'todo', assignee_id: null, due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: null, recurrence: 'none', recurrence_parent_id: null, sort_order: 0, completed_at: null, created_by: null, created_at: '2026-01-01T00:00:00Z', ...over })
const phase = (over: Partial<Phase>): Phase => ({ id: 'p', job_id: 'j', kind: 'design', name: 'Design', sort_order: 2, status: 'not_started', estimate_hours: 0, start_date: null, due_date: null, assignee_id: null, notes: '', ...over })
const client: Client = { id: 'c', name: 'Client', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: '' }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T10:00:00')) })
afterEach(() => vi.useRealTimers())

describe('lateCount', () => {
  it('counts late tasks and deadlines on open jobs but not tasks waiting on someone', () => {
    const store = {
      jobs: [job(), job({ id: 'done', status: 'complete' })], clients: [client],
      phases: [phase({ due_date: '2026-10-20' })],
      tasks: [task({ id: 'a', due_date: '2026-10-19' }), task({ id: 'b', due_date: '2026-10-19', status: 'waiting' }), task({ id: 'c', due_date: '2026-10-19', job_id: 'done' }), task({ id: 'd', due_date: '2026-10-22' })],
    }
    expect(lateCount(store, '2026-10-21')).toBe(2)
  })
})

describe('summarizeJob', () => {
  it('finds the next task and the earliest open deadline', () => {
    const store = {
      jobs: [job({ due_date: '2026-11-30' })], clients: [client], phases: [phase({ due_date: '2026-11-01' })],
      tasks: [task({ id: 'w', title: 'Waiting', status: 'waiting', due_date: '2026-10-22' }), task({ id: 'n', title: 'Next', due_date: '2026-10-25' }), task({ id: 'x', title: 'Done', status: 'done', due_date: '2026-10-01' })],
      timeEntries: [], invoices: [], deposits: [], items: [], profiles: [], schedule: [], settings: { id: 1, company_name: '', business_email: '', default_rate: 100, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' },
    }
    const s = summarizeJob(store, store.jobs[0], '2026-10-21')
    expect(s.nextTask?.title).toBe('Next')
    expect(s.nextDeadline).toMatchObject({ date: '2026-10-22', kind: 'task' })
    expect(s.openTasks).toHaveLength(2)
  })
})

describe('taskOrder', () => {
  it('sorts by date, undated last, started work first on the same day', () => {
    const list = [task({ id: '1', due_date: null }), task({ id: '2', due_date: '2026-10-22' }), task({ id: '3', due_date: '2026-10-22', status: 'doing' }), task({ id: '4', due_date: '2026-10-20' })]
    expect(list.sort(taskOrder).map(t => t.id)).toEqual(['4', '3', '2', '1'])
  })
})

describe('weekDays', () => {
  it('splits weekly capacity over weekdays and sums plans on active jobs only', () => {
    const days = weekDays({
      jobs: [job(), job({ id: 'held', status: 'on_hold' })], me: null, settings: { id: 1, company_name: '', business_email: '', default_rate: 100, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' },
      schedule: [{ id: 's1', job_id: 'j', phase_id: null, user_id: 'u', date: '2026-10-21', hours: 3, note: '', created_at: '' }, { id: 's2', job_id: 'held', phase_id: null, user_id: 'u', date: '2026-10-21', hours: 5, note: '', created_at: '' }],
      timeEntries: [],
    }, mondayOf('2026-10-21'), '2026-10-21')
    expect(days).toHaveLength(7)
    expect(days[0].date).toBe('2026-10-19')
    expect(days[2]).toMatchObject({ planned: 3, capacity: 8, isToday: true })
    expect(days[5]).toMatchObject({ capacity: 0, weekend: true })
  })
})
