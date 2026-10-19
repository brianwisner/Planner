import { describe, expect, it } from 'vitest'
import type { Store } from './store'
import type { Job, Phase, TimeEntry } from './types'
import { filterTimeRows, parseTimeQuery, timeCSV, timeDays, timeRangeError, timeRows, timeTotals, timeWeek, validTimeDate, writeTimeQuery } from './time'

const now = new Date(2026, 9, 19, 12)
const stamp = '2026-10-19T18:00:00Z'
const job: Job = { id: 'job', client_id: 'client', job_number: '26-101', name: 'Cedar design', description: '', address: '', status: 'archived', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: stamp }
const entry = (id: string, overrides: Partial<TimeEntry> = {}): TimeEntry => ({ id, job_id: 'job', phase_id: null, task_id: null, user_id: 'legacy', date: '2026-10-19', hours: 2, started_at: null, rate: 125.5, notes: 'Beam design', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: stamp, ...overrides })
function store(entries: TimeEntry[] = []): Parameters<typeof timeRows>[0] {
  return { jobs: [job], clients: [{ id: 'client', name: 'Cedar Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: stamp }], phases: [], tasks: [], timeEntries: entries, profiles: [{ id: 'legacy', email: null, full_name: 'Earlier owner', color: '', hourly_rate: 200, weekly_hours: 40, ics_token: '', created_at: stamp }], settings: { id: 1, company_name: '', default_rate: 250, weekly_capacity: 40 }, invoices: [], deposits: [], items: [] } satisfies Pick<Store, 'jobs' | 'clients' | 'phases' | 'tasks' | 'timeEntries' | 'profiles' | 'settings' | 'invoices' | 'deposits' | 'items'>
}
const query = (params = '') => parseTimeQuery(new URLSearchParams(params), now)

describe('time query and local dates', () => {
  it('uses local Monday boundaries even when a Pacific Sunday is Monday in UTC', () => {
    expect(timeWeek(new Date(2026, 9, 18, 19, 30))).toBe('2026-10-12')
    expect(timeWeek(new Date(2026, 9, 19, 0, 15))).toBe('2026-10-19')
    expect(timeDays(timeWeek(new Date(2026, 10, 1, 23, 30)))).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
  })
  it('validates actual calendar dates and normalizes a chosen date to its local week', () => {
    expect(validTimeDate('2028-02-29')).toBe(true)
    for (const date of ['2026-02-29', '2026-13-01', '2026-10-32', '10/19/2026', '']) expect(validTimeDate(date)).toBe(false)
    expect(query('week=2026-10-22').week).toBe('2026-10-19')
    expect(query('week=bad&range=invalid&status=invalid&page=-4').week).toBe('2026-10-19')
    expect(query('range=invalid&status=invalid&page=-4')).toMatchObject({ range: 'week', status: 'all', page: 1 })
  })
  it('preserves raw search spaces and unrelated URL values while omitting defaults', () => {
    const result = writeTimeQuery(new URLSearchParams('keep=yes&entry=entry'), { q: '  Cedar beam  ', range: 'all', job: 'job' }, now)
    expect(result.get('q')).toBe('  Cedar beam  ')
    expect(result.get('keep')).toBe('yes')
    expect(result.get('entry')).toBe('entry')
    expect(result.has('week')).toBe(false)
    expect(parseTimeQuery(result, now)).toMatchObject({ range: 'all', job: 'job', q: '  Cedar beam  ' })
  })
  it('blocks incomplete, invalid, and reversed custom ranges instead of showing all history', () => {
    for (const params of ['range=custom', 'range=custom&from=2026-02-29&to=2026-03-01', 'range=custom&from=2026-10-25&to=2026-10-19']) {
      const value = query(params)
      expect(timeRangeError(value)).toBeTruthy()
      expect(filterTimeRows(timeRows(store([entry('one')]), now), value)).toEqual([])
    }
    expect(timeRangeError(query('range=custom&from=2026-10-19&to=2026-10-19'))).toBeNull()
  })
})
describe('time rows and totals', () => {
  it('searches and exports retained phase hours as Planning history without changing their saved phase', () => {
    const data = store([entry('old-work', { phase_id: 'history' })])
    const history: Phase = { id: 'history', job_id: 'job', kind: 'queued', name: 'Retired custom queue label', sort_order: 2, status: 'waiting', estimate_hours: 4, start_date: null, due_date: null, assignee_id: null, notes: '' }
    const rows = timeRows({ ...data, phases: [history] }, now)
    expect(filterTimeRows(rows, query('q=planning+history'))).toHaveLength(1)
    expect(filterTimeRows(rows, query('q=Retired+custom+queue'))).toHaveLength(0)
    expect(timeCSV(rows)[0][4]).toBe('Planning history')
    expect(rows[0].entry.phase_id).toBe('history')
    expect(history.name).toBe('Retired custom queue label')
  })
  it('keeps archived jobs and historical owners while excluding running time from completed totals', () => {
    const data = store([entry('billable'), entry('nonbillable', { hours: 1, billable: false }), entry('running', { hours: null, started_at: new Date(2026, 9, 19, 11).toISOString() })])
    const rows = filterTimeRows(timeRows(data, now), query())
    expect(rows).toHaveLength(3)
    expect(rows.find(row => row.entry.id === 'billable')).toMatchObject({ ownerName: 'Earlier owner', amount: 251, rate: 125.5, job: { status: 'archived' } })
    expect(rows.find(row => row.entry.id === 'running')).toMatchObject({ amount: null, status: 'running', elapsedHours: 1 })
    expect(timeTotals(rows)).toEqual({ hours: 3, billable: 2, nonbillable: 1, completed: 2, running: 1, elapsed: 1 })
  })
  it('bounds weeks on both sides and includes custom endpoints', () => {
    const rows = timeRows(store([entry('before', { date: '2026-10-18' }), entry('first'), entry('last', { date: '2026-10-25' }), entry('after', { date: '2026-10-26' })]), now)
    expect(filterTimeRows(rows, query()).map(row => row.entry.id)).toEqual(['last', 'first'])
    expect(filterTimeRows(rows, query('range=custom&from=2026-10-18&to=2026-10-19')).map(row => row.entry.id)).toEqual(['first', 'before'])
    expect(filterTimeRows(rows, query('range=all'))).toHaveLength(4)
  })
  it('searches separate words across notes, client, job, and saved owner', () => {
    const rows = timeRows(store([entry('one')]), now)
    expect(filterTimeRows(rows, query('q=CEDAR+beam+owner'))).toHaveLength(1)
    expect(filterTimeRows(rows, query('q=missing'))).toEqual([])
    expect(filterTimeRows(rows, query('billable=nonbillable'))).toEqual([])
  })
  it('sorts equal dates using microseconds and equivalent timezone offsets', () => {
    const rows = timeRows(store([entry('older', { created_at: '2026-10-19T18:00:00.000001Z' }), entry('newer', { created_at: '2026-10-19T19:00:00.000002+01:00' }), entry('newest-day', { date: '2026-10-20', created_at: '2026-10-18T00:00:00Z' })]), now)
    expect(rows.map(row => row.entry.id)).toEqual(['newest-day', 'newer', 'older'])
  })
  it('clamps invalid/future running elapsed time and never invents completed hours', () => {
    const rows = timeRows(store([entry('future', { hours: null, started_at: new Date(2026, 9, 20).toISOString() }), entry('bad', { hours: null, started_at: 'bad' })]), now)
    expect(rows.every(row => row.elapsedHours === 0 && row.amount === null)).toBe(true)
    expect(timeTotals(rows)).toMatchObject({ hours: 0, running: 2, elapsed: 0 })
  })
  it('keeps all matches beyond the old 300-row limit', () => {
    expect(filterTimeRows(timeRows(store(Array.from({ length: 351 }, (_, index) => entry(`entry-${index}`))), now), query('range=all'))).toHaveLength(351)
  })
  it('retains lifetime deposit allocation when only one week is visible', () => {
    const data = store([entry('older', { date: '2026-10-18' }), entry('current')])
    data.deposits.push({ id: 'deposit', job_id: 'job', amount: 251, received_date: '2026-10-10', method: '', notes: '', created_at: stamp })
    const visible = filterTimeRows(timeRows(data, now), query())
    expect(visible).toHaveLength(1)
    expect(visible[0]).toMatchObject({ entry: { id: 'current' }, status: 'unbilled' })
  })
  it('exports numeric saved values with cents, blank completed values for timers, and formula-safe text', () => {
    const data = store([entry('one', { hours: 0.5, notes: '=SUM(1,2)' }), entry('timer', { hours: null, started_at: new Date(2026, 9, 19, 11).toISOString() })])
    data.jobs[0] = { ...job, name: '+Job' }
    const rows = timeRows(data, now), csv = timeCSV(rows)
    const completed = csv[rows.findIndex(row => row.entry.id === 'one')]
    expect(completed[3]).toBe("'+Job")
    expect(completed[7]).toBe(0.5)
    expect(completed[9]).toBe(125.5)
    expect(completed[10]).toBe(62.75)
    expect(completed[13]).toBe("'=SUM(1,2)")
    const running = csv[rows.findIndex(row => row.entry.id === 'timer')]
    expect(running[7]).toBeNull()
    expect(running[8]).toBe(1)
    expect(running[10]).toBeNull()
  })
})
