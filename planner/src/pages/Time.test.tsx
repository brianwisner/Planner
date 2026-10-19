// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Job, TimeEntry } from '../lib/types'
import { downloadCSV } from '../lib/utils'
import { Time } from './Time'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('../lib/utils')>(), downloadCSV: vi.fn() }))
const stamp = '2026-10-19T09:00:00-07:00'
const entry = (id: string, overrides: Partial<TimeEntry> = {}): TimeEntry => ({ id, job_id: 'job', phase_id: 'phase', task_id: null, user_id: 'owner', date: '2026-10-19', hours: 2, started_at: null, rate: 125.5, notes: `Notes ${id}`, billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: stamp, ...overrides })
const job = (id: string, overrides: Partial<Job> = {}): Job => ({ id, client_id: 'client', job_number: `SYN-${id}`, name: `${id} design`, description: '', address: '', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: stamp, ...overrides })
let container: HTMLDivElement, root: Root
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const profile = { id: 'owner', email: null, full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 200, weekly_hours: 40, ics_token: '', created_at: stamp }
  store = { session: null, me: profile, settings: { id: 1, company_name: 'Synthetic', default_rate: 250, weekly_capacity: 40 }, profiles: [profile, { ...profile, id: 'legacy', full_name: 'Earlier Owner' }],
    clients: [{ id: 'client', name: 'Cedar Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: stamp }], jobs: [job('job'), job('archive', { status: 'archived' })], phases: [{ id: 'phase', job_id: 'job', kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 10, start_date: null, due_date: null, assignee_id: null, notes: '' }], tasks: [],
    timeEntries: [entry('a', { notes: 'Beam design' }), entry('b', { hours: 1, billable: false }), entry('archive', { job_id: 'archive', phase_id: null, user_id: 'legacy', date: '2026-10-21', hours: 0.5 }), entry('running', { hours: null, started_at: '2026-10-19T11:00:00-07:00' }), entry('future', { date: '2026-10-26', hours: 5 }), entry('past', { date: '2026-10-11', hours: 7 })],
    invoices: [], deposits: [], items: [], comments: [], schedule: [], loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(), insert: vi.fn(async () => null), update: vi.fn(async () => true), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null) }
  vi.mocked(downloadCSV).mockClear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
function Probe() { const location = useLocation(), nav = useNavigate(); return <div><output data-testid="location">{location.search}</output><button onClick={() => nav(-1)}>Test back</button><button onClick={() => nav(1)}>Test forward</button></div> }
async function render(url = '/time') { await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Time /><Probe /></MemoryRouter>)) }
function button(name: string): HTMLButtonElement { const found = [...container.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name); if (!found) throw new Error(`Missing ${name}`); return found }
function field(name: string): HTMLInputElement | HTMLSelectElement { const found = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${name}"]`); if (!found) throw new Error(`Missing ${name}`); return found }
async function change(input: HTMLInputElement | HTMLSelectElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
function ids(): string[] { return [...container.querySelectorAll('tr[data-entry-id]')].map(row => row.getAttribute('data-entry-id')!) }
function query() { return new URLSearchParams(container.querySelector('[data-testid="location"]')?.textContent ?? '') }
function noWrites() { expect(store.update).not.toHaveBeenCalled(); expect(store.insert).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }
async function cancel() { const dialog = container.querySelector('[role="dialog"]')!; await act(async () => ([...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel') as HTMLButtonElement).click()); expect(container.querySelector('[role="dialog"]')).toBeNull() }

describe('Time page', () => {
  it('labels retained completed hours and timers Planning history and finds them under that label', async () => {
    store.phases[0] = { ...store.phases[0], kind: 'queued', name: 'Retired custom queue label' }
    await render('/time?range=all')
    expect(container.querySelector('[aria-label="Your running timers"]')?.textContent).toContain('Planning history')
    expect(container.querySelector('.time-history-table')?.textContent).toContain('Planning history')
    expect(container.textContent).not.toContain('Retired custom queue label')
    await change(field('Search time entries'), 'Planning history')
    expect(ids().sort()).toEqual(['a', 'b', 'future', 'past', 'running'])
    await act(async () => button('Export CSV').click())
    expect(vi.mocked(downloadCSV).mock.calls[0][2].every(row => row[4] === 'Planning history')).toBe(true)
    expect(store.phases[0].name).toBe('Retired custom queue label')
    noWrites()
  })
  it('separates completed, billable, nonbillable, and running totals and bounds the week', async () => {
    await render()
    expect([...container.querySelectorAll('.time-stats .value')].map(value => value.textContent)).toEqual(['3.5h', '2.5h', '1h', '1'])
    expect(ids().sort()).toEqual(['a', 'archive', 'b', 'running'])
    expect(container.querySelector('.time-week-table tfoot td:last-child')?.textContent).toBe('3.5h')
    expect(container.textContent).toContain('Earlier Owner')
    noWrites()
  })
  it('keeps all-time history explicit and synchronizes date range and filters with back/forward', async () => {
    await render('/time?keep=yes')
    await act(async () => button('All time').click())
    expect(ids()).toHaveLength(6); expect(query().get('range')).toBe('all')
    expect(container.querySelector('.time-week-table')).toBeNull()
    await change(field('Billable time'), 'nonbillable')
    expect(ids()).toEqual(['b'])
    await act(async () => button('Test back').click())
    expect(ids()).toHaveLength(6)
    await act(async () => button('Test forward').click())
    expect(ids()).toEqual(['b']); expect(query().get('keep')).toBe('yes')
    noWrites()
  })
  it('restores archived job filters and scopes new hours to that historical job', async () => {
    await render('/time?job=archive')
    expect(field('Filter time by job').value).toBe('archive')
    expect(ids()).toEqual(['archive'])
    await act(async () => button('Log hours').click())
    expect(container.querySelector('[role="dialog"] select')?.getAttribute('value') ?? (container.querySelector('[role="dialog"] select') as HTMLSelectElement).value).toBe('archive')
    await cancel(); noWrites()
  })
  it('preserves raw search spaces and matches separate words across job/client/notes', async () => {
    await render()
    await change(field('Search time entries'), '  cedar   beam  ')
    expect(ids()).toEqual(['a']); expect(query().get('q')).toBe('  cedar   beam  ')
    await change(field('Search time entries'), 'Earlier Owner')
    expect(ids()).toEqual(['archive'])
    noWrites()
  })
  it('rejects invalid custom dates without showing unfiltered history or exporting it', async () => {
    await render('/time?range=custom&from=2026-10-25&to=2026-10-19')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('end date')
    expect(ids()).toEqual([]); expect(button('Export CSV').disabled).toBe(true)
    await change(field('To date'), '2026-10-26')
    expect(ids()).toEqual(['future']); noWrites()
  })
  it('navigates local weeks and returns to this week without losing the job scope', async () => {
    await render('/time?job=job')
    await act(async () => button('Previous week').click())
    expect(field('Week starting').value).toBe('2026-10-12')
    expect(query().get('job')).toBe('job')
    await act(async () => button('This week').click())
    expect(field('Week starting').value).toBe('2026-10-19'); expect(query().has('week')).toBe(false)
    noWrites()
  })
  it('keeps completed status independent of billable mode and running rows separate', async () => {
    await render('/time?status=completed&billable=nonbillable')
    expect(ids()).toEqual(['b'])
    await change(field('Time status'), 'running')
    expect(ids()).toEqual([])
    expect(container.querySelector('[aria-label="Your running timers"]')).toBeTruthy()
    noWrites()
  })
  it('shows all matches through honest pages and exports the full filtered set', async () => {
    store.timeEntries = Array.from({ length: 351 }, (_, index) => entry(`entry-${String(index).padStart(3, '0')}`))
    await render('/time?range=all')
    expect(ids()).toHaveLength(50); expect(container.textContent).toContain('1–50 of 351 matching entries')
    await act(async () => button('Next entries').click())
    expect(ids()).toHaveLength(50); expect(query().get('page')).toBe('2'); expect(container.textContent).toContain('51–100 of 351 matching entries')
    await act(async () => button('Export CSV').click())
    expect(vi.mocked(downloadCSV).mock.calls[0][2]).toHaveLength(351)
    noWrites()
  })
  it('resets pagination when searching and leaves an actionable no-results state', async () => {
    await render('/time?range=all&page=99')
    expect(ids()).toHaveLength(6)
    await change(field('Search time entries'), 'No match')
    expect(query().has('page')).toBe(false)
    expect(container.textContent).toContain('No entries match these filters')
    await act(async () => button('Reset filters').click())
    expect(ids()).toHaveLength(4); noWrites()
  })
  it('waits for loading to finish before consuming an entry deep link', async () => {
    const saved = store.timeEntries
    store.timeEntries = []; store.loading = true
    await render('/time?range=all&entry=a')
    expect(query().get('entry')).toBe('a'); expect(container.querySelector('[role="dialog"]')).toBeNull()
    store.timeEntries = saved; store.loading = false
    await render('/time?range=all&entry=a')
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe('Edit hours')
    expect(query().has('entry')).toBe(false); expect(query().get('range')).toBe('all')
    await cancel(); noWrites()
  })
  it('reports a missing deep link once and preserves the other query values', async () => {
    await render('/time?entry=missing&range=all')
    expect(store.toast).toHaveBeenCalledTimes(1)
    expect(query().has('entry')).toBe(false); expect(query().get('range')).toBe('all')
    noWrites()
  })
  it('uses real job/billing links and opens an explicit edit action', async () => {
    await render()
    expect(container.querySelector('a[href="/jobs/archive"]')).toBeTruthy()
    expect(container.querySelector('a[href="/billing?job=archive"]')).toBeTruthy()
    await act(async () => button('Edit time entry on 2026-10-19: Beam design').click())
    expect(container.querySelector('[role="dialog"] h2')?.textContent).toBe('Edit hours')
    await cancel(); noWrites()
  })
  it('guards a pending timer stop against repeated clicks and reports failure after refresh', async () => {
    let resolveUpdate!: (value: boolean) => void
    vi.mocked(store.update).mockImplementation(() => new Promise(resolve => { resolveUpdate = resolve }))
    await render()
    const stop = button('Stop timer for job design')
    await act(async () => { stop.click(); stop.click() })
    expect(store.update).toHaveBeenCalledTimes(1); expect(stop.disabled).toBe(true)
    await act(async () => resolveUpdate(false))
    expect(store.refresh).toHaveBeenCalledWith('time_entries')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be stopped')
    expect(store.insert).not.toHaveBeenCalled()
  })
  it('does not offer stop controls for a different historical owner', async () => {
    store.timeEntries = [entry('running-legacy', { user_id: 'legacy', hours: null, billable: false, started_at: '2026-10-19T11:00:00-07:00' })]
    await render()
    expect(container.querySelector('[aria-label="Your running timers"]')).toBeNull()
    expect(ids()).toEqual(['running-legacy'])
    expect(container.querySelector('tr[data-entry-id="running-legacy"]')?.textContent).toContain('Nonbillable')
    expect([...container.querySelectorAll('button')].some(button => button.getAttribute('aria-label')?.startsWith('Stop timer'))).toBe(false)
    noWrites()
  })
  it('exports completed saved values with cents and formula-safe notes, while running hours stay blank', async () => {
    store.timeEntries[0] = { ...store.timeEntries[0], hours: 0.5, notes: '=SUM(1,2)' }
    await render('/time?job=job')
    await act(async () => button('Export CSV').click())
    const [filename, headers, rows] = vi.mocked(downloadCSV).mock.calls[0]
    expect(filename).toBe('hours-2026-10-19.csv'); expect(headers).toContain('Completed hours')
    expect(rows.find(row => row[13] === "'=SUM(1,2)")?.[10]).toBe(62.75)
    expect(rows.find(row => row[12] === 'Running timer')?.[7]).toBeNull()
    noWrites()
  })
})
