// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Phase, ScheduleEntry } from '../lib/types'
import { Gantt } from './Gantt'
let store: Store, root: Root, container: HTMLDivElement
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../components/ScheduleModal', () => ({ ScheduleModal: (props: { phaseId: string; from: string; to: string }) => <div data-testid="schedule" data-phase={props.phaseId} data-from={props.from} data-to={props.to} /> }))
const today = '2026-10-19'
function phase(patch: Partial<Phase> = {}): Phase { return { id: 'design', job_id: 'job', kind: 'design', name: 'Design', status: 'in_progress', sort_order: 2, estimate_hours: 10, start_date: today, due_date: '2026-10-21', assignee_id: null, notes: '', ...patch } }
function plan(patch: Partial<ScheduleEntry> = {}): ScheduleEntry { return { id: 'saved', job_id: 'job', phase_id: 'history', user_id: 'owner', date: today, hours: 2, note: '', created_at: '', ...patch } }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${today}T12:00:00`))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear()
  const owner = { id: 'owner', full_name: 'Owner', email: null, color: '#123456', hourly_rate: 100, weekly_hours: 40, ics_token: '', created_at: '' }
  store = { session: null, me: owner, profiles: [owner], settings: { id: 1, company_name: 'Synthetic', default_rate: 100, weekly_capacity: 40 }, clients: [],
    jobs: [{ id: 'job', client_id: 'client', job_number: '', name: 'Synthetic residence', description: '', address: '', status: 'active', priority: 1, fee: null, queued_date: today, start_date: today, due_date: '2026-10-22', created_at: '' }],
    phases: [phase({ id: 'history', kind: 'queued', name: 'Custom Queued name', sort_order: 1, estimate_hours: 80, due_date: '2000-01-01' }), phase(), phase({ id: 'empty-history', kind: 'queued', name: 'Empty Queued' })],
    tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [plan()], loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(), insert: vi.fn(async () => null), update: vi.fn(async () => true), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render() { await act(async () => root.render(<MemoryRouter><Gantt jobs={[store.jobs[0]]} /></MemoryRouter>)) }
function button(label: string) { const found = [...container.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label); if (!found) throw new Error(`Missing ${label}`); return found }

describe('timeline workflow retirement', () => {
  it('retains saved history rows without retired bars, queue markers, custom queued names or old date-window expansion', async () => {
    await render()
    expect(container.querySelectorAll('.gphaserow')).toHaveLength(2)
    expect(container.querySelector('[data-phase-id="history"]')?.textContent).toContain('Planning history')
    expect(container.querySelector('[data-phase-id="history"] .gsched')).toBeTruthy()
    expect(container.querySelector('.gqueue')).toBeNull()
    expect(container.querySelector('.gbar2.queued')).toBeNull()
    expect(container.textContent).not.toContain('Custom Queued')
    expect(container.textContent).not.toContain('80h est')
    expect(container.querySelectorAll('.gdates > div').length).toBeLessThan(200)
    expect(container.querySelector('a[href="/jobs/job"]')).toBeTruthy()
    await act(async () => button('Collapse all').click())
    expect(container.querySelector('.gmini.queued')).toBeNull()
  })
  it('keeps all historical-owner active commitments in capacity but omits closed and on-hold jobs', async () => {
    store.jobs.push(...['active', 'on_hold', 'complete', 'archived', 'cancelled'].map((status, i) => ({ ...store.jobs[0], id: `other-${i}`, status: status as Store['jobs'][number]['status'] })))
    store.schedule.push(plan({ id: 'legacy', user_id: 'legacy', hours: 3 }), plan({ id: 'hidden-active', job_id: 'other-0', hours: 4 }), ...[1, 2, 3, 4].map(i => plan({ id: `closed-${i}`, job_id: `other-${i}`, hours: 20 })))
    await render()
    expect(container.querySelector('.ghours [title="9h planned on active jobs"]')).toBeTruthy()
    expect(container.querySelector('.ghours .over')?.textContent).toBe('9')
  })
  it('opens keyboard planning on workflow today and on an existing historical date only', async () => {
    store.schedule[0].date = '2026-10-15'
    await render()
    await act(async () => button('Edit saved Planning history for Synthetic residence: Planning history').click())
    expect(container.querySelector('[data-testid="schedule"]')?.getAttribute('data-phase')).toBe('history')
    expect(container.querySelector('[data-testid="schedule"]')?.getAttribute('data-from')).toBe('2026-10-15')
    await act(async () => button('Plan hours for Synthetic residence: Design').click())
    expect(container.querySelector('[data-testid="schedule"]')?.getAttribute('data-phase')).toBe('design')
    expect(container.querySelector('[data-testid="schedule"]')?.getAttribute('data-from')).toBe(today)
    expect(store.insert).not.toHaveBeenCalled()
  })
  it('shows other-owner saved history without enabling new owner plans for it', async () => {
    store.schedule[0].user_id = 'legacy'
    await render()
    expect(container.querySelector('[data-phase-id="history"] .gsched')).toBeTruthy()
    expect(button('Edit saved Planning history for Synthetic residence: Planning history').disabled).toBe(true)
  })
})
