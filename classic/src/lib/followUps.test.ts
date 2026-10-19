import { describe, expect, it } from 'vitest'
import { filterFollowUps, latestContact, parseFollowUpQuery, validPlanningDate, writeFollowUpQuery } from './followUps'
import type { FollowUp } from './planningTypes'
import type { Job } from './types'

const row = (patch: Partial<FollowUp> = {}): FollowUp => ({ id: 'follow', revision: 1, created_at: '', updated_at: '', job_id: 'job', invoice_id: null, title: 'Get dimensions', waiting_on: 'Architect', reason: 'Missing roof height', status: 'open', next_follow_up_date: '2026-10-19', promised_date: null, invoice_due_date: null, contact_log: [], notes: '', ...patch })
describe('follow-up filters and local dates', () => {
  it('validates dates and round-trips filters while preserving raw spaces and unrelated parameters', () => {
    expect(validPlanningDate('2026-02-30')).toBe(false); expect(validPlanningDate('2026-10-19')).toBe(true)
    const params = writeFollowUpQuery(new URLSearchParams('source=review'), { q: 'Roof height ', job: 'job', status: 'all', due: 'week' })
    expect(parseFollowUpQuery(params)).toEqual({ q: 'Roof height ', job: 'job', status: 'all', due: 'week' })
    expect(params.get('source')).toBe('review')
    expect(parseFollowUpQuery(new URLSearchParams('status=bad&due=bad'))).toEqual({ q: '', job: '', status: 'open', due: 'all' })
  })
  it('separates past due, today, upcoming and undated without treating promises as follow-up dates', () => {
    const rows = [row({ id: 'past', next_follow_up_date: '2026-10-18' }), row(), row({ id: 'future', next_follow_up_date: '2026-10-25' }), row({ id: 'later', next_follow_up_date: '2026-10-26' }), row({ id: 'undated', next_follow_up_date: null, promised_date: '2026-10-19' }), row({ id: 'done', status: 'done' })]
    const now = new Date('2026-10-19T23:30:00'), query = parseFollowUpQuery(new URLSearchParams())
    const ids = (due: typeof query.due) => filterFollowUps(rows, { ...query, due }, [], now).map(row => row.id)
    expect(ids('overdue')).toEqual(['past']); expect(ids('today')).toEqual(['follow']); expect(ids('week')).toEqual(['follow', 'future']); expect(ids('undated')).toEqual(['undated'])
  })
  it('searches job and contact history, scopes statuses and does not modify saved records', () => {
    const rows = [row({ contact_log: [{ id: 'contact', date: '2026-10-18', note: 'Called Sandy' }] }), row({ id: 'done', status: 'done' })]
    const saved = JSON.stringify(rows), jobs = [{ id: 'job', name: 'Cedar residence', job_number: 'SYN-001' }] as Job[]
    expect(filterFollowUps(rows, { q: 'cedar sandy', job: 'job', status: 'all', due: 'all' }, jobs).map(row => row.id)).toEqual(['follow'])
    expect(filterFollowUps(rows, { q: '', job: '', status: 'done', due: 'all' }, jobs).map(row => row.id)).toEqual(['done'])
    expect(JSON.stringify(rows)).toBe(saved)
  })
  it('selects the latest contact by recorded date, then the last appended note on that date', () => {
    expect(latestContact([{ id: 'future', date: '2026-10-19', note: 'First call' }, { id: 'last', date: '2026-10-19', note: 'Reply received' }, { id: 'older', date: '2026-10-18', note: 'Earlier call' }])?.id).toBe('last')
    expect(latestContact([])).toBeUndefined()
  })
})
