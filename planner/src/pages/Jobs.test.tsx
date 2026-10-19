// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Job, Phase, Task, TimeEntry } from '../lib/types'
import { Jobs } from './Jobs'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../views/JobsTable', () => ({ JobsTable: ({ jobs, schedulable, allowReorder, onLogHours, onAddTask }: { jobs: Job[]; schedulable?: boolean; allowReorder?: boolean; onLogHours?: (id: string) => void; onAddTask?: (id: string) => void }) =>
  <div data-testid="jobs-list" data-job-ids={jobs.map(job => job.id).join(',')} data-schedulable={String(schedulable)} data-reorder={String(allowReorder)}>{jobs.map(job => <div key={job.id}><span>{job.name}</span><button onClick={() => onLogHours?.(job.id)}>Test log hours for {job.id}</button><button onClick={() => onAddTask?.(job.id)}>Test add task for {job.id}</button></div>)}</div> }))
vi.mock('../views/Kanban', () => ({ Kanban: ({ tasks }: { tasks: Task[] }) =>
  <div data-testid="jobs-board" data-job-ids={[...new Set(tasks.map(task => task.job_id))].join(',')}>{tasks.map(task => <span key={task.id}>{task.title}</span>)}</div> }))
vi.mock('../views/Gantt', () => ({ Gantt: ({ jobs }: { jobs: Job[] }) =>
  <div data-testid="jobs-timeline" data-job-ids={jobs.map(job => job.id).join(',')}>{jobs.map(job => <span key={job.id}>{job.name}</span>)}</div> }))
vi.mock('../views/CalendarView', () => ({ CalendarView: ({ items }: { items: { id: string; jobId: string; title: string }[] }) =>
  <div data-testid="jobs-calendar" data-job-ids={[...new Set(items.map(item => item.jobId))].join(',')}>{items.map(item => <span key={item.id}>{item.title}</span>)}</div> }))

const TODAY = '2026-10-19'
const STAMP = `${TODAY}T09:00:00-07:00`
let container: HTMLDivElement
let root: Root

function job(overrides: Partial<Job> = {}): Job {
  return { id: 'cedar', client_id: 'client-a', job_number: 'SYN-101', name: 'Cedar residence', description: '', address: '440 Maple Lane', status: 'active', priority: 2, fee: 5000, queued_date: null, start_date: null, due_date: TODAY, created_at: STAMP, ...overrides }
}
function phase(jobId: string, overrides: Partial<Phase> = {}): Phase {
  return { id: `phase-${jobId}`, job_id: jobId, kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 4, start_date: null, due_date: null, assignee_id: null, notes: '', ...overrides }
}
function task(jobId: string): Task {
  return { id: `task-${jobId}`, job_id: jobId, phase_id: `phase-${jobId}`, title: `Task for ${jobId}`, description: '', status: 'todo', assignee_id: null, due_date: TODAY, scheduled_at: null, is_site_visit: false, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: 'owner', created_at: STAMP }
}
function hours(): TimeEntry {
  return { id: 'hours', job_id: 'cedar', phase_id: 'phase-cedar', task_id: null, user_id: 'owner', date: TODAY, hours: 6, started_at: null, rate: 125, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 125, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  const jobs = [job(), job({ id: 'atlas', client_id: 'client-b', name: 'Atlas duplex', job_number: 'SYN-202', address: '20 Oak Street', priority: 1, due_date: null }),
    job({ id: 'held', name: 'Held porch', address: '80 Birch Road', status: 'on_hold', priority: 3, due_date: '2026-10-21' }),
    job({ id: 'complete', name: 'Finished project', status: 'complete', priority: 4 }),
    job({ id: 'cancelled', name: 'Cancelled project', status: 'cancelled', priority: 5 }),
    job({ id: 'archived', name: 'Archived project', status: 'archived', priority: 6 })]
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 125, weekly_capacity: 40 }, profiles: [owner],
    clients: [{ id: 'client-a', name: 'Cedar Builders', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP },
      { id: 'client-b', name: 'Atlas Development', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP }],
    jobs, phases: jobs.map(job => phase(job.id, { status: job.id === 'atlas' ? 'waiting' : 'in_progress' })), tasks: jobs.map(job => task(job.id)),
    timeEntries: [hours()], invoices: [], deposits: [], items: [], comments: [], schedule: [],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function LocationProbe() {
  const location = useLocation(), navigate = useNavigate()
  return <div><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Test go back</button><button onClick={() => navigate(1)}>Test go forward</button></div>
}
async function render(url = '/jobs') {
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Jobs /><LocationProbe /></MemoryRouter>))
}
function button(label: string | RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(button => typeof label === 'string' ? button.textContent?.trim() === label : label.test(button.textContent?.trim() ?? ''))
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
function select(label: string): HTMLSelectElement {
  const found = [...container.querySelectorAll('select')].find(select => select.getAttribute('aria-label')?.toLowerCase().includes(label))
  if (!found) throw new Error(`Missing named ${label} filter`)
  return found
}
function search(): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('input[aria-label="Search jobs"]')
  if (!found) throw new Error('Missing Search jobs field')
  return found
}
async function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function query(): URLSearchParams {
  const location = container.querySelector('[data-testid="location"]')?.textContent ?? ''
  return new URLSearchParams(location.split('?')[1] ?? '')
}
function ids(view = 'list'): string[] {
  if (view === 'sheet') return [...container.querySelectorAll<HTMLAnchorElement>('.jobs-spreadsheet-table tbody th a')].map(link => link.getAttribute('href')!.split('/').at(-1)!).sort()
  const rendered = container.querySelector(`[data-testid="jobs-${view}"]`)
  if (!rendered) throw new Error(`Missing ${view} view`)
  return (rendered.getAttribute('data-job-ids') ?? '').split(',').filter(Boolean).sort()
}
function noWrites() {
  expect(store.insert).not.toHaveBeenCalled()
  expect(store.update).not.toHaveBeenCalled()
  expect(store.remove).not.toHaveBeenCalled()
}

describe('Jobs page', () => {
  it('defaults unknown view values to List and shows active plus on-hold jobs', async () => {
    await render('/jobs?view=unknown')
    expect(button('List').getAttribute('aria-pressed')).toBe('true')
    expect(ids()).toEqual(['atlas', 'cedar', 'held'])
    noWrites()
  })

  it('restores shared URL filters and forwards only matching jobs to the board', async () => {
    await render('/jobs?view=board&status=active&client=client-a&q=CEDAR')
    expect(button('Task board').getAttribute('aria-pressed')).toBe('true')
    expect(select('status').value).toBe('active')
    expect(select('client').value).toBe('client-a')
    expect(search().value.toLowerCase()).toBe('cedar')
    expect(ids('board')).toEqual(['cedar'])
    expect(container.textContent).not.toContain('Task for held')
    noWrites()
  })

  it('preserves filters while switching all five views', async () => {
    await render('/jobs?status=active&client=client-a&q=cedar')
    for (const [label, view, parameter] of [['Spreadsheet', 'sheet', 'sheet'], ['Task board', 'board', 'board'], ['Timeline', 'timeline', 'gantt'], ['Calendar', 'calendar', 'calendar'], ['List', 'list', 'table']]) {
      await act(async () => button(label).click())
      expect(button(label).getAttribute('aria-pressed')).toBe('true')
      expect(ids(view)).toEqual(['cedar'])
      expect(query().get('status')).toBe('active')
      expect(query().get('client')).toBe('client-a')
      expect(query().get('q')).toBe('cedar')
      expect(query().get('view') ?? 'table').toBe(parameter)
    }
    noWrites()
  })

  it('restores URL-driven view and filters through back and forward navigation', async () => {
    await render('/jobs?view=board&status=on_hold&client=client-a&q=Held')
    await act(async () => button('Timeline').click())
    expect(ids('timeline')).toEqual(['held'])
    await act(async () => button('Test go back').click())
    expect(button('Task board').getAttribute('aria-pressed')).toBe('true')
    expect(ids('board')).toEqual(['held'])
    expect(select('status').value).toBe('on_hold')
    expect(search().value.toLowerCase()).toBe('held')
    await act(async () => button('Test go forward').click())
    expect(button('Timeline').getAttribute('aria-pressed')).toBe('true')
    expect(ids('timeline')).toEqual(['held'])
    noWrites()
  })

  it('opens a bookmarked spreadsheet with shared filters and preserves its view when resetting', async () => {
    await render('/jobs?view=sheet&status=all&client=client-a&q=project&source=synthetic')
    expect(button('Spreadsheet').getAttribute('aria-pressed')).toBe('true')
    expect(ids('sheet')).toEqual(['archived', 'cancelled', 'complete'])
    expect(container.querySelectorAll('.jobs-spreadsheet-table tbody tr')).toHaveLength(3)
    await act(async () => button('Reset filters').click())
    expect(ids('sheet')).toEqual(['atlas', 'cedar', 'held'])
    expect(query().get('view')).toBe('sheet')
    expect(query().get('source')).toBe('synthetic')
    noWrites()
  })

  it('keeps spreadsheet job-edit drafts through cancellation and unchanged URL filters', async () => {
    await render('/jobs?view=sheet&client=client-a&q=cedar')
    const before = query().toString()
    const edit = container.querySelector<HTMLButtonElement>('button[aria-label="Edit job: Cedar residence"]')!
    await act(async () => edit.click())
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('h2')?.textContent).toBe('Edit job')
    const name = [...dialog.querySelectorAll<HTMLInputElement>('input')].find(input => input.value === 'Cedar residence')!
    await change(name, 'Synthetic draft')
    await act(async () => button('Cancel').click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(query().toString()).toBe(before)
    expect(store.jobs.find(job => job.id === 'cedar')?.name).toBe('Cedar residence')
    noWrites()
  })

  it('retains the editing snapshot and draft if an optimistic failed deletion removes the sheet row', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finish: (saved: boolean) => void = () => {}
    vi.mocked(store.remove).mockImplementationOnce(() => {
      store = { ...store, jobs: store.jobs.filter(job => job.id !== 'cedar') }
      return new Promise<boolean>(resolve => { finish = resolve })
    })
    await render('/jobs?view=sheet&q=residence')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Edit job: Cedar residence"]')!.click())
    const name = [...container.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].find(input => input.value === 'Cedar residence')!
    await change(name, 'Unsaved synthetic draft')
    await act(async () => button('Delete job').click())
    await render('/jobs?view=sheet&q=residence')
    expect(container.textContent).toContain('No jobs match this selection')
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(name.isConnected).toBe(true)
    expect(name.value).toBe('Unsaved synthetic draft')
    await act(async () => finish(false))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('not deleted')
    expect(name.value).toBe('Unsaved synthetic draft')
    expect(query().get('view')).toBe('sheet')
    expect(query().get('q')).toBe('residence')
    expect(store.refresh).toHaveBeenCalledWith('jobs')
  })

  it('closes the sheet editor only after a confirmed deletion and keeps the current selection', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(store.remove).mockImplementationOnce(async () => { store = { ...store, jobs: store.jobs.filter(job => job.id !== 'cedar') }; return true })
    await render('/jobs?view=sheet&client=client-a&q=cedar')
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Edit job: Cedar residence"]')!.click())
    await act(async () => button('Delete job').click())
    await render('/jobs?view=sheet&client=client-a&q=cedar')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(query().get('view')).toBe('sheet')
    expect(query().get('client')).toBe('client-a')
    expect(query().get('q')).toBe('cedar')
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('jobs', 'cedar')
  })

  it('filters by status and client through named controls without changing records', async () => {
    await render()
    await change(select('status'), 'all')
    expect(ids()).toEqual(['archived', 'atlas', 'cancelled', 'cedar', 'complete', 'held'])
    expect(query().get('status')).toBe('all')
    await change(select('status'), 'cancelled')
    expect(ids()).toEqual(['cancelled'])
    await change(select('status'), 'active')
    await change(select('client'), 'client-b')
    expect(ids()).toEqual(['atlas'])
    expect(query().get('client')).toBe('client-b')
    noWrites()
  })

  it('searches job name, number, client, and address with case and whitespace normalization', async () => {
    await render()
    for (const [term, expected] of [['  CEDAR residence  ', ['cedar']], ['syn-202', ['atlas']], ['atlas development', ['atlas']], ['MAPLE LANE', ['cedar']], ['   ', ['atlas', 'cedar', 'held']]] as const) {
      await change(search(), term)
      expect(ids()).toEqual([...expected])
    }
    noWrites()
  })

  it('drills into summaries while keeping their counts scoped to the base filters', async () => {
    // Keep this drill based on job/phase signals rather than extra task dates.
    store.tasks = store.tasks.map(task => ({ ...task, due_date: null }))
    await render()
    const all = button(/^Jobs in view/)
    expect(all.textContent).toContain('3')
    await act(async () => button(/^Billing follow-up/).click())
    expect(ids()).toEqual(['cedar'])
    expect(query().get('focus')).toBe('billing')
    expect(button(/^Jobs in view/).textContent).toContain('3')
    expect(button(/^Billing follow-up/).getAttribute('aria-pressed')).toBe('true')
    await act(async () => button(/^Waiting \/ on hold/).click())
    expect(ids()).toEqual(['atlas', 'held'])
    await act(async () => button(/^Jobs in view/).click())
    expect(ids()).toEqual(['atlas', 'cedar', 'held'])
    expect(query().get('focus') ?? 'all').toBe('all')
    noWrites()
  })

  it('supports over-estimate focus and resets filters while preserving the chosen view', async () => {
    await render('/jobs?view=gantt&status=all&client=client-a&q=cedar&focus=over_estimate')
    expect(ids('timeline')).toEqual(['cedar'])
    expect(select('focus').value).toBe('over_estimate')
    await act(async () => button('Reset filters').click())
    expect(button('Timeline').getAttribute('aria-pressed')).toBe('true')
    expect(ids('timeline')).toEqual(['atlas', 'cedar', 'held'])
    expect(select('status').value).toBe('open')
    expect(select('client').value).toBe('')
    expect(search().value).toBe('')
    expect(select('focus').value).toBe('all')
    noWrites()
  })

  it('provides a reset action when a search has no matching jobs', async () => {
    await render('/jobs?view=board&q=no-such-project')
    expect(container.textContent).toMatch(/No jobs match/i)
    await act(async () => button('Reset filters').click())
    expect(button('Task board').getAttribute('aria-pressed')).toBe('true')
    expect(ids('board')).toEqual(['atlas', 'cedar', 'held'])
    noWrites()
  })

  it('restricts priority reordering to the full default scope and planning to open statuses', async () => {
    await render()
    const list = () => container.querySelector('[data-testid="jobs-list"]')!
    expect(list().getAttribute('data-reorder')).toBe('true')
    expect(list().getAttribute('data-schedulable')).toBe('true')
    await change(search(), 'Cedar')
    expect(list().getAttribute('data-reorder')).toBe('false')
    await act(async () => button('Reset filters').click())
    expect(list().getAttribute('data-reorder')).toBe('true')
    await change(select('focus'), 'waiting')
    expect(list().getAttribute('data-reorder')).toBe('false')
    await act(async () => button('Reset filters').click())
    await change(select('status'), 'cancelled')
    expect(list().getAttribute('data-reorder')).toBe('false')
    expect(list().getAttribute('data-schedulable')).toBe('false')
    noWrites()
  })

  it('opens and cancels New job without saving or changing the current filters', async () => {
    await render('/jobs?view=calendar&status=active&client=client-a')
    const before = query().toString()
    await act(async () => button('New job').click())
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.querySelector('h2')?.textContent).toBe('New job')
    expect(dialog?.querySelector('select')?.value).toBe('client-a')
    const cancel = [...dialog!.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel')!
    await act(async () => cancel.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(query().toString()).toBe(before)
    noWrites()
  })

  it('opens row-scoped hours and task forms without changing any records on cancel', async () => {
    await render()
    for (const [opener, heading] of [['Test log hours for atlas', 'Log hours'], ['Test add task for atlas', 'New task']]) {
      await act(async () => button(opener).click())
      const dialog = container.querySelector('[role="dialog"]')!
      expect(dialog.querySelector('h2')?.textContent).toBe(heading)
      expect(dialog.querySelector('select')?.value).toBe('atlas')
      const cancel = [...dialog.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel')!
      await act(async () => cancel.click())
      expect(container.querySelector('[role="dialog"]')).toBeNull()
    }
    noWrites()
  })

  it('keeps a completely empty business usable without rendering a blank view', async () => {
    store.jobs = []; store.phases = []; store.tasks = []; store.clients = []
    await render()
    expect(container.querySelector('h1')?.textContent).toBe('Jobs')
    expect(button('New job')).toBeTruthy()
    expect(container.textContent).toMatch(/No jobs|Create.*job|first job/i)
    noWrites()
  })

  it('keeps historical jobs reachable when no open jobs remain', async () => {
    store.jobs = store.jobs.filter(job => ['complete', 'cancelled', 'archived'].includes(job.status))
    await render()
    expect(container.textContent).toContain('No jobs match this selection')
    expect(button('Create a job')).toBeTruthy()
    expect(container.textContent).not.toContain('Create your first job')
    await change(select('status'), 'all')
    expect(ids()).toEqual(['archived', 'cancelled', 'complete'])
    noWrites()
  })
})
