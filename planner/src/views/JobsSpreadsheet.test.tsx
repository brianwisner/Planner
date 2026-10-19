// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Job, Phase, Task, TimeEntry } from '../lib/types'
import { jobRows, type JobOverview } from '../lib/jobs'
import { downloadCSV } from '../lib/utils'
import { JobsSpreadsheet } from './JobsSpreadsheet'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('../lib/utils')>(), downloadCSV: vi.fn() }))
const TODAY = '2026-10-19'
const STAMP = '2026-10-19T12:00:00Z'
let container: HTMLDivElement
let root: Root
let selected: JobOverview[] | undefined
let onEditJob = vi.fn<(job: Job) => void>()

function job(overrides: Partial<Job> = {}): Job { return { id: 'cedar', client_id: 'client', job_number: 'SYN-101', name: 'Cedar residence', description: '', address: 'Synthetic address', status: 'active', priority: 2, fee: 5000, queued_date: null, start_date: null, due_date: '2026-10-28', created_at: STAMP, ...overrides } }
function phase(overrides: Partial<Phase> = {}): Phase { return { id: 'design', job_id: 'cedar', kind: 'design', name: 'Original design', sort_order: 2, status: 'in_progress', estimate_hours: 12, start_date: null, due_date: '2026-10-25', assignee_id: 'legacy-owner', notes: '', ...overrides } }
function hours(overrides: Partial<TimeEntry> = {}): TimeEntry { return { id: 'hours', job_id: 'cedar', phase_id: 'design', task_id: null, user_id: 'legacy-owner', date: TODAY, hours: 8, started_at: null, rate: 125, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP, ...overrides } }
function task(overrides: Partial<Task> = {}): Task { return { id: 'review', job_id: 'cedar', phase_id: 'design', title: 'Review framing', description: '', status: 'waiting', assignee_id: null, due_date: TODAY, scheduled_at: null, is_site_visit: false, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: null, created_at: STAMP, ...overrides } }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T12:00:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 125, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 125, weekly_capacity: 40 }, profiles: [owner],
    clients: [{ id: 'client', name: 'Synthetic Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP }],
    jobs: [job()], phases: [phase()], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null),
  }
  selected = undefined; onEditJob = vi.fn<(job: Job) => void>()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render() { await act(async () => root.render(<MemoryRouter><JobsSpreadsheet rows={selected ?? jobRows(store)} onEditJob={onEditJob} /></MemoryRouter>)) }
function button(label: string) {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label)
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}
function row(id = 'cedar') { return container.querySelector<HTMLAnchorElement>(`tbody th a[href="/jobs/${id}"]`)!.closest('tr')! }
function order() { return [...container.querySelectorAll<HTMLAnchorElement>('tbody th a')].map(link => link.textContent) }
function column(label: string) {
  const input = [...container.querySelectorAll<HTMLLabelElement>('.jobs-spreadsheet-column-list label')].find(labelElement => labelElement.textContent === label)?.querySelector('input')
  if (!input) throw new Error(`Missing column: ${label}`)
  return input
}
async function change(control: HTMLSelectElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event('change', { bubbles: true })) }) }
function noWrites() { expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }
function moneyFixture() {
  store.timeEntries = [hours(), hours({ id: 'internal', hours: 2, billable: false })]
  store.deposits = [{ id: 'deposit', job_id: 'cedar', amount: 200, received_date: TODAY, method: '', notes: '', created_at: STAMP }]
  store.invoices = [{ id: 'invoice', job_id: 'cedar', number: 'SYN-I', amount: 800, issued_date: TODAY, paid_date: null, notes: '', created_at: STAMP }]
}

describe('Jobs spreadsheet', () => {
  it('keeps one row per supplied job with genuine links and a labelled keyboard scroll region', async () => {
    store.jobs.push(job({ id: 'held', name: 'Held addition', priority: 1, status: 'on_hold' }))
    selected = jobRows(store).filter(row => row.job.id === 'cedar')
    await render()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(order()).toEqual(['Cedar residence'])
    expect(row().querySelector('th[scope="row"]')?.classList.contains('jobs-spreadsheet-identity')).toBe(true)
    expect(row().querySelector('.jobs-spreadsheet-client a')?.getAttribute('href')).toBe('/clients/client')
    expect(row().querySelector('.jobs-spreadsheet-number')?.textContent).toBe('SYN-101')
    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Jobs spreadsheet"]')!
    expect(region.tabIndex).toBe(0)
    await act(async () => region.focus())
    expect(document.activeElement).toBe(region)
    expect(region.getAttribute('aria-describedby')).toBeTruthy()
    expect(container.querySelector('caption')?.textContent).toContain('current selection')
    noWrites()
  })

  it('uses all saved effort but excludes retired phase estimates and keeps the completed-hours rate basis', async () => {
    moneyFixture()
    store.phases.unshift(phase({ id: 'old-queue', kind: 'queued', name: 'Queued', sort_order: 0, estimate_hours: 999 }))
    store.timeEntries.push(hours({ id: 'running', hours: null, started_at: new Date(new Date().getTime() - 3600000).toISOString() }))
    await render()
    expect(row().querySelector('.jobs-spreadsheet-phase')?.textContent).toContain('Design')
    expect(row().querySelector('.jobs-spreadsheet-phase')?.textContent).not.toContain('Queued')
    expect(row().querySelector('.jobs-spreadsheet-worked')?.textContent).toContain('11h')
    expect(row().querySelector('[aria-label="Includes running timer"]')).toBeTruthy()
    expect(row().querySelector('.jobs-spreadsheet-estimate')?.textContent).toBe('12h')
    expect(row().querySelector('.jobs-spreadsheet-nonbillable')?.textContent).toBe('2h')
    expect(row().querySelector('.jobs-spreadsheet-ready a')?.textContent).toBe('$800.00')
    expect(row().querySelector('.jobs-spreadsheet-unpaid a')?.textContent).toBe('$800.00')
    expect(row().querySelector('.jobs-spreadsheet-balance a')?.textContent).toBe('-$250.00')
    expect(row().querySelector('.jobs-spreadsheet-rate a')?.textContent).toBe('$100/h')
    expect(row().querySelector('.jobs-spreadsheet-rate a')?.getAttribute('title')).toContain('all completed hours including nonbillable time')
    expect(row().querySelector('.jobs-spreadsheet-rate a')?.getAttribute('href')).toBe('/billing?job=cedar')
    noWrites()
  })

  it('links the actual next deadline and keeps closed recorded dates available without operational alerts', async () => {
    store.tasks = [task()]
    store.jobs.push(job({ id: 'closed', name: 'Finished addition', status: 'complete', due_date: '2026-09-01' }))
    await render()
    expect(row().querySelector('.jobs-spreadsheet-due a')?.getAttribute('href')).toBe('/jobs/cedar?task=review')
    expect(row().querySelector('.jobs-spreadsheet-due a')?.getAttribute('aria-label')).toContain('Review framing')
    expect(row('closed').querySelector('.jobs-spreadsheet-due a')).toBeNull()
    expect(row('closed').querySelector('.overdue')).toBeNull()
    await act(async () => column('Job due (recorded)').click())
    expect(row('closed').querySelector('.jobs-spreadsheet-recordedDue time')?.getAttribute('dateTime')).toBe('2026-09-01')
    noWrites()
  })

  it('sorts numeric effort in both directions using native buttons and aria-sort', async () => {
    store.jobs = [job({ id: 'two', name: 'Two hours', priority: 1 }), job({ id: 'ten', name: 'Ten hours', priority: 2 }), job({ id: 'one', name: 'One hour', priority: 3 })]
    store.timeEntries = [hours({ id: 'two-hours', job_id: 'two', hours: 2 }), hours({ id: 'ten-hours', job_id: 'ten', hours: 10 }), hours({ id: 'one-hour', job_id: 'one', hours: 1 })]
    await render()
    const sort = button('Sort by worked hours')
    await act(async () => { sort.focus(); sort.click() })
    expect(document.activeElement).toBe(sort)
    expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    expect(order()).toEqual(['One hour', 'Two hours', 'Ten hours'])
    await act(async () => sort.click())
    expect(sort.closest('th')?.getAttribute('aria-sort')).toBe('descending')
    expect(order()).toEqual(['Ten hours', 'Two hours', 'One hour'])
    noWrites()
  })

  it('keeps missing dates and rates last when sorting descending from the compact controls', async () => {
    store.jobs = [job({ id: 'dated', name: 'Dated', due_date: '2026-10-22' }), job({ id: 'undated', name: 'Undated', due_date: null }), job({ id: 'later', name: 'Later', due_date: '2026-10-28' })]
    store.phases = []
    await render()
    await change(container.querySelector('select[aria-label="Sort spreadsheet"]')!, 'due')
    await act(async () => button('Sort direction: ascending').click())
    expect(order()).toEqual(['Later', 'Dated', 'Undated'])
    expect(container.querySelector('thead th[aria-sort="descending"]')?.textContent).toContain('Next due')
    noWrites()
  })

  it('lets column choices reduce the sheet while preserving job identity and restoring defaults', async () => {
    await render()
    expect(column('Job').disabled).toBe(true)
    await act(async () => column('Client').click())
    expect(row().querySelector('.jobs-spreadsheet-client')).toBeNull()
    expect(column('Completed hours').checked).toBe(false)
    await act(async () => column('Completed hours').click())
    expect(row().querySelector('.jobs-spreadsheet-completed')?.textContent).toBe('0h')
    await act(async () => button('Reset columns').click())
    expect(row().querySelector('.jobs-spreadsheet-client')).toBeTruthy()
    expect(row().querySelector('.jobs-spreadsheet-completed')).toBeNull()
    noWrites()
  })

  it('exports every filtered row in displayed sort order with formula-safe text and exact cents', async () => {
    moneyFixture()
    store.jobs[0] = job({ name: ' =HYPERLINK("https://synthetic.invalid")', job_number: '+001' })
    store.clients[0].name = '@SUM(1,2)'
    store.jobs.push(...Array.from({ length: 90 }, (_, index) => job({ id: `other-${index}`, name: `Synthetic ${index}`, priority: index + 3 })))
    selected = jobRows(store).filter(row => row.job.id !== 'other-89')
    await render()
    await act(async () => column('Fees recorded').click())
    await act(async () => button('Export CSV').click())
    const [filename, headers, data] = vi.mocked(downloadCSV).mock.calls[0]
    expect(filename).toBe('jobs-spreadsheet.csv')
    expect(data).toHaveLength(90)
    expect(data[0][headers.indexOf('Job')]).toBe('\' =HYPERLINK("https://synthetic.invalid")')
    expect(data[0][headers.indexOf('Job #')]).toBe("'+001")
    expect(data[0][headers.indexOf('Client')]).toBe("'@SUM(1,2)")
    expect(data[0][headers.indexOf('Worked hours')]).toBe(10)
    expect(data[0][headers.indexOf('Nonbillable hours')]).toBe(2)
    expect(data[0][headers.indexOf('Ready to bill')]).toBe('800.00')
    expect(data[0][headers.indexOf('Balance')]).toBe('-250.00')
    expect(data[0][headers.indexOf('Effective rate')]).toBe('100.00')
    expect(data[0][headers.indexOf('Fees recorded')]).toBe('1000.00')
    expect(data.flat()).not.toContain('Synthetic 89')
    noWrites()
  })

  it('exports only shown columns after sorting without changing saved priorities', async () => {
    store.jobs.push(job({ id: 'atlas', name: 'Atlas addition', priority: 5 }))
    await render()
    await act(async () => { column('Client').click(); button('Sort by job').click() })
    await act(async () => button('Export CSV').click())
    const [, headers, data] = vi.mocked(downloadCSV).mock.calls[0]
    expect(headers).not.toContain('Client')
    expect(data.map(row => row[0])).toEqual(['Atlas addition', 'Cedar residence'])
    expect(store.jobs.map(job => job.priority)).toEqual([2, 5])
    noWrites()
  })

  it('neutralizes leading spreadsheet operators and normalizes carriage returns in exported text', async () => {
    const names = ['-Synthetic', '\tSynthetic', '\r=SUM(1,2)', '  +SUM(1,2)']
    store.jobs = names.map((name, index) => job({ id: `csv-${index}`, name, priority: index + 1 }))
    await render()
    await act(async () => button('Export CSV').click())
    const [, , data] = vi.mocked(downloadCSV).mock.calls[0]
    expect(data.map(row => row[0])).toEqual(["'-Synthetic", "'\tSynthetic", "'\n=SUM(1,2)", "'  +SUM(1,2)"])
    noWrites()
  })

  it('uses the shared compact status control and guards a pending status save', async () => {
    let finish: (saved: boolean) => void = () => {}
    vi.mocked(store.update).mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve }))
    await render()
    const status = row().querySelector<HTMLSelectElement>('select')!
    expect(status.classList.contains('job-status-select')).toBe(true)
    await change(status, 'on_hold')
    expect(status.disabled).toBe(true)
    expect(status.getAttribute('aria-busy')).toBe('true')
    await change(status, 'complete')
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.update).toHaveBeenCalledWith('jobs', 'cedar', { status: 'on_hold' })
    await act(async () => finish(true))
    expect(status.disabled).toBe(false)
    expect(store.insert).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled()
  })

  it.each(['false', 'throw'])('refreshes an unconfirmed status save (%s) before allowing retry', async failure => {
    if (failure === 'false') vi.mocked(store.update).mockResolvedValueOnce(false)
    else vi.mocked(store.update).mockRejectedValueOnce(new Error('Synthetic failure'))
    await render()
    const status = row().querySelector<HTMLSelectElement>('select')!
    await change(status, 'on_hold')
    expect(store.refresh).toHaveBeenCalledWith('jobs')
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('Could not confirm the job status'), 'error')
    expect(status.disabled).toBe(false)
    expect(status.value).toBe('active')
  })

  it('opens the existing job snapshot for editing without an automatic write', async () => {
    await render()
    await act(async () => button('Edit job: Cedar residence').click())
    expect(onEditJob).toHaveBeenCalledExactlyOnceWith(store.jobs[0])
    noWrites()
  })

  it('keeps empty results readable and disables an empty export', async () => {
    selected = []
    await render()
    expect(container.querySelector('tbody')?.textContent).toContain('No jobs match this selection')
    expect(button('Export CSV').disabled).toBe(true)
    noWrites()
  })
})
