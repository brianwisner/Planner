// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanningStore } from '../lib/planningTypes'
import type { Store } from '../lib/store'
import type { Job, Phase, ScheduleEntry, Task, TimeEntry } from '../lib/types'
import { downloadCSV } from '../lib/utils'
import { JobsTable } from './JobsTable'

let capacityPlanning: PlanningStore | null = null
vi.mock('../lib/planningStore', () => ({ useOptionalPlanning: () => capacityPlanning }))
let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('../lib/utils')>(), downloadCSV: vi.fn() }))

const TODAY = '2026-10-19'
const STAMP = `${TODAY}T09:00:00-07:00`
let container: HTMLDivElement
let root: Root
let props: Parameters<typeof JobsTable>[0]

function job(overrides: Partial<Job> = {}): Job {
  return { id: 'cedar', client_id: 'client', job_number: 'SYN-101', name: 'Cedar residence', description: '', address: '440 Maple Lane', status: 'active', priority: 2, fee: 5000, queued_date: null, start_date: null, due_date: null, created_at: STAMP, ...overrides }
}
function phase(overrides: Partial<Phase> = {}): Phase {
  return { id: 'design', job_id: 'cedar', kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 10, start_date: null, due_date: null, assignee_id: null, notes: '', ...overrides }
}
function task(overrides: Partial<Task> = {}): Task {
  return { id: 'review', job_id: 'cedar', phase_id: 'design', title: 'Review framing', description: '', status: 'waiting', assignee_id: null, due_date: TODAY, scheduled_at: null, is_site_visit: false, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: 'owner', created_at: STAMP, ...overrides }
}
function hours(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'hours', job_id: 'cedar', phase_id: 'design', task_id: null, user_id: 'owner', date: TODAY, hours: 2, started_at: null, rate: 125, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP, ...overrides }
}
function plan(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return { id: 'plan', job_id: 'cedar', phase_id: 'design', user_id: 'owner', date: TODAY, hours: 2, note: '', created_at: STAMP, ...overrides }
}

beforeEach(() => {
  capacityPlanning = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 125, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 125, weekly_capacity: 40 }, profiles: [owner],
    clients: [{ id: 'client', name: 'Oak Street Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP }],
    jobs: [job()], phases: [phase()], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null),
  }
  props = { jobs: store.jobs }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers()
})
async function render(patch: Partial<typeof props> = {}) {
  props = { ...props, ...patch }
  await act(async () => root.render(<MemoryRouter><JobsTable {...props} /></MemoryRouter>))
}
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
function input(date = TODAY, name = 'Cedar residence'): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[aria-label="Hours for ${name} on ${date}"]`)
  if (!found) throw new Error(`Missing plan input: ${name} ${date}`)
  return found
}
async function change(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value)
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
async function edit(value: string, key = 'Enter') {
  const control = input()
  await act(async () => control.focus())
  await change(control, value)
  await act(async () => control.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
  return control
}
function row(id = 'cedar') {
  const found = container.querySelector<HTMLAnchorElement>(`a[href="/jobs/${id}"]`)?.closest('tr')
  if (!found) throw new Error(`Missing job row: ${id}`)
  return found
}
function noWrites() {
  expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled()
}
async function planning() { await render({ schedulable: true }); await act(async () => button('Plan hours').click()) }
function jobOrder() { return [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')].map(row => row.querySelector('.job-row-heading a')?.textContent) }

describe('JobsTable overview', () => {
  it('starts compact with planning off, honors the saved preference, and keeps client reuse read-only', async () => {
    await render({ schedulable: true })
    expect(button('Plan hours').getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('input[type="number"]')).toBeNull()
    await act(async () => button('Plan hours').click())
    expect(localStorage.getItem('table-plan')).toBe('1')
    await render({ schedulable: false, showExport: false })
    expect(container.querySelector('input[type="number"]')).toBeNull()
    expect(container.textContent).not.toContain('Plan hours')
    expect(container.textContent).not.toContain('Export CSV')
    noWrites()
  })

  it('uses links and real next work while including nonbillable effort and recorded fees', async () => {
    store.jobs[0].due_date = '2026-10-25'
    store.phases = [phase({ id: 'later', kind: 'construction', sort_order: 3, estimate_hours: 4, due_date: '2026-10-23' }), phase({ id: 'done', kind: 'bidding', sort_order: 0, status: 'complete', estimate_hours: 1 }), phase({ assignee_id: 'owner' })]
    store.tasks = [task()]
    store.timeEntries = [hours({ hours: 8 }), hours({ id: 'nonbillable', hours: 2, billable: false })]
    store.deposits = [{ id: 'deposit', job_id: 'cedar', amount: 200, received_date: TODAY, method: '', notes: '', created_at: STAMP }]
    store.invoices = [{ id: 'invoice', job_id: 'cedar', number: 'SYN-I', amount: 800, issued_date: TODAY, paid_date: null, notes: '', created_at: STAMP }]
    await render()
    const jobRow = row()
    expect(jobRow.querySelector('.jobs-client-context a')?.getAttribute('href')).toBe('/clients/client')
    expect(jobRow.querySelector('.jobs-client-context')?.textContent).toContain('SYN-101 · Oak Street Builders')
    expect(jobRow.querySelector('.jobs-phase-column')?.textContent).toContain('Design')
    expect(jobRow.querySelector('.jobs-next-task a')?.getAttribute('href')).toBe('/jobs/cedar?task=review')
    expect(jobRow.querySelector('.jobs-next-task')?.textContent).toContain('Next: Review framingWaiting')
    expect(jobRow.querySelector('.jobs-deadline-column a')?.getAttribute('href')).toBe('/jobs/cedar?task=review')
    expect(jobRow.querySelector('.jobs-work-column')?.textContent).toContain('10h / 15h')
    expect(jobRow.querySelector('.jobs-work-column')?.textContent).toContain('2h nonbillable')
    expect(jobRow.querySelector('.jobs-work-column .bar')).toBeNull()
    expect(jobRow.querySelector<HTMLDetailsElement>('.jobs-row-details')?.open).toBe(false)
    expect(jobRow.querySelector('.jobs-billing-column')?.textContent).toContain('$800 awaiting payment')
    expect(jobRow.querySelector('.jobs-billing-column')?.textContent).toContain('$100/h')
    expect(jobRow.querySelector('.jobs-billing-column [title]')?.getAttribute('title')).toContain('including nonbillable time')
    noWrites()
  })

  it('keeps quick actions on open work and historical deadlines out of overdue controls', async () => {
    const closed = job({ id: 'closed', name: 'Finished addition', status: 'complete', priority: 9, due_date: '2026-09-01' })
    store.jobs = [...store.jobs, closed]
    const onLogHours = vi.fn(), onAddTask = vi.fn()
    await render({ jobs: store.jobs, onLogHours, onAddTask })
    await act(async () => { row().querySelector<HTMLDetailsElement>('.jobs-row-details')!.open = true; button('Log hours for Cedar residence').click(); button('Add task for Cedar residence').click() })
    expect(onLogHours).toHaveBeenCalledWith('cedar'); expect(onAddTask).toHaveBeenCalledWith('cedar')
    expect(row('closed').querySelector('.jobs-row-actions')).toBeNull()
    expect(row('closed').querySelector('.jobs-deadline-column')?.textContent).toContain('Recorded')
    expect(row('closed').querySelector('.jobs-deadline-column .badge')).toBeNull()
  })

  it('explains waiting and over-estimate matches even when they occur after the current phase', async () => {
    store.phases.push(phase({ id: 'construction', kind: 'construction', sort_order: 2, status: 'waiting', estimate_hours: 2 }))
    store.timeEntries = [hours({ phase_id: 'construction', hours: 3 })]
    await render()
    expect(row().querySelector('.jobs-phase-column')?.textContent).toContain('Design')
    expect(row().querySelector('.jobs-row-flags')?.textContent).toContain('1 waiting phase')
    expect(row().querySelector('.jobs-row-flags')?.textContent).toContain('Phase over estimate')
  })

  it('sorts accessibly through header buttons and the mobile control without writes', async () => {
    store.jobs = [job(), job({ id: 'atlas', name: 'Atlas duplex', priority: 3 })]
    await render({ jobs: store.jobs })
    expect(jobOrder()).toEqual(['Cedar residence', 'Atlas duplex'])
    await act(async () => button('Sort by job').click())
    expect(jobOrder()).toEqual(['Atlas duplex', 'Cedar residence'])
    expect(button('Sort by job').closest('th')?.getAttribute('aria-sort')).toBe('ascending')
    await change(container.querySelector<HTMLSelectElement>('select[aria-label="Sort jobs"]')!, 'name-desc')
    expect(jobOrder()).toEqual(['Cedar residence', 'Atlas duplex'])
    expect(button('Sort by job').closest('th')?.getAttribute('aria-sort')).toBe('descending')
    noWrites()
  })

  it('exports nonbillable, fee and billing figures while preserving historical ownership', async () => {
    store.phases[0].assignee_id = 'owner'
    store.timeEntries = [hours({ hours: 3, billable: false })]
    await render()
    await act(async () => button('Export CSV').click())
    const [, headers, data] = vi.mocked(downloadCSV).mock.calls[0]
    const values = Object.fromEntries(headers.map((header, index) => [header, data[0][index]]))
    expect(values).toMatchObject({ 'Historical assignee': 'Synthetic Owner', 'Actual h': 3, 'Billable completed h': 0, 'Nonbillable completed h': 3, 'Ready to bill $': 0, 'Fees recorded $': 0, 'Effective hourly rate $': 0 })
  })
})

describe('JobsTable explicit priority changes', () => {
  function openJobs() {
    store.jobs = [job(), job({ id: 'atlas', name: 'Atlas duplex', priority: 5, status: 'on_hold' }), job({ id: 'closed', name: 'Finished project', priority: 1, status: 'complete' })]
    return store.jobs.filter(job => job.status === 'active' || job.status === 'on_hold')
  }
  it('shows priority controls only after explicit intent and preserves hidden priority slots', async () => {
    await render({ jobs: openJobs(), allowReorder: true })
    expect(container.querySelector('[aria-label="Move Cedar residence down"]')).toBeNull()
    await act(async () => button('Reorder priority').click())
    expect(button('Reorder priority').getAttribute('aria-pressed')).toBe('true')
    noWrites()
    await act(async () => button('Move Cedar residence down').click())
    expect(store.update).toHaveBeenCalledTimes(2)
    expect(store.update).toHaveBeenNthCalledWith(1, 'jobs', 'atlas', { priority: 2 })
    expect(store.update).toHaveBeenNthCalledWith(2, 'jobs', 'cedar', { priority: 5 })
    expect(vi.mocked(store.update).mock.calls.some(call => call[1] === 'closed')).toBe(false)
  })

  it('repairs duplicate open priorities using unique slots that skip hidden jobs', async () => {
    const jobs = openJobs(); jobs[0].priority = 1; jobs[1].priority = 1
    await render({ jobs, allowReorder: true })
    await act(async () => button('Reorder priority').click())
    const first = container.querySelector<HTMLButtonElement>('.jobs-reorder-button[aria-label$="down"]')!
    await act(async () => first.click())
    const priorities = new Map(jobs.map(job => [job.id, job.priority]))
    for (const [, id, patch] of vi.mocked(store.update).mock.calls) if ('priority' in patch) priorities.set(String(id), Number(patch.priority))
    expect([...priorities.values()].sort()).toEqual([2, 3])
    expect(vi.mocked(store.update).mock.calls.some(call => call[1] === 'closed')).toBe(false)
  })

  it('disables reordering outside the complete ascending-priority scope', async () => {
    const jobs = openJobs()
    await render({ jobs, allowReorder: true })
    await act(async () => button('Reorder priority').click())
    await act(async () => button('Sort by priority').click())
    expect(button('Move Cedar residence down').disabled).toBe(true)
    await act(async () => button('Sort by job').click())
    expect(button('Move Cedar residence up').disabled).toBe(true)
    await render({ jobs: [jobs[0]] })
    await change(container.querySelector<HTMLSelectElement>('select[aria-label="Sort jobs"]')!, 'priority-asc')
    expect(button('Drag Cedar residence to reorder').disabled).toBe(true)
    noWrites()
  })

  it('stops after a partial save failure and refreshes the queue', async () => {
    const jobs = openJobs()
    store.update = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await render({ jobs, allowReorder: true })
    await act(async () => button('Reorder priority').click())
    await act(async () => button('Move Cedar residence down').click())
    expect(store.update).toHaveBeenCalledTimes(2)
    expect(store.refresh).toHaveBeenCalledWith('jobs')
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('Some priorities saved'), 'error')
  })
})

describe('JobsTable planned hours', () => {
  it('shows saved planning preferences and keeps legacy plans separate from owner inputs', async () => {
    localStorage.setItem('table-plan', '1')
    store.jobs = [...store.jobs, job({ id: 'held', status: 'on_hold' }), job({ id: 'closed', status: 'complete' })]
    store.schedule = [plan(), plan({ id: 'legacy', user_id: 'legacy-owner', hours: 3 }), plan({ id: 'held-plan', job_id: 'held', hours: 7 }), plan({ id: 'closed-plan', job_id: 'closed', hours: 9 })]
    await render({ jobs: store.jobs, schedulable: true })
    expect(button('Plan hours').getAttribute('aria-pressed')).toBe('true')
    expect(input().value).toBe('2')
    expect(row().querySelector('.jobs-saved-plan')?.textContent).toBe('+ 3h saved')
    expect(container.querySelector('tfoot')?.textContent).toContain('Active jobs total (all saved plans)5h')
    await edit('4')
    expect(store.update).toHaveBeenCalledWith('schedule_entries', 'plan', { hours: 4 })
    expect(store.update).not.toHaveBeenCalledWith('schedule_entries', 'legacy', expect.anything())
  })

  it('cancels edits with Escape instead of committing stale input on blur', async () => {
    store.schedule = [plan()]
    await planning()
    expect((await edit('7', 'Escape')).value).toBe('2')
    noWrites()
  })

  it('saves Enter once, guards a pending request, and never double-saves blur', async () => {
    store.schedule = [plan()]
    let resolve!: (value: boolean) => void
    store.update = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    await planning()
    const control = await edit('4')
    expect(control.disabled).toBe(true)
    await act(async () => control.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(store.update).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(true) })
    expect(control.disabled).toBe(false)
  })

  it('clears an existing plan only for an actual empty value', async () => {
    store.schedule = [plan()]
    await planning()
    await edit('')
    expect(store.remove).toHaveBeenCalledWith('schedule_entries', 'plan')
    expect(store.update).not.toHaveBeenCalled(); expect(store.insert).not.toHaveBeenCalled()
  })

  it('does not treat an invalid numeric value reported as empty as a deletion', async () => {
    store.schedule = [plan()]
    await planning()
    const control = input()
    vi.spyOn(control, 'validity', 'get').mockReturnValue({ badInput: true } as ValidityState)
    await edit('')
    expect(control.value).toBe('2')
    noWrites()
    expect(store.toast).toHaveBeenCalledWith('Enter planned hours from 0 to 24.', 'error')
  })

  it.each(['-1', '25', '24.5'])('rejects out-of-range hours %s and leaves the saved plan intact', async value => {
    store.schedule = [plan()]
    await planning()
    expect((await edit(value)).value).toBe('2')
    noWrites()
  })

  it('creates valid hours on the current work phase using the current owner', async () => {
    store.phases = [phase({ id: 'queued', kind: 'queued', sort_order: 0 }), phase()]
    store.insert = vi.fn(async () => plan({ hours: 24 })) as Store['insert']
    await planning()
    await edit('24')
    expect(store.insert).toHaveBeenCalledWith('schedule_entries', { job_id: 'cedar', phase_id: 'design', user_id: 'owner', date: TODAY, hours: 24 })
  })

  it('refreshes an unconfirmed save and restores the baseline when that remains authoritative', async () => {
    store.schedule = [plan()]
    store.update = vi.fn(async () => false)
    await planning()
    expect((await edit('4')).value).toBe('2')
    expect(store.refresh).toHaveBeenCalledWith('schedule_entries')
    expect(store.toast).toHaveBeenCalledWith('Could not confirm the save. Plans were refreshed; check the hours before retrying.', 'error')
  })

  it('shows authoritative refreshed hours after a committed save whose response was lost', async () => {
    store.schedule = [plan({ hours: 1 })]
    store.update = vi.fn(async () => false)
    store.refresh = vi.fn(async () => { store = { ...store, schedule: [plan({ hours: 2 })] } })
    await planning()
    await edit('2')
    await render()
    expect(input().value).toBe('2')
    expect(store.refresh).toHaveBeenCalledWith('schedule_entries')
    expect(store.update).toHaveBeenCalledTimes(1)
  })

  it('refreshes failed new plans and failed clears without leaving an unsaved draft', async () => {
    await planning()
    expect((await edit('3')).value).toBe('')
    expect(store.refresh).toHaveBeenCalledWith('schedule_entries')
    store = { ...store, schedule: [plan()], remove: vi.fn(async () => false) }
    await render()
    expect((await edit('')).value).toBe('2')
    expect(store.remove).toHaveBeenCalledWith('schedule_entries', 'plan')
  })

  it('disables owner planning until the account is loaded', async () => {
    store.me = null
    await planning()
    expect(input().disabled).toBe(true)
    noWrites()
  })

  it('opens the existing owner-only schedule form for multiple owner phases', async () => {
    store.phases.push(phase({ id: 'construction', kind: 'construction', sort_order: 2 }))
    store.schedule = [plan(), plan({ id: 'second', phase_id: 'construction', hours: 1 }), plan({ id: 'legacy', user_id: 'legacy-owner', hours: 7 })]
    await planning()
    expect(input().readOnly).toBe(true)
    expect(input().value).toBe('3')
    await act(async () => input().focus())
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Schedule hours')
    expect(dialog?.querySelector<HTMLInputElement>(`input[aria-label="Hours on ${TODAY}"]`)?.value).toBe('2')
    noWrites()
  })
})


describe('JobsTable daily availability', () => {
  it('compares saved plans with daily hours after blocks rather than default weekly hours', async () => {
    capacityPlanning = { availability: [{ date: TODAY, base_hours: 2 }], blocks: [{ date: TODAY, hours: 1 }] } as PlanningStore
    store.schedule = [plan()]
    localStorage.setItem('table-plan', '1')
    await render({ schedulable: true })
    expect(container.querySelector('tfoot .plan-over')?.textContent).toBe('2h')
    noWrites()
  })
})
