// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Invoice, Job, TimeEntry } from '../lib/types'
import { downloadCSV } from '../lib/utils'
import { Billing } from './Billing'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/planningStore', () => ({ usePlanning: () => ({ followUps: [], loading: false, error: null }) }))
vi.mock('../lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('../lib/utils')>(), downloadCSV: vi.fn() }))
vi.mock('../components/MoneyCharts', async importOriginal => ({ ...await importOriginal<typeof import('../components/MoneyCharts')>(), BalanceChart: () => <div>Balance chart</div> }))
const TODAY = '2026-10-19'
const STAMP = `${TODAY}T09:00:00Z`
let root: Root, container: HTMLDivElement
function job(patch: Partial<Job> = {}): Job {
  return { id: 'alpha', client_id: 'client', job_number: '26-101', name: 'Maple residence', description: '', address: 'Ocean Road', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: STAMP, ...patch }
}
function time(patch: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'hours', job_id: 'alpha', phase_id: 'design', task_id: null, user_id: 'legacy', date: TODAY, hours: 1, started_at: null, rate: 100, notes: 'Design work', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP, ...patch }
}
function invoice(patch: Partial<Invoice> = {}): Invoice {
  return { id: 'invoice', job_id: 'closed', number: 'INV-CLOSED', amount: 250, issued_date: TODAY, paid_date: null, notes: '', created_at: STAMP, ...patch }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${TODAY}T23:30:00`))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 150, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 150, weekly_capacity: 40 }, profiles: [owner],
    clients: [{ id: 'client', name: 'Cedar Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: STAMP }, { id: 'other', name: 'Other Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: STAMP }],
    jobs: [job(), job({ id: 'beta', client_id: 'other', name: 'Oak addition' }), job({ id: 'closed', name: 'Completed cottage', status: 'complete' }), job({ id: 'archived', name: 'Archived garage', status: 'archived' })],
    phases: [{ id: 'design', job_id: 'alpha', kind: 'design', name: 'Design', status: 'in_progress', sort_order: 2, estimate_hours: 10, start_date: null, due_date: null, assignee_id: null, notes: '' }], tasks: [],
    timeEntries: [time(), time({ id: 'nb', hours: 2, billable: false, notes: 'Internal rework' }), time({ id: 'running', hours: null, started_at: new Date(`${TODAY}T22:30:00`).toISOString(), notes: 'Running work' }), time({ id: 'beta-time', job_id: 'beta', hours: 2, notes: 'Oak work' })],
    items: [{ id: 'charge', job_id: 'alpha', date: TODAY, category: 'Expense', description: 'Travel charge', quantity: 1, unit_price: 30, billed: false, invoice_id: null, deposit_applied: null, created_by: 'owner', created_at: STAMP }],
    invoices: [invoice(), invoice({ id: 'old', job_id: 'archived', number: 'INV-ARCHIVED', amount: 900 }), invoice({ id: 'zero', number: 'INV-ZERO', amount: 0 })],
    deposits: [{ id: 'deposit', job_id: 'alpha', amount: 50, received_date: TODAY, method: 'Check', notes: 'Retainer', created_at: STAMP }],
    comments: [], schedule: [], loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null),
  }
  vi.mocked(downloadCSV).mockClear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
function Probe() {
  const location = useLocation(), navigate = useNavigate()
  return <div><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Test back</button><button onClick={() => navigate(1)}>Test forward</button><button onClick={() => navigate('/billing?job=beta')}>Test open beta</button></div>
}
async function render(url = '/billing') { await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/billing" element={<Billing />} /><Route path="*" element={<div>Other page</div>} /></Routes><Probe /></MemoryRouter>)) }
function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label)
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
function field(label: string, scope: ParentNode = container): HTMLInputElement | HTMLSelectElement {
  const found = [...scope.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].find(input => input.getAttribute('aria-label') === label || [...input.labels ?? []].some(element => element.textContent?.trim() === label))
  if (!found) throw new Error(`Missing field ${label}`)
  return found
}
async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) })
}
function dialog() { const modal = container.querySelector<HTMLElement>('[role="dialog"]'); if (!modal) throw new Error('Missing dialog'); return modal }
function query() { return new URLSearchParams(container.querySelector('[data-testid="location"]')?.textContent?.split('?')[1] ?? '') }
function stat(label: string) { return [...container.querySelectorAll('.billing-stats .stat')].find(stat => stat.querySelector('.label')?.textContent === label)!.querySelector('.value')!.textContent }
function noWrites() { expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled(); expect(store.recordInvoice).not.toHaveBeenCalled() }

describe('Billing overview', () => {
  it('keeps collection actions within the matched jobs and positive unpaid invoice filters', async () => {
    await render('/billing?tab=invoices&payment=all')
    const panel = () => container.querySelector('.billing-follow-ups')!
    expect(panel().textContent).toContain('INV-CLOSED')
    expect(panel().textContent).not.toContain('INV-ARCHIVED')
    expect(panel().textContent).not.toContain('INV-ZERO')
    await change(field('Search billing jobs'), 'Maple')
    expect(panel().querySelectorAll('.billing-collection-row')).toHaveLength(0)
    expect(stat('Awaiting payment')).toBe('$0')
    noWrites()
  })
  it.each(['/billing?tab=hours', '/billing?job=alpha&work=all'])('shows and searches retained planning hours under their history label at %s', async url => {
    store.phases[0] = { ...store.phases[0], kind: 'queued', name: 'Retired custom queue label' }
    await render(url)
    expect(container.textContent).toContain('Planning history')
    expect(container.textContent).not.toContain('Retired custom queue label')
    const overview = !url.includes('job=')
    await change(field(overview ? 'Search billing list' : 'Search job billing work'), 'Planning history')
    expect(container.querySelectorAll(overview ? '.billing-hour-row' : '.billing-work-row')).toHaveLength(2)
    if (overview) {
      await act(async () => button('Export visible CSV').click())
      expect(vi.mocked(downloadCSV).mock.calls[0][2].every(row => row[3] === 'Planning history')).toBe(true)
    }
    expect(store.phases[0].name).toBe('Retired custom queue label')
    noWrites()
  })
  it('includes completed obligations but excludes archived records by default with reachable links', async () => {
    await render()
    expect(stat('Ready to bill')).toBe('$280')
    expect(stat('Awaiting payment')).toBe('$250')
    expect(container.querySelector('a[href="/billing?job=closed"]')).toBeTruthy()
    expect(container.querySelector('a[href="/billing?job=archived"]')).toBeNull()
    noWrites()
  })
  it('restores malformed defaults and URL-driven filters including browser back and forward', async () => {
    await render('/billing?tab=unknown&status=invalid&keep=yes')
    expect(button('Jobs').getAttribute('aria-pressed')).toBe('true')
    await change(field('Search billing jobs'), ' Cedar  Maple ')
    expect(query().get('q')).toBe(' Cedar  Maple ')
    expect(query().get('keep')).toBe('yes')
    expect(stat('Ready to bill')).toBe('$80')
    await act(async () => button('Invoices').click())
    expect(query().get('tab')).toBe('invoices')
    await act(async () => button('Test back').click())
    expect(button('Jobs').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Test forward').click())
    expect(button('Invoices').getAttribute('aria-pressed')).toBe('true')
    noWrites()
  })
  it('makes unavailable URL client/job selections explicit rather than displaying All', async () => {
    await render('/billing?client=missing&scope=missing-job')
    expect(field('Billing client').value).toBe('missing')
    expect(field('Billing client').textContent).toContain('Unavailable client')
    expect(field('Billing job filter').value).toBe('missing-job')
    expect(field('Billing job filter').textContent).toContain('outside these filters')
    expect(stat('Ready to bill')).toBe('$0')
  })
  it('scopes all invoice rows and totals to shared filters and labels zero invoices honestly', async () => {
    await render('/billing?tab=invoices&payment=all')
    expect(container.querySelector('.billing-invoices')?.textContent).toContain('INV-CLOSED')
    expect(container.querySelector('.billing-invoices')?.textContent).not.toContain('INV-ARCHIVED')
    expect(container.querySelector('.billing-invoices')?.textContent).toContain('No payment due')
    await change(field('Billing job status'), 'all')
    expect(container.querySelector('.billing-invoices')?.textContent).toContain('INV-ARCHIVED')
    await change(field('Search billing list'), 'INV-CLOSED')
    expect(container.querySelectorAll('.billing-invoice-row')).toHaveLength(1)
    await act(async () => button('Export visible CSV').click())
    expect(vi.mocked(downloadCSV).mock.calls[0][2]).toHaveLength(1)
    expect(vi.mocked(downloadCSV).mock.calls[0][2][0][0]).toBe('INV-CLOSED')
    noWrites()
  })
  it('shows paid deposit portions separately from billed remainders and exports matching amounts', async () => {
    store.timeEntries = [time({ billed: true, invoice_id: 'invoice', deposit_applied: 40 })]
    store.invoices = [invoice({ job_id: 'alpha', amount: 60 })]
    await render('/billing?tab=hours&work=paid')
    expect(container.querySelector('.billing-hour-row > b')?.textContent).toBe('$40')
    await act(async () => button('Export visible CSV').click())
    expect(vi.mocked(downloadCSV).mock.calls[0][2][0][7]).toBe(40)
    await change(field('Work status'), 'billed')
    expect(container.querySelector('.billing-hour-row > b')?.textContent).toBe('$60')
    noWrites()
  })
  it('uses a local paid date and a synchronous busy guard with success feedback', async () => {
    let resolve!: (value: boolean) => void
    vi.mocked(store.update).mockImplementation(() => new Promise(done => { resolve = done }))
    await render('/billing?tab=invoices')
    const paid = button('Mark invoice INV-CLOSED paid')
    await act(async () => { paid.click(); paid.click() })
    expect(store.update).toHaveBeenCalledExactlyOnceWith('invoices', 'invoice', { paid_date: TODAY })
    expect(paid.disabled).toBe(true)
    expect(store.toast).not.toHaveBeenCalled()
    await act(async () => resolve(true))
    expect(store.toast).toHaveBeenCalledWith('Invoice INV-CLOSED marked paid')
  })
  it('refreshes and reports failed payment changes without claiming success', async () => {
    vi.mocked(store.update).mockResolvedValue(false)
    await render('/billing?tab=invoices')
    await act(async () => button('Mark invoice INV-CLOSED paid').click())
    expect(store.refresh).toHaveBeenCalledWith('invoices')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not saved')
    expect(store.toast).not.toHaveBeenCalled()
  })
})

describe('job money and invoice selection', () => {
  it('opens archived job deep links and shows its history regardless of overview filters', async () => {
    await render('/billing?job=archived&section=invoices&status=open&client=other')
    expect(container.querySelector('h1')?.textContent).toBe('Archived garage')
    expect(container.querySelector('.billing-invoices')?.textContent).toContain('INV-ARCHIVED')
    expect(stat('Awaiting payment')).toBe('$900')
    noWrites()
  })
  it('invoices mixed completed work after deposits, retaining selection on cancel and failed saves', async () => {
    await render('/billing?job=alpha')
    expect(container.querySelectorAll('.billing-work-row')).toHaveLength(2)
    await act(async () => button('Select visible ready work').click())
    expect(container.querySelector('.billing-selection')?.textContent).toContain('2 selected · $80 to invoice')
    await act(async () => button('Invoice selected').click())
    expect(field('Amount ($)', dialog()).value).toBe('80')
    await act(async () => button('Cancel', dialog()).click())
    expect(container.querySelector('.billing-selection')?.textContent).toContain('2 selected')
    await act(async () => button('Invoice selected').click())
    await act(async () => button('Save', dialog()).click())
    expect(store.recordInvoice).toHaveBeenCalledWith(expect.objectContaining({ job_id: 'alpha', amount: 80 }), expect.arrayContaining([
      { table: 'time_entries', id: 'hours', amount: 100, depositApplied: 50 }, { table: 'job_items', id: 'charge', amount: 30, depositApplied: 0 },
    ]))
    expect(store.recordInvoice).toHaveBeenCalledTimes(1)
    expect(dialog().querySelector('[role="alert"]')).toBeTruthy()
    expect(container.querySelector('.billing-selection')?.textContent).toContain('2 selected')
  })
  it('never selects nonbillable or running time, while showing nonbillable work value once in overview', async () => {
    await render('/billing?job=alpha&work=all')
    expect(container.querySelectorAll('.billing-work-row')).toHaveLength(3)
    expect(container.querySelector('input[aria-label="Select hours: Internal rework"]')).toBeNull()
    expect(container.textContent).not.toContain('Running work')
    await act(async () => button('Select all ready work on job').click())
    expect(container.querySelector('.billing-selection')?.textContent).toContain('2 selected · $80')
    await act(async () => button('Overview').click())
    expect(container.textContent).toContain('Nonbillable time value: $200')
    expect(container.textContent).toContain('3h completed · 1h billable · 2h nonbillable')
    noWrites()
  })
  it('explains hidden selections and can clear just those hidden by search', async () => {
    await render('/billing?job=alpha')
    await act(async () => button('Select all ready work on job').click())
    await change(field('Search job billing work'), 'Design')
    expect(container.querySelector('.billing-selection [role="status"]')?.textContent).toContain('1 selected row is hidden')
    await act(async () => button('Clear hidden selection').click())
    expect(container.querySelector('.billing-selection')?.textContent).toContain('1 selected · $50')
    await act(async () => button('Invoice selected').click())
    await act(async () => button('Save', dialog()).click())
    expect(store.recordInvoice).toHaveBeenCalledWith(expect.anything(), [{ table: 'time_entries', id: 'hours', amount: 100, depositApplied: 50 }])
  })
  it('invalidates changed selections on realtime updates and resets them on another job route', async () => {
    await render('/billing?job=alpha')
    await act(async () => button('Select all ready work on job').click())
    store = { ...store, timeEntries: store.timeEntries.map(entry => entry.id === 'hours' ? { ...entry, billable: false } : entry), items: [] }
    await render()
    expect(container.querySelector('.billing-selection')?.textContent).toContain('0 selected')
    expect(button('Invoice selected').disabled).toBe(true)
    await act(async () => button('Test open beta').click())
    expect(container.querySelector('h1')?.textContent).toBe('Oak addition')
    expect(container.querySelector('.billing-selection')?.textContent).toContain('0 selected')
    noWrites()
  })
  it('guards unbill/save actions, clears the whole billing link, and retains error feedback after failure', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolve!: (value: boolean) => void
    vi.mocked(store.update).mockImplementation(() => new Promise(done => { resolve = done }))
    store.timeEntries = [time({ billed: true, invoice_id: 'invoice', deposit_applied: 40 })]
    store.invoices = [invoice({ job_id: 'alpha', amount: 60 })]
    await render('/billing?job=alpha&work=all')
    const unbill = button('Unbill hours: Design work')
    await act(async () => { unbill.click(); unbill.click() })
    expect(confirm).toHaveBeenCalledOnce()
    expect(store.update).toHaveBeenCalledExactlyOnceWith('time_entries', 'hours', { billed: false, invoice_id: null, deposit_applied: null })
    expect(button('Edit hours: Design work').disabled).toBe(true)
    await act(async () => resolve(false))
    expect(store.refresh).toHaveBeenCalledWith('time_entries')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not saved')
    expect(store.toast).not.toHaveBeenCalled()
    expect(button('Edit hours: Design work').disabled).toBe(false)
  })
  it('retains the invoice editor snapshot through an optimistic deletion and allows historical deposit context', async () => {
    await render('/billing?job=archived&section=invoices')
    await act(async () => button('Edit invoice INV-ARCHIVED').click())
    store = { ...store, invoices: [] }
    await render()
    expect(field('Invoice #', dialog()).value).toBe('INV-ARCHIVED')
    await act(async () => button('Cancel', dialog()).click())
    await act(async () => button('Record deposit').click())
    expect(field('Job', dialog()).value).toBe('archived')
    noWrites()
  })
})
