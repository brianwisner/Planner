// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Client, Invoice, Job, Phase, Task, TimeEntry } from '../lib/types'
import { ClientDetail } from './ClientDetail'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../views/JobsTable', () => ({ JobsTable: ({ jobs, allowReorder, onLogHours, onAddTask }: { jobs: Job[]; allowReorder?: boolean; onLogHours?: (id: string) => void; onAddTask?: (id: string) => void }) => <div data-testid="client-jobs" data-reorder={String(allowReorder)} data-ids={jobs.map(job => job.id).join(',')}>{jobs.map(job => <div key={job.id}><a href={`/jobs/${job.id}`}>{job.name}</a><button onClick={() => onLogHours?.(job.id)}>Test log {job.id}</button><button onClick={() => onAddTask?.(job.id)}>Test task {job.id}</button></div>)}</div> }))
const TODAY = '2026-10-19'
const STAMP = '2026-10-19T09:00:00Z'
let container: HTMLDivElement
let root: Root
function client(overrides: Partial<Client> = {}): Client {
  return { id: 'client-a', name: 'Oak Street Builders', contact_name: 'Synthetic Contact', email: 'contact@example.test', phone: '555-0100', address: '120 Synthetic Way', notes: 'Call before a site visit.\nUse the side gate.', is_sample: true, created_at: STAMP, ...overrides }
}
function job(overrides: Partial<Job> = {}): Job {
  return { id: 'cedar', client_id: 'client-a', job_number: 'SYN-101', name: 'Cedar residence', description: '', address: '440 Maple Lane', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: TODAY, created_at: STAMP, ...overrides }
}
function phase(jobId: string, overrides: Partial<Phase> = {}): Phase {
  return { id: `phase-${jobId}`, job_id: jobId, kind: 'design', name: 'Original design', sort_order: 2, status: 'in_progress', estimate_hours: 40, start_date: null, due_date: null, assignee_id: 'legacy-owner', notes: '', ...overrides }
}
function task(jobId: string, overrides: Partial<Task> = {}): Task {
  return { id: `task-${jobId}`, job_id: jobId, phase_id: `phase-${jobId}`, title: `Next task for ${jobId}`, description: '', status: 'todo', assignee_id: null, due_date: TODAY, scheduled_at: null, is_site_visit: false, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: 'owner', created_at: STAMP, ...overrides }
}
function hours(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'hours', job_id: 'cedar', phase_id: 'phase-cedar', task_id: null, user_id: 'legacy-owner', date: TODAY, hours: 8, started_at: null, rate: 125, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP, ...overrides }
}
function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return { id: 'unpaid', job_id: 'cedar', number: 'SYN-UNPAID', amount: 800, issued_date: '2026-10-18', paid_date: null, notes: '', created_at: STAMP, ...overrides }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T12:00:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 125, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  const jobs = [job(), job({ id: 'held', name: 'Held porch', status: 'on_hold', priority: 2, due_date: null }), job({ id: 'archived', name: 'Archived addition', status: 'archived', priority: 3, due_date: '2026-10-01' }), job({ id: 'complete', name: 'Finished project', status: 'complete', priority: 4 }), job({ id: 'cancelled', name: 'Cancelled project', status: 'cancelled', priority: 5 }), job({ id: 'atlas', client_id: 'client-b', name: 'Other client project', priority: 6 })]
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 125, weekly_capacity: 40 }, profiles: [owner],
    clients: [client(), client({ id: 'client-b', name: 'Birch Development', notes: 'Second client notes' })], jobs,
    phases: jobs.map(job => phase(job.id)), tasks: [task('cedar'), task('held', { status: 'waiting', due_date: '2026-10-21' }), task('archived', { title: 'Hidden historical deadline' }), task('atlas')],
    timeEntries: [hours(), hours({ id: 'nb', hours: 2, billable: false }), hours({ id: 'archived-hours', job_id: 'archived', phase_id: 'phase-archived', hours: 30 }), hours({ id: 'other-client-hours', job_id: 'atlas', phase_id: 'phase-atlas', hours: 100 })],
    invoices: [invoice(), invoice({ id: 'paid', job_id: 'archived', number: 'SYN-PAID', amount: 1000, issued_date: '2026-10-15', paid_date: '2026-10-18' }), invoice({ id: 'zero', job_id: 'archived', number: 'SYN-ZERO', amount: 0, issued_date: TODAY }), invoice({ id: 'other-invoice', job_id: 'atlas', number: 'OTHER-CLIENT', amount: 9000 })],
    deposits: [{ id: 'deposit', job_id: 'cedar', amount: 200, received_date: TODAY, method: '', notes: '', created_at: STAMP }], items: [], comments: [], schedule: [],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null),
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
function Probe() {
  const location = useLocation(), navigate = useNavigate()
  return <div><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Test back</button><button onClick={() => navigate(1)}>Test forward</button><button onClick={() => navigate('/clients/client-b')}>Test open Birch</button></div>
}
async function render(url = '/clients/client-a') {
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/clients/:id" element={<ClientDetail />} /><Route path="*" element={<div>Another page</div>} /></Routes><Probe /></MemoryRouter>))
}
function button(label: string | RegExp, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find(button => typeof label === 'string' ? (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label : label.test(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''))
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
function field(label: string, scope: ParentNode = container): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const aria = scope.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`)
  const named = [...scope.querySelectorAll('label')].find(element => element.textContent?.trim() === label)
  const found = aria ?? named?.closest('.field')?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,select,textarea')
  if (!found) throw new Error(`Missing field ${label}`)
  return found
}
async function change(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) })
}
function query() { return new URLSearchParams(container.querySelector('[data-testid="location"]')?.textContent?.split('?')[1] ?? '') }
function location() { return container.querySelector('[data-testid="location"]')?.textContent }
function ids() { return (container.querySelector('[data-testid="client-jobs"]')?.getAttribute('data-ids') ?? '').split(',').filter(Boolean) }
function stat(label: string) {
  const found = [...container.querySelectorAll<HTMLAnchorElement>('.client-detail-stats a')].find(link => link.querySelector('.label')?.textContent?.startsWith(label))
  if (!found) throw new Error(`Missing stat ${label}`)
  return found
}
function dialog() {
  const found = container.querySelector<HTMLElement>('[role="dialog"]')
  if (!found) throw new Error('Missing dialog')
  return found
}
async function cancel() { await act(async () => button('Cancel', dialog()).click()); expect(container.querySelector('[role="dialog"]')).toBeNull() }
function noWrites() { expect(store.update).not.toHaveBeenCalled(); expect(store.insert).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }

describe('Client detail', () => {
  it('defaults to all client job history and provides real contact, timeline and workspace links', async () => {
    await render()
    expect(button('Jobs').getAttribute('aria-pressed')).toBe('true')
    expect(ids()).toEqual(['cedar', 'held', 'archived', 'complete', 'cancelled'])
    expect(container.querySelector('[data-testid="client-jobs"]')?.getAttribute('data-reorder')).toBe('false')
    expect(container.querySelector('a[href="tel:555-0100"]')).toBeTruthy()
    expect(container.querySelector('a[href="mailto:contact@example.test"]')).toBeTruthy()
    const timeline = [...container.querySelectorAll('a')].find(link => link.textContent === 'Open client timeline →')!
    expect(new URLSearchParams(timeline.getAttribute('href')!.split('?')[1]).get('status')).toBe('all')
    expect(new URLSearchParams(timeline.getAttribute('href')!.split('?')[1]).get('client')).toBe('client-a')
    expect(container.textContent).not.toContain('Hidden historical deadline')
    expect(container.textContent).not.toContain('Other client project')
    noWrites()
  })

  it('uses a weighted return and financial history including archived work and nonbillable hours', async () => {
    await render()
    expect(stat('Open jobs').querySelector('.value')?.textContent).toBe('2 / 5')
    expect(stat('Effective hourly rate').querySelector('.value')?.textContent).toBe('$50/h')
    expect(stat('Effective hourly rate').querySelector('.sub')?.textContent).toContain('$2,000 fees / 40h completed')
    expect(stat('Ready to bill').querySelector('.value')?.textContent).toBe('$4,550')
    expect(stat('Awaiting payment').querySelector('.value')?.textContent).toBe('$800')
    expect(container.querySelector('.client-history-basis')?.textContent).toContain('including archived jobs')
    await act(async () => button('Billing').click())
    const basis = container.querySelector('.client-fee-basis')!
    expect(basis.textContent).toContain('2h')
    expect(basis.textContent).toContain('$250')
    expect(basis.textContent).toContain('Includes unused deposits; before overhead and tax')
    expect(container.querySelector('.client-billing-jobs')?.textContent).toContain('Archived addition')
  })

  it('restores status/search/focus from the URL and clears filters without losing the client', async () => {
    await render('/clients/client-a?status=open&focus=waiting&q=Held')
    expect(ids()).toEqual(['held'])
    expect((field('Job status') as HTMLSelectElement).value).toBe('open')
    expect((field('Job focus') as HTMLSelectElement).value).toBe('waiting')
    await act(async () => button('Clear job filters').click())
    expect(ids()).toHaveLength(5)
    expect(query().size).toBe(0)
    expect(stat('Ready to bill').querySelector('.value')?.textContent).toBe('$4,550')
    noWrites()
  })

  it('accepts spaces while searching and distinguishes no results from a client with no jobs', async () => {
    await render()
    await change(field('Search client jobs'), 'Cedar ')
    expect((field('Search client jobs') as HTMLInputElement).value).toBe('Cedar ')
    expect(query().get('q')).toBe('Cedar ')
    await change(field('Search client jobs'), 'no matching project')
    expect(container.querySelector('.client-empty-message')?.textContent).toContain('No jobs match these filters')
    await act(async () => button('Clear job filters').click())
    store = { ...store, jobs: store.jobs.filter(job => job.client_id !== 'client-a') }
    await render()
    expect(container.querySelector('.client-empty-message')?.textContent).toContain('No jobs yet')
    noWrites()
  })

  it('round-trips sections through browser history and omits the default Jobs tab', async () => {
    await render('/clients/client-a?tab=unknown')
    expect(button('Jobs').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Billing').click())
    expect(query().get('tab')).toBe('billing')
    await act(async () => button('Details').click())
    expect(query().get('tab')).toBe('details')
    expect(container.querySelector('.client-details-card')?.textContent).toContain('Use the side gate')
    await act(async () => button('Test back').click())
    expect(button('Billing').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Test forward').click())
    expect(button('Details').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Jobs').click())
    expect(query().has('tab')).toBe(false)
    noWrites()
  })

  it('replaces search history while keeping deliberate section navigation in Back', async () => {
    await render()
    await act(async () => button('Details').click())
    await act(async () => button('Jobs').click())
    await change(field('Search client jobs'), 'Cedar')
    await change(field('Search client jobs'), 'Cedar residence')
    await act(async () => button('Test back').click())
    expect(button('Details').getAttribute('aria-pressed')).toBe('true')
    expect(query().get('tab')).toBe('details')
    noWrites()
  })

  it('shows only positive unpaid invoices by default and preserves all invoice history on demand', async () => {
    await render('/clients/client-a?tab=billing')
    expect(container.querySelector('.client-invoice-table')?.textContent).toContain('SYN-UNPAID')
    expect(container.querySelector('.client-invoice-table')?.textContent).not.toContain('SYN-PAID')
    expect(container.querySelector('.client-invoice-table')?.textContent).not.toContain('SYN-ZERO')
    expect(container.textContent).not.toContain('OTHER-CLIENT')
    expect(container.querySelector('.client-invoice-table')?.textContent).toContain('Issued 1d ago')
    expect(container.querySelector('.client-invoice-table')?.textContent).not.toContain('overdue')
    await change(field('Invoice status'), 'all')
    const invoiceLinks = [...container.querySelectorAll('.client-invoice-table tbody tr')].map(row => row.querySelector('a')?.textContent)
    expect(invoiceLinks).toEqual(['SYN-ZERO', 'SYN-UNPAID', 'SYN-PAID'])
    expect(container.querySelector('.client-invoice-table')?.textContent).toContain('No payment due')
    expect(container.querySelector('a[href="/billing?job=archived"]')).toBeTruthy()
    expect(container.querySelector('.client-invoice-table a[href="/jobs/archived"]')).toBeTruthy()
    await change(field('Invoice status'), 'paid')
    expect(container.querySelectorAll('.client-invoice-table tbody tr')).toHaveLength(1)
    expect(container.querySelector('.client-invoice-table')?.textContent).toContain('Paid Oct 18')
    noWrites()
  })

  it('shows useful invoice empty states without hiding zero-value history', async () => {
    store.invoices = [invoice({ number: 'ZERO-ONLY', amount: 0 })]
    await render('/clients/client-a?tab=billing')
    expect(container.textContent).toContain('No unpaid invoices awaiting payment')
    await change(field('Invoice status'), 'all')
    expect(container.querySelector('.client-invoice-table')?.textContent).toContain('ZERO-ONLY')
    expect(container.querySelector('.client-invoice-table')?.textContent).toContain('No payment due')
  })

  it('opens new job and client editing forms on the right client and cancels without writes', async () => {
    await render()
    await act(async () => button('New job').click())
    expect(dialog().querySelector('select')?.value).toBe('client-a')
    await cancel()
    await act(async () => button('Edit client').click())
    expect(field('Client / company name', dialog()).value).toBe('Oak Street Builders')
    await change(field('Client / company name', dialog()), 'Discard this draft')
    await cancel()
    noWrites()
  })

  it('passes the selected job and current work phase into task and hour forms', async () => {
    await render()
    for (const label of ['Test log cedar', 'Test task cedar']) {
      await act(async () => button(label).click())
      expect(dialog().querySelectorAll('select')[0].value).toBe('cedar')
      expect(dialog().querySelectorAll('select')[1].value).toBe('phase-cedar')
      await cancel()
    }
    noWrites()
  })

  it('navigates to the newly created job', async () => {
    store.insert = vi.fn(async () => job({ id: 'new-job', name: 'New synthetic job' })) as Store['insert']
    await render()
    await act(async () => button('New job').click())
    await change(field('Job name', dialog()), 'New synthetic job')
    await act(async () => button('Create job', dialog()).click())
    expect(store.insert).toHaveBeenCalledWith('jobs', expect.objectContaining({ client_id: 'client-a', name: 'New synthetic job' }))
    expect(location()).toBe('/jobs/new-job')
  })

  it('resets open client drafts and forms when navigating to another client', async () => {
    await render()
    await act(async () => button('Edit client').click())
    await change(field('Client / company name', dialog()), 'Do not carry this draft')
    await act(async () => button('Test open Birch').click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => button('Edit client').click())
    expect(field('Client / company name', dialog()).value).toBe('Birch Development')
    await cancel()
    await act(async () => button('New job').click())
    expect(dialog().querySelector('select')?.value).toBe('client-b')
    await cancel()
    noWrites()
  })

  it('retains the client edit draft through optimistic deletion until success is confirmed', async () => {
    vi.stubGlobal('confirm', () => true)
    let resolve!: (value: boolean) => void
    store.remove = vi.fn(() => { store = { ...store, clients: store.clients.filter(client => client.id !== 'client-a') }; return new Promise<boolean>(done => { resolve = done }) })
    await render()
    await act(async () => button('Edit client').click())
    await change(field('Client / company name', dialog()), 'Keep this pending draft')
    await act(async () => button(/^Delete/, dialog()).click())
    await render()
    expect(location()).toBe('/clients/client-a')
    expect(field('Client / company name', dialog()).value).toBe('Keep this pending draft')
    await act(async () => { resolve(false) })
    store = { ...store, clients: [client(), ...store.clients] }
    await render()
    expect(location()).toBe('/clients/client-a')
    expect(field('Client / company name', dialog()).value).toBe('Keep this pending draft')
  })

  it('leaves for Clients only after confirmed deletion', async () => {
    vi.stubGlobal('confirm', () => true)
    let resolve!: (value: boolean) => void
    store.remove = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    await render(); await act(async () => button('Edit client').click()); await act(async () => button(/^Delete/, dialog()).click())
    expect(location()).toBe('/clients/client-a')
    await act(async () => { resolve(true) })
    expect(location()).toBe('/clients')
  })

  it('provides a missing-client fallback and contact guidance without navigation or writes', async () => {
    await render('/clients/missing')
    expect(container.textContent).toContain('Client not found')
    expect(container.querySelector('a[href="/clients"]')).toBeTruthy()
    expect(location()).toBe('/clients/missing')
    noWrites()
  })

  it('offers contact guidance and a useful empty notes state', async () => {
    store.clients[0] = client({ email: '', phone: '', notes: '' })
    await render()
    expect(container.querySelector('.client-contact-card')?.textContent).toContain('No phone or email saved')
    await act(async () => button('Details').click())
    expect(container.querySelector('.client-details-card')?.textContent).toContain('No client notes yet')
    expect(container.querySelector('.client-details-card')?.textContent).toContain('Not set')
    noWrites()
  })

  it('refreshes date context when returning to a long-open client page', async () => {
    store.tasks = []
    store.jobs[0].due_date = '2026-10-20'
    await render()
    expect(container.querySelector('.client-detail-aside')?.textContent).toContain('Due tomorrow')
    vi.setSystemTime(new Date('2026-10-20T08:00:00'))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(container.querySelector('.client-detail-aside')?.textContent).toContain('Due today')
    noWrites()
  })
})
