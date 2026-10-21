import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildICS, calendarItems, calendarOrder, googleCalendarLink, parseCalendarQuery, writeCalendarQuery, type CalItem } from './calendar'
import type { Client, Job, Phase, Task } from './types'

const STAMP = '2026-10-19T12:00:00Z'
function job(overrides: Partial<Job> = {}): Job { return { id: 'job', client_id: 'client', job_number: 'SYN-001', name: 'Synthetic residence', description: '', address: '', status: 'active', priority: 1, fee: null, job_type_id: null, size: null, use_in_estimates: true, estimate_note: '', closeout_reason: '', queued_date: null, start_date: null, due_date: '2026-10-19', created_at: STAMP, ...overrides } }
function phase(overrides: Partial<Phase> = {}): Phase { return { id: 'phase', job_id: 'job', kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 10, start_date: null, due_date: '2026-10-20', assignee_id: 'legacy', notes: '', ...overrides } }
function task(overrides: Partial<Task> = {}): Task { return { id: 'task', job_id: 'job', phase_id: 'phase', title: 'Site inspection', description: '', status: 'todo', assignee_id: 'legacy', due_date: null, scheduled_at: new Date('2026-10-19T23:30:00').toISOString(), is_site_visit: true, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: 'legacy', created_at: STAMP, ...overrides } }
function client(): Client { return { id: 'client', name: 'Synthetic Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP } }
function item(overrides: Partial<CalItem> = {}): CalItem { return { id: 'event', jobId: 'job', jobName: 'Synthetic residence', date: '2026-11-01', time: null, title: 'All-day work', kind: 'task', assigneeId: null, done: false, link: '/jobs/job?task=task', ...overrides } }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T23:30:00')) })
afterEach(() => vi.useRealTimers())

describe('calendar source dates', () => {
  it('omits retired planning phase dates while retaining tasks and local visits on that saved phase', () => {
    const history = phase({ id: 'history', kind: 'queued', name: 'Custom queued label', status: 'waiting', due_date: '2026-10-01' })
    const items = calendarItems({ jobs: [job()], phases: [history], tasks: [task({ phase_id: 'history' }),
      task({ id: 'follow-up', phase_id: 'history', title: 'Follow up', is_site_visit: false, scheduled_at: null, due_date: '2026-10-20' })], clients: [client()] })
    expect(items.map(item => item.id)).toEqual(['job-job', 'task-task', 'task-follow-up'])
    expect(items.find(item => item.id === 'task-task')).toMatchObject({ date: '2026-10-19', kind: 'site_visit', link: '/jobs/job?task=task' })
    expect(history).toMatchObject({ name: 'Custom queued label', status: 'waiting', due_date: '2026-10-01' })
  })
  it('keeps a scheduled visit on its local day without requiring a due date', () => {
    const items = calendarItems({ jobs: [job()], phases: [phase()], tasks: [task()], clients: [client()] })
    expect(items.find(item => item.kind === 'site_visit')).toMatchObject({ date: '2026-10-19', time: new Date('2026-10-19T23:30:00').toISOString(), link: '/jobs/job?task=task', assigneeId: 'legacy', clientName: 'Synthetic Builders', jobNumber: 'SYN-001' })
  })
  it('marks completed-job history completed and omits cancelled/archived jobs', () => {
    const jobs = [job({ status: 'complete' }), job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' })]
    const items = calendarItems({ jobs, phases: jobs.map(job => phase({ id: `phase-${job.id}`, job_id: job.id })), tasks: jobs.map(job => task({ id: `task-${job.id}`, job_id: job.id })), clients: [client()] })
    expect(items).toHaveLength(3)
    expect(items.every(item => item.jobId === 'job' && item.done)).toBe(true)
  })
  it('honors caller job scope and tolerates invalid timed history with a valid fallback date', () => {
    const items = calendarItems({ jobs: [job()], phases: [phase({ job_id: 'foreign' })], tasks: [task({ scheduled_at: 'invalid', due_date: '2026-10-22' }), task({ id: 'foreign', job_id: 'foreign' })], clients: [] })
    expect(items).toHaveLength(2)
    expect(items.find(item => item.id === 'task-task')).toMatchObject({ date: '2026-10-22', time: null })
  })
  it('orders timed items by their instant rather than timestamp string offsets', () => {
    const early = item({ id: 'early', date: '2026-10-19', time: '2026-10-19T10:00:00+02:00' })
    const late = item({ id: 'late', date: '2026-10-19', time: '2026-10-19T09:00:00Z' })
    expect([late, early].sort(calendarOrder).map(item => item.id)).toEqual(['early', 'late'])
  })
})

describe('calendar URL state', () => {
  it('validates malformed controls and uses local month and responsive defaults', () => {
    expect(parseCalendarQuery(new URLSearchParams('month=2026-13&view=unknown&kind=no&status=no&focus=no'), new Date('2026-10-19T12:00:00'), 'agenda')).toEqual({ month: '2026-10', view: 'agenda', kind: 'all', status: 'open', focus: 'all', job: '', q: '' })
  })
  it('round-trips filters, raw search spaces and unrelated parameters', () => {
    const now = new Date('2026-10-19T12:00:00')
    const params = writeCalendarQuery(new URLSearchParams('source=job'), { month: '2026-11', view: 'agenda', job: 'job', q: 'Roof framing ', kind: 'site_visit', status: 'all', focus: 'today' }, now)
    expect(params.get('source')).toBe('job')
    expect(parseCalendarQuery(params, now)).toMatchObject({ month: '2026-11', view: 'agenda', job: 'job', q: 'Roof framing ', kind: 'site_visit', status: 'all', focus: 'today' })
    const cleared = writeCalendarQuery(params, { month: '2026-10', job: '', q: '', kind: 'all', status: 'open', focus: 'all' }, now)
    expect(cleared.toString()).toBe('source=job&view=agenda')
  })
})

describe('calendar exports', () => {
  it('advances an all-day end date over the autumn DST boundary', () => {
    const text = buildICS([item()], 'Synthetic calendar')
    expect(text).toContain('DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102')
    expect(new URL(googleCalendarLink(item(), 'https://example.test/planner/')).searchParams.get('dates')).toBe('20261101/20261102')
  })
  it('writes an actual UTC generation stamp while retaining floating local visit times', () => {
    const expectedStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const text = buildICS([item({ date: '2026-10-19', time: new Date('2026-10-19T14:30:00').toISOString() })], 'Synthetic')
    expect(text).toContain(`DTSTAMP:${expectedStamp}`)
    expect(text).toContain('DTSTART:20261019T143000')
    expect(text).toContain('DTEND:20261019T153000')
  })
  it('keeps item links and escapes exported text', () => {
    const event = item({ title: 'Review, notes; revised\nSecond line' })
    expect(buildICS([event], 'Synthetic, calendar')).toContain('SUMMARY:Review\\, notes\\; revised\\nSecond line')
    const link = new URL(googleCalendarLink(event, 'https://example.test/planner/'))
    expect(link.searchParams.get('details')).toContain('https://example.test/planner/#/jobs/job?task=task')
  })
})
