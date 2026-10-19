// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Client, Job, Phase, TimeEntry } from '../lib/types'
import { downloadCSV } from '../lib/utils'
import { ClientModal } from '../components/editors'
import { Clients } from './Clients'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('../lib/utils')>(), downloadCSV: vi.fn() }))

const TODAY = '2026-10-19'
const STAMP = `${TODAY}T09:00:00-07:00`
let container: HTMLDivElement
let root: Root
function client(id: string, name: string, overrides: Partial<Client> = {}): Client {
  return { id, name, contact_name: `${name} Contact`, email: `${id}@example.test`, phone: '555-0101', address: '440 Maple Lane', notes: '', is_sample: false, created_at: STAMP, ...overrides }
}
function job(id: string, clientId: string, overrides: Partial<Job> = {}): Job {
  return { id, client_id: clientId, job_number: `SYN-${id}`, name: `${id} project`, description: '', address: '', status: 'active', priority: 1, fee: 5000, queued_date: null, start_date: null, due_date: null, created_at: STAMP, ...overrides }
}
function phase(jobId: string): Phase {
  return { id: `phase-${jobId}`, job_id: jobId, kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 8, start_date: null, due_date: null, assignee_id: null, notes: '' }
}
function hours(id: string, jobId: string, amount: number, overrides: Partial<TimeEntry> = {}): TimeEntry {
  return { id, job_id: jobId, phase_id: `phase-${jobId}`, task_id: null, user_id: 'owner', date: TODAY, hours: amount, started_at: null, rate: 100, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP, ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 100, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  const jobs = [job('cedar', 'client-a', { name: 'Cedar residence', due_date: TODAY }), job('held', 'client-a', { status: 'on_hold' }), job('archived', 'client-a', { status: 'archived' }), job('atlas', 'client-b', { name: 'Atlas duplex', due_date: '2026-10-22' }), job('finished', 'client-d', { name: 'Historic building', status: 'complete' })]
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 100, weekly_capacity: 40 }, profiles: [owner],
    clients: [client('client-a', 'Cedar Builders', { contact_name: 'Ada Synthetic' }), client('client-b', 'Atlas Development', { contact_name: 'Ben Synthetic', phone: '555-0102', address: '20 Oak Street' }), client('client-c', 'Dormant client', { contact_name: '', email: '', phone: '', address: '' }), client('client-d', 'Historic client', { contact_name: 'Pat Synthetic', address: '80 Birch Road' })],
    jobs, phases: jobs.map(job => phase(job.id)), tasks: [],
    timeEntries: [hours('cedar-hours', 'cedar', 6), hours('archived-hours', 'archived', 2), hours('atlas-hours', 'atlas', 2, { billed: true, invoice_id: 'atlas-invoice', deposit_applied: 0 })],
    invoices: [{ id: 'atlas-invoice', job_id: 'atlas', number: 'SYN-INV-1', amount: 200, issued_date: TODAY, paid_date: null, notes: '', created_at: STAMP }],
    deposits: [], items: [{ id: 'historic-charge', job_id: 'finished', date: TODAY, category: 'Printing', description: 'Historic charge', quantity: 1, unit_price: 50, billed: false, invoice_id: null, deposit_applied: null, created_by: 'owner', created_at: STAMP }], comments: [], schedule: [],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null),
  }
  vi.mocked(downloadCSV).mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function LocationProbe() {
  const location = useLocation(), navigate = useNavigate()
  return <div><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Test go back</button><button onClick={() => navigate(1)}>Test go forward</button></div>
}
async function render(url = '/clients') {
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/clients" element={<Clients />} /><Route path="*" element={<div>Destination page</div>} /></Routes><LocationProbe /></MemoryRouter>))
}
function button(label: string | RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(button => {
    const name = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''
    return typeof label === 'string' ? name === label : label.test(name)
  })
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
function field(label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const labelled = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')].find(input => input.getAttribute('aria-label') === label || [...input.labels ?? []].some(element => element.textContent?.trim() === label))
  if (!labelled) throw new Error(`Missing field ${label}`)
  return labelled
}
async function change(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function query(): URLSearchParams {
  return new URLSearchParams((container.querySelector('[data-testid="location"]')?.textContent ?? '').split('?')[1] ?? '')
}
function clientIds(): string[] {
  return [...new Set([...container.querySelectorAll<HTMLAnchorElement>('a')].map(link => link.getAttribute('href')).filter(href => /^\/clients\/[^/?]+$/.test(href ?? '')).map(href => href!.slice('/clients/'.length)))]
}
function noWrites() { expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }
function dialog(): HTMLElement {
  const modal = container.querySelector<HTMLElement>('[role="dialog"]')
  if (!modal) throw new Error('Missing dialog')
  return modal
}
async function cancel() {
  const button = [...dialog().querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel')!
  await act(async () => button.click())
  expect(container.querySelector('[role="dialog"]')).toBeNull()
}

describe('Clients page', () => {
  it('shows all clients with real links and contact actions by default', async () => {
    await render()
    expect(clientIds().sort()).toEqual(['client-a', 'client-b', 'client-c', 'client-d'])
    expect(container.querySelector('a[href="mailto:client-a@example.test"]')).toBeTruthy()
    expect(container.querySelector('a[href="tel:555-0101"]')).toBeTruthy()
    noWrites()
  })

  it('falls back from unrecognized URL filters and preserves unrelated URL parameters', async () => {
    await render('/clients?focus=unknown&sort=unknown&dir=sideways&keep=yes')
    expect((field('Show clients') as HTMLSelectElement).value).toBe('all')
    expect((field('Sort clients') as HTMLSelectElement).value).toBe('name')
    expect(clientIds()).toHaveLength(4)
    await change(field('Search clients'), 'Cedar')
    expect(query().get('keep')).toBe('yes')
    noWrites()
  })

  it('restores shared URL search, focus, and sorting', async () => {
    await render('/clients?q=cedar&focus=unbilled&sort=unbilled&dir=desc')
    expect(field('Search clients').value).toBe('cedar')
    expect(field('Show clients').value).toBe('unbilled')
    expect(field('Sort clients').value).toBe('unbilled')
    expect(clientIds()).toEqual(['client-a'])
    expect(query().get('dir')).toBe('desc')
    noWrites()
  })

  it('preserves raw search spacing while matching contact information and historical jobs', async () => {
    await render()
    for (const [term, expected] of [['  cedar   builders  ', ['client-a']], ['BEN synthetic', ['client-b']], ['client-b@example.test', ['client-b']], ['555-0102', ['client-b']], ['Oak Street', ['client-b']], ['Historic building', ['client-d']], ['archived project', ['client-a']], ['   ', ['client-a', 'client-b', 'client-c', 'client-d']]] as const) {
      await change(field('Search clients'), term)
      expect(clientIds().sort()).toEqual([...expected])
      if (term.trim()) expect(query().get('q')).toBe(term)
    }
    noWrites()
  })

  it('round-trips focus filters through browser back and forward navigation', async () => {
    await render('/clients?q=client&keep=yes')
    await change(field('Show clients'), 'no_open')
    expect(clientIds().sort()).toEqual(['client-c', 'client-d'])
    await change(field('Show clients'), 'missing_contact')
    expect(clientIds()).toEqual(['client-c'])
    await act(async () => button('Test go back').click())
    expect(field('Show clients').value).toBe('no_open')
    expect(clientIds().sort()).toEqual(['client-c', 'client-d'])
    await act(async () => button('Test go forward').click())
    expect(field('Show clients').value).toBe('missing_contact')
    expect(query().get('keep')).toBe('yes')
    noWrites()
  })

  it('drills summary filters while keeping their counts and amounts based on the search scope', async () => {
    await render()
    expect(button(/^Clients in view/).textContent).toContain('4')
    await act(async () => button(/^With open jobs/).click())
    expect(clientIds().sort()).toEqual(['client-a', 'client-b'])
    expect(button(/^Clients in view/).textContent).toContain('4')
    await act(async () => button(/^Ready to bill/).click())
    expect(clientIds().sort()).toEqual(['client-a', 'client-d'])
    expect(query().get('focus')).toBe('unbilled')
    expect(button(/^Ready to bill/).textContent).toContain('$850')
    await act(async () => button(/^Awaiting payment/).click())
    expect(clientIds()).toEqual(['client-b'])
    expect(button(/^Clients in view/).textContent).toContain('4')
    expect(button(/^Awaiting payment/).textContent).toContain('$200')
    noWrites()
  })

  it('shows a reset for no matching clients without calling the business empty', async () => {
    await render('/clients?q=no-such-client&focus=open&sort=unbilled&dir=desc')
    expect(container.textContent).toMatch(/No clients match/i)
    expect(container.textContent).not.toMatch(/No clients yet/i)
    await act(async () => button('Reset filters').click())
    expect(clientIds()).toHaveLength(4)
    expect(field('Search clients').value).toBe('')
    expect(field('Show clients').value).toBe('all')
    noWrites()
  })

  it('sorts by the selected metric and direction without changing the filtered scope', async () => {
    await render('/clients?sort=unbilled&dir=desc')
    expect(clientIds()[0]).toBe('client-a')
    expect(clientIds()[1]).toBe('client-d')
    await change(field('Sort clients'), 'name')
    expect(clientIds()[0]).toBe('client-b')
    await act(async () => button('Sort direction').click())
    expect(clientIds()).toEqual(['client-d', 'client-c', 'client-a', 'client-b'])
    expect(query().get('dir')).toBe('desc')
    await change(field('Show clients'), 'open')
    await change(field('Sort clients'), 'due')
    expect(clientIds()).toEqual(['client-a', 'client-b'])
    noWrites()
  })

  it('exports only the visible rows with historical money included and cents retained', async () => {
    store.timeEntries[1] = { ...store.timeEntries[1], rate: 100.25 }
    await render('/clients?q=cedar&focus=unbilled')
    await act(async () => button('Export CSV').click())
    expect(downloadCSV).toHaveBeenCalledTimes(1)
    const [filename, headers, rows] = vi.mocked(downloadCSV).mock.calls[0]
    expect(filename).toBe('clients.csv')
    expect(headers).toContain('Client')
    expect(rows).toHaveLength(1)
    expect(rows[0][0]).toBe('Cedar Builders')
    expect(rows[0]).toContain(800.5)
    noWrites()
  })

  it('neutralizes spreadsheet formulas in exported contact text while retaining numeric money', async () => {
    store.clients.push(client('formula', '=SUM(1,2)', { contact_name: '+123', email: '@example.test', phone: '-123' }))
    await render('/clients?q=SUM')
    await act(async () => button('Export CSV').click())
    const rows = vi.mocked(downloadCSV).mock.calls[0][2]
    expect(rows).toHaveLength(1)
    expect(rows[0][0]).toBe("'=SUM(1,2)")
    expect(rows[0]).toContain("'+123")
    expect(rows[0]).toContain("'@example.test")
    expect(rows[0]).toContain("'-123")
    expect(rows[0].some(value => typeof value === 'number')).toBe(true)
    noWrites()
  })

  it('opens scoped new-job and client-edit forms without changing records on cancel', async () => {
    await render()
    await act(async () => button('New job for Cedar Builders').click())
    expect(dialog().querySelector('h2')?.textContent).toBe('New job')
    expect(dialog().querySelector('select')?.value).toBe('client-a')
    await cancel()
    await act(async () => button('Edit client: Cedar Builders').click())
    expect(dialog().querySelector('h2')?.textContent).toBe('Edit client')
    expect(dialog().querySelector<HTMLInputElement>('input')?.value).toBe('Cedar Builders')
    await cancel()
    noWrites()
  })

  it('creates a job for the chosen client and opens the created job', async () => {
    store.jobs = store.jobs.map(job => job.id === 'held' ? { ...job, priority: 10 } : job)
    vi.mocked(store.insert).mockResolvedValue(job('created-job', 'client-a', { name: 'Synthetic addition', priority: 11 }))
    await render()
    await act(async () => button('New job for Cedar Builders').click())
    await change(dialog().querySelector<HTMLInputElement>('input[placeholder="e.g. Smith Residence — Addition"]')!, 'Synthetic addition')
    await act(async () => button('Create job').click())
    expect(store.insert).toHaveBeenCalledWith('jobs', expect.objectContaining({ name: 'Synthetic addition', client_id: 'client-a', priority: 11 }))
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/jobs/created-job')
  })

  it('guards repeated new-job submits and retains the scoped draft after failure', async () => {
    let resolveInsert!: (value: null) => void
    vi.mocked(store.insert).mockImplementation(() => new Promise(resolve => { resolveInsert = resolve }))
    await render()
    await act(async () => button('New job for Cedar Builders').click())
    const name = dialog().querySelector<HTMLInputElement>('input[placeholder="e.g. Smith Residence — Addition"]')!
    await change(name, 'Unsaved synthetic job')
    const create = button('Create job')
    await act(async () => { create.click(); create.click() })
    expect(store.insert).toHaveBeenCalledTimes(1)
    expect(create.disabled).toBe(true)
    expect([...dialog().querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel')?.disabled).toBe(true)
    await act(async () => resolveInsert(null))
    expect(dialog()).toBeTruthy()
    expect(name.value).toBe('Unsaved synthetic job')
    expect(dialog().querySelector('select')?.value).toBe('client-a')
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/clients')
  })

  it('keeps a first-client action available when the business is empty', async () => {
    store.clients = []; store.jobs = []; store.phases = []; store.timeEntries = []; store.items = []; store.invoices = []
    await render()
    expect(container.querySelector('h1')?.textContent).toBe('Clients')
    expect(container.textContent).toMatch(/first client|No clients yet/i)
    expect(button('New client')).toBeTruthy()
    await act(async () => button('New client').click())
    expect(dialog().querySelector('h2')?.textContent).toBe('New client')
    await cancel()
    noWrites()
  })
})

describe('Client editor from Clients', () => {
  it('keeps the typed draft and form open after a failed save', async () => {
    vi.mocked(store.insert).mockResolvedValue(null)
    await render()
    await act(async () => button('New client').click())
    await change(field('Client / company name'), '  Synthetic new client  ')
    await change(field('Contact person'), '  Ada Example  ')
    await change(field('Address'), '  12 Test Lane  ')
    await act(async () => button('Add client').click())
    expect(store.insert).toHaveBeenCalledWith('clients', expect.objectContaining({ name: 'Synthetic new client', contact_name: 'Ada Example', address: '12 Test Lane' }))
    expect(dialog()).toBeTruthy()
    expect(field('Client / company name').value).toBe('  Synthetic new client  ')
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/clients')
  })

  it('prevents repeated submits until a new-client save finishes and navigates only on success', async () => {
    let resolveInsert!: (value: Awaited<ReturnType<Store['insert']>>) => void
    vi.mocked(store.insert).mockImplementation(() => new Promise(resolve => { resolveInsert = resolve }))
    await render()
    await act(async () => button('New client').click())
    await change(field('Client / company name'), 'Synthetic saved client')
    const save = button('Add client')
    await act(async () => { save.click(); save.click(); dialog().querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(store.insert).toHaveBeenCalledTimes(1)
    expect(save.disabled).toBe(true)
    await act(async () => resolveInsert(client('created-client', 'Synthetic saved client')))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/clients/created-client')
  })

  it('validates a nonblank name before writing', async () => {
    await render()
    await act(async () => button('New client').click())
    await change(field('Client / company name'), '   ')
    await act(async () => button('Add client').click())
    expect(dialog()).toBeTruthy()
    noWrites()
  })

  it('keeps an invalid email in the form for correction without writing', async () => {
    await render()
    await act(async () => button('New client').click())
    await change(field('Client / company name'), 'Synthetic contact')
    await change(field('Email'), 'not-an-email')
    await act(async () => button('Add client').click())
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('valid email')
    expect(field('Email').value).toBe('not-an-email')
    noWrites()
  })

  it('retains an edited client after a failed update without closing or duplicating saves', async () => {
    let resolveUpdate!: (value: boolean) => void
    vi.mocked(store.update).mockImplementation(() => new Promise(resolve => { resolveUpdate = resolve }))
    await render()
    await act(async () => button('Edit client: Cedar Builders').click())
    await change(field('Phone'), '  555-0199  ')
    const save = button('Save')
    await act(async () => { save.click(); save.click() })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(save.disabled).toBe(true)
    await act(async () => resolveUpdate(false))
    expect(dialog()).toBeTruthy()
    expect(field('Phone').value).toBe('  555-0199  ')
    expect(store.update).toHaveBeenCalledWith('clients', 'client-a', expect.objectContaining({ phone: '555-0199' }))
  })

  it('keeps the editor open and withholds deletion callbacks after a failed delete', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.mocked(store.remove).mockResolvedValue(false)
    const onClose = vi.fn(), onDeleted = vi.fn()
    await act(async () => root.render(<MemoryRouter><ClientModal client={store.clients[0]} onClose={onClose} onDeleted={onDeleted} /></MemoryRouter>))
    await act(async () => button('Delete client').click())
    expect(store.remove).toHaveBeenCalledWith('clients', 'client-a')
    expect(store.refresh).toHaveBeenCalledWith('clients')
    expect(onClose).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(dialog()).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
