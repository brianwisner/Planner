import { describe, expect, it } from 'vitest'
import { carryPriorities, priorReview, reviewActivity } from './review'
import type { DailyReview, PlanningEvent, ReviewPriority } from './planningTypes'
import type { Store } from './store'

const priority = (patch: Partial<ReviewPriority> = {}): ReviewPriority => ({ id: 'outcome', title: 'Finish framing', job_id: 'job', done: false, ...patch })
const review = (patch: Partial<DailyReview> = {}): DailyReview => ({ id: 'review', revision: 1, created_at: '', updated_at: '', review_date: '2026-10-18', checkpoint_at: '2026-10-18T16:00:00Z', completed_at: '2026-10-18T16:30:00Z', notes: '', priorities: [], ...patch })
const event = (patch: Partial<PlanningEvent> = {}): PlanningEvent => ({ id: 'event', occurred_at: '2026-10-19T16:00:00Z', actor_id: null, entity_type: 'tasks', entity_id: 'task', job_id: 'job', action: 'update', summary: 'Task status changed', changed_fields: ['status'], ...patch })
const store = (patch: Partial<Store> = {}) => ({ jobs: [], tasks: [], timeEntries: [], invoices: [], deposits: [], comments: [], ...patch } as Store)

describe('shared morning review carryover', () => {
  it('uses only the latest prior review, with a separate completed-review checkpoint lookup', () => {
    const rows = [review(), review({ id: 'unfinished', review_date: '2026-10-19', completed_at: null }), review({ id: 'future', review_date: '2026-10-21' })]
    expect(priorReview(rows, '2026-10-20')?.id).toBe('unfinished')
    expect(priorReview(rows, '2026-10-20', true)?.id).toBe('review')
    expect(priorReview(rows, '2026-10-18')).toBeUndefined()
  })
  it('carries unfinished outcomes once across repeated days, preserving linked jobs and the original source', () => {
    const original = priority(), done = priority({ id: 'done', done: true }), empty = priority({ id: 'empty', title: ' ' })
    const first = carryPriorities([], [original, done, empty], () => 'day-two')
    expect(first).toEqual([priority({ id: 'day-two', source_id: 'outcome' })])
    expect(carryPriorities(first, [original], () => 'duplicate')).toEqual(first)
    const next = carryPriorities([], first, () => 'day-three')
    expect(next[0]).toMatchObject({ id: 'day-three', source_id: 'outcome', job_id: 'job' })
    expect(carryPriorities(next, first, () => 'duplicate')).toEqual(next)
    expect(original).not.toHaveProperty('source_id')
  })
})

describe('review activity cutoff', () => {
  it('uses (previous checkpoint, current checkpoint] including microseconds and excludes meeting changes until next review', () => {
    const since = '2026-10-18T16:00:00.123456Z', cutoff = '2026-10-19T16:00:00.654321Z'
    const events = [event({ id: 'boundary', occurred_at: since }), event({ id: 'first', occurred_at: '2026-10-18T16:00:00.123457Z' }), event({ id: 'cutoff', occurred_at: cutoff }), event({ id: 'meeting', occurred_at: '2026-10-19T16:10:00Z' }), event({ id: 'own-review', entity_type: 'daily_reviews' })]
    expect(reviewActivity(store(), events, since, cutoff).map(row => row.id)).toEqual(['event:cutoff', 'event:first'])
    expect(reviewActivity(store(), events, cutoff, '2026-10-20T16:00:00Z').map(row => row.id)).toEqual(['event:meeting'])
  })
  it('normalizes timestamp offsets and handles invalid or reversed boundaries', () => {
    expect(reviewActivity(store(), [event({ occurred_at: '2026-10-19T09:00:00-07:00' })], '2026-10-19T15:00:00Z', '2026-10-19T17:00:00Z')).toHaveLength(1)
    expect(reviewActivity(store(), [event()], 'invalid', '2026-10-20T00:00:00Z')).toEqual([])
    expect(reviewActivity(store(), [event()], '2026-10-20T00:00:00Z', '2026-10-19T00:00:00Z')).toEqual([])
  })
  it('names concrete changed fields with a compact limit while keeping insert summaries intact', () => {
    const rows = reviewActivity(store(), [event({ summary: 'Update: Cedar', changed_fields: ['due_date', 'status', 'priority', 'paid_date', 'hours', 'next_deliverable'] }), event({ id: 'insert', action: 'insert', summary: 'New job: Cedar', changed_fields: ['name'] })], '2026-10-19T00:00:00Z', '2026-10-19T18:00:00Z')
    expect(rows.find(row => row.id === 'event:event')?.title).toBe('Update: Cedar · Changed: due date, status, priority, payment date, +2 more')
    expect(rows.find(row => row.id === 'event:insert')?.title).toBe('New job: Cedar')
  })
  it('uses truthful creation/completion fallback without duplicating tracked entities or claiming progress from hours', () => {
    const s = store({ tasks: [{ id: 'task', job_id: 'job', title: 'Tracked task', created_at: '2026-10-19T12:00:00Z', completed_at: null }, { id: 'done', job_id: 'job', title: 'Delivered drawings', created_at: '2026-10-01T12:00:00Z', completed_at: '2026-10-19T15:00:00Z' }] as Store['tasks'], timeEntries: [{ id: 'time', job_id: 'job', date: '2026-10-18', hours: 2, billable: false, created_at: '2026-10-19T14:00:00Z' }, { id: 'timer', hours: null, created_at: '2026-10-19T14:00:00Z' }] as Store['timeEntries'] })
    const rows = reviewActivity(s, [event()], '2026-10-19T00:00:00Z', '2026-10-19T18:00:00Z')
    expect(rows).toHaveLength(3)
    expect(rows.map(row => row.title)).toContain('Task completed: Delivered drawings')
    expect(rows.find(row => row.id.includes('time_entries'))?.title).toBe('2h recorded for Oct 18 · nonbillable')
    expect(rows.filter(row => row.id.includes('tasks:task'))).toEqual([])
    expect(rows.some(row => /progress|percent|%/.test(row.title))).toBe(false)
  })
  it('keeps historical invoice payment dates explicitly date-only, including local boundary days', () => {
    const since = new Date('2026-10-18T09:00:00').toISOString(), until = new Date('2026-10-19T09:00:00').toISOString()
    const s = store({ invoices: [{ id: 'paid', job_id: 'job', number: 'SYN-I', amount: 123.45, paid_date: '2026-10-18', created_at: '2026-10-01T12:00:00Z' }] as Store['invoices'] })
    expect(reviewActivity(s, [], since, until)).toEqual([expect.objectContaining({ at: '2026-10-18', dateOnly: true, source: 'recorded', title: 'Invoice payment date: SYN-I · $123' })])
    expect(reviewActivity(s, [event({ entity_type: 'invoices', entity_id: 'paid', occurred_at: new Date('2026-10-18T10:00:00').toISOString() })], since, until)).toEqual([expect.objectContaining({ source: 'event' })])
  })
})
