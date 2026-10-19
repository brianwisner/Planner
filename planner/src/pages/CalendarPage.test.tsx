// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Job, Phase, Task } from '../lib/types'
import { downloadText } from '../lib/utils'
import { CalendarPage } from './CalendarPage'

let store: Store, container: HTMLDivElement, root: Root
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('../lib/utils')>(), downloadText: vi.fn() }))
const STAMP = '2026-10-19T12:00:00Z'
function job(overrides: Partial<Job> = {}): Job { return { id: 'cedar', client_id: 'client', job_number: 'SYN-101', name: 'Cedar residence', description: '', address: '440 Maple Lane', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: '2026-10-22', created_at: STAMP, ...overrides } }
function phase(overrides: Partial<Phase> = {}): Phase { return { id: 'design', job_id: 'cedar', kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 10, start_date: null, due_date: '2026-10-21', assignee_id: null, notes: '', ...overrides } }
function task(overrides: Partial<Task> = {}): Task { return { id: 'review', job_id: 'cedar', phase_id: 'design', title: 'Review framing', description: '', status: 'todo', assignee_id: 'legacy-owner', due_date: '2026-10-18', scheduled_at: null, is_site_visit: false, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: 'legacy-owner', created_at: STAMP, ...overrides } }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T12:00:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
  const owner = { id: 'owner', email: null, full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 125, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  store = { session: null, me: owner, profiles: [owner], settings: { id: 1, company_name: 'Synthetic', default_rate: 125, weekly_capacity: 40 }, clients: [{ id: 'client', name: 'Oak Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP }, { id: 'other-client', name: 'Birch Group', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP }],
    jobs: [job(), job({ id: 'held', name: 'Held addition', status: 'on_hold', due_date: null }), job({ id: 'complete', name: 'Finished job', status: 'complete', due_date: '2026-10-02' }), job({ id: 'cancelled', name: 'Cancelled job', status: 'cancelled' }), job({ id: 'archived', name: 'Archived job', status: 'archived' }), job({ id: 'other', client_id: 'other-client', name: 'Other residence', due_date: null })],
    phases: [phase()], tasks: [task(), task({ id: 'visit', title: 'Site inspection', due_date: null, scheduled_at: new Date('2026-10-19T14:30:00').toISOString(), is_site_visit: true }), task({ id: 'done', title: 'Delivered plans', status: 'done', due_date: '2026-10-17' }), task({ id: 'november', title: 'Next month review', due_date: '2026-11-05' }), task({ id: 'held-task', job_id: 'held', phase_id: null, title: 'Architect reply', status: 'waiting', due_date: '2026-10-20' }), task({ id: 'complete-task', job_id: 'complete', title: 'Completed job history', due_date: '2026-10-03' }), task({ id: 'cancelled-task', job_id: 'cancelled', title: 'Hidden cancelled task' }), task({ id: 'archived-task', job_id: 'archived', title: 'Hidden archived task' }), task({ id: 'other-task', job_id: 'other', title: 'Other client review', due_date: '2026-10-25' })],
    timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [], loading: false, error: null, online: true, toasts: [], toast: vi.fn(), refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })
function Probe() { const location = useLocation(), navigate = useNavigate(); return <div><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Test back</button><button onClick={() => navigate(1)}>Test forward</button></div> }
async function render(url = '/calendar') { await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/calendar" element={<CalendarPage />} /></Routes><Probe /></MemoryRouter>)) }
function button(label: string | RegExp) { const found = [...container.querySelectorAll('button')].find(button => typeof label === 'string' ? (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label : label.test(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '')); if (!found) throw new Error(`Missing button ${label}`); return found }
function field(label: string) { const found = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`); if (!found) throw new Error(`Missing field ${label}`); return found }
async function change(control: HTMLInputElement | HTMLSelectElement, value: string) { const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
function query() { return new URLSearchParams(container.querySelector('[data-testid="location"]')?.textContent?.split('?')[1] ?? '') }
function links() { return [...container.querySelectorAll<HTMLAnchorElement>('.calendar-item-link')].map(link => link.textContent) }
function noWrites() { expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }

describe('CalendarPage', () => {
  it('shows scoped open-work summaries and an explicit calendar/history basis', async () => {
    await render()
    expect(button('Overdue: 1')).toBeTruthy(); expect(button('Today: 1')).toBeTruthy(); expect(button('Next 7 days: 5')).toBeTruthy(); expect(button('Site visits: 1')).toBeTruthy()
    expect((field('Calendar date status') as HTMLSelectElement).value).toBe('open')
    expect(container.querySelector('.calendar-status-scope')?.textContent).toContain('Cancelled and archived jobs are excluded')
    expect(container.querySelector('.calendar-export-scope')?.textContent).toContain('6 unfinished dates')
    noWrites()
  })
  it('restores URL filters and keeps task deep links plus local timed visits', async () => {
    await render('/calendar?job=cedar&kind=site_visit&view=agenda&month=2026-10')
    expect(field('Calendar job').value).toBe('cedar'); expect(field('Calendar date type').value).toBe('site_visit')
    expect(links()).toEqual(['Site inspection'])
    expect(container.querySelector('.calendar-item-link')?.getAttribute('href')).toBe('/jobs/cedar?task=visit')
    expect(container.querySelector('.calendar-item-time')?.textContent).toContain('2:30 PM')
    noWrites()
  })
  it('includes completed past dates in both views and keeps completed jobs out of open alerts', async () => {
    await render('/calendar?view=agenda&status=all')
    expect(links()).toContain('Delivered plans'); expect(links()).toContain('Completed job history')
    expect(container.querySelector('[aria-label="Overdue open dates"]')?.textContent).not.toContain('Completed job history')
    expect(container.textContent).not.toContain('Hidden cancelled task'); expect(container.textContent).not.toContain('Hidden archived task')
    await change(field('Calendar date status'), 'done')
    expect(links()).toHaveLength(3)
    expect(container.querySelector('.calendar-agenda')?.textContent).not.toContain('overdue')
    expect(button('Download open .ics').disabled).toBe(true)
    await act(async () => button('Month').click())
    expect(container.querySelector('.calendar-mini-event.is-done')).toBeTruthy()
    noWrites()
  })
  it('searches client/job context with raw spaces and combines date type and job filters', async () => {
    await render('/calendar?view=agenda')
    await change(field('Search calendar'), 'Oak ')
    expect(field('Search calendar').value).toBe('Oak '); expect(query().get('q')).toBe('Oak ')
    expect(links()).not.toContain('Other client review')
    await change(field('Calendar job'), 'held')
    expect(links()).toEqual(['Architect reply'])
    await change(field('Calendar date type'), 'site_visit')
    expect(container.querySelector('.calendar-empty')?.textContent).toContain('No dates match')
    await act(async () => button('Clear calendar filters').click())
    expect(query().get('view')).toBe('agenda'); expect(query().has('job')).toBe(false); expect(query().has('q')).toBe(false)
    noWrites()
  })
  it('shows action focus across months and returns explicitly to the selected month', async () => {
    await render('/calendar?view=agenda&month=2026-11')
    expect(links()).toEqual(['Next month review'])
    await act(async () => button('Today: 1').click())
    expect(query().get('focus')).toBe('today'); expect(query().get('month')).toBe('2026-11')
    expect(links()).toEqual(['Site inspection'])
    expect(container.querySelector('.calendar-focus-notice')?.textContent).toContain('local calendar day')
    expect(container.querySelector('input[aria-label="Calendar month"]')).toBeNull()
    await act(async () => button('Show selected month').click())
    expect(links()).toEqual(['Next month review'])
    expect(query().has('focus')).toBe(false)
    noWrites()
  })
  it('exports only unfinished dates in the visible month and filters', async () => {
    await render('/calendar?view=agenda&job=cedar&kind=task&status=all')
    await act(async () => button('Download open .ics').click())
    const [filename, text, mime] = vi.mocked(downloadText).mock.calls[0]
    expect(filename).toBe('wisner-planner.ics'); expect(mime).toBe('text/calendar')
    expect(text).toContain('Review framing'); expect(text).not.toContain('Delivered plans'); expect(text).not.toContain('Next month review'); expect(text).not.toContain('Site inspection')
    expect(container.querySelector('.calendar-export-scope')?.textContent).toContain('1 unfinished date')
    noWrites()
  })
  it('round-trips months/view through history while search replaces its current entry', async () => {
    await render('/calendar?view=agenda')
    await act(async () => button('Next month').click())
    expect(query().get('month')).toBe('2026-11')
    await change(field('Search calendar'), 'Next')
    await change(field('Search calendar'), 'Next month')
    await act(async () => button('Test back').click())
    expect(query().has('month')).toBe(false); expect(query().has('q')).toBe(false)
    await act(async () => button('Test forward').click())
    expect(query().get('month')).toBe('2026-11'); expect(query().get('q')).toBe('Next month')
    noWrites()
  })
  it('refreshes the local day after returning to a long-open calendar', async () => {
    await render('/calendar?view=agenda')
    vi.setSystemTime(new Date('2026-10-20T08:00:00'))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(button('Overdue: 2')).toBeTruthy(); expect(button('Today: 1')).toBeTruthy()
    noWrites()
  })
})
