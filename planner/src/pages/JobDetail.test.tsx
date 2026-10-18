// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Job, Phase, Task, TimeEntry } from '../lib/types'
import { JobDetail } from './JobDetail'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../components/JobWork', () => ({ JobWork: ({ job, phases, tasks, onAddTask, onEditTask, onLog, onStart }: { job: Job; phases: Phase[]; tasks: Task[]; onAddTask: (id: string | null) => void; onEditTask: (task: Task) => void; onLog: (id: string | null, taskId?: string | null) => void; onStart: (id: string | null, taskId?: string | null) => void }) =>
  <div data-testid="job-work" data-job-id={job.id}>{phases.map(phase => <div key={phase.id}><button onClick={() => onAddTask(phase.id)}>Test add task to {phase.id}</button><button onClick={() => onLog(phase.id)}>Test log phase {phase.id}</button><button onClick={() => onStart(phase.id)}>Test timer phase {phase.id}</button></div>)}<button onClick={() => onLog(null, 'task-general')}>Test log general task</button>{tasks.map(task => <button key={task.id} onClick={() => onEditTask(task)}>Test edit {task.id}</button>)}</div> }))

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
  return <div><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Test go back</button><button onClick={() => navigate(1)}>Test go forward</button><button onClick={() => navigate('/jobs/atlas?tab=notes')}>Test open atlas</button></div>
}
async function render(url = '/jobs/cedar') {
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/jobs/:id" element={<JobDetail />} /><Route path="*" element={<div>Another page</div>} /></Routes><LocationProbe /></MemoryRouter>))
}
function button(label: string | RegExp): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(button => typeof label === 'string' ? (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label : label.test(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''))
  if (!found) throw new Error(`Missing button ${label}`)
  return found
}
async function change(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function query(): URLSearchParams {
  const location = container.querySelector('[data-testid="location"]')?.textContent ?? ''
  return new URLSearchParams(location.split('?')[1] ?? '')
}
function noWrites() {
  expect(store.insert).not.toHaveBeenCalled()
  expect(store.update).not.toHaveBeenCalled()
  expect(store.remove).not.toHaveBeenCalled()
}

function dialog(): HTMLElement {
  const element = container.querySelector<HTMLElement>('[role="dialog"]')
  if (!element) throw new Error('Missing editor dialog')
  return element
}
async function cancelDialog() {
  const cancel = [...dialog().querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel')!
  await act(async () => cancel.click())
  expect(container.querySelector('[role="dialog"]')).toBeNull()
}
function noteField(): HTMLTextAreaElement {
  const textarea = container.querySelector<HTMLTextAreaElement>('#job-note') ?? container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Add a note"]')
  if (!textarea) throw new Error('Missing note field')
  return textarea
}

describe('Job detail page', () => {
  it('falls back to Work for unknown tab values and keeps navigation accessible', async () => {
    await render('/jobs/cedar?tab=unknown')
    expect(container.querySelector('[aria-label="Job sections"]')).toBeTruthy()
    expect(button('Work').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid="job-work"]')?.getAttribute('data-job-id')).toBe('cedar')
    noWrites()
  })

  it('round-trips job tabs through the URL and browser history', async () => {
    await render()
    await act(async () => button('Hours & charges').click())
    expect(query().get('tab')).toBe('hours')
    expect(button('Hours & charges').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Notes').click())
    expect(query().get('tab')).toBe('notes')
    await act(async () => button('Test go back').click())
    expect(button('Hours & charges').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Test go forward').click())
    expect(button('Notes').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('Work').click())
    expect(query().has('tab')).toBe(false)
    noWrites()
  })

  it('opens a linked task only when it belongs to the current job', async () => {
    await render('/jobs/cedar?tab=notes&task=task-atlas')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(button('Notes').getAttribute('aria-pressed')).toBe('true')
    expect(query().has('task')).toBe(false)
    noWrites()
  })

  it('opens an own-job task deep link without losing the chosen tab', async () => {
    await render('/jobs/cedar?tab=notes&task=task-cedar')
    expect(dialog().querySelector('h2')?.textContent).toBe('Edit task')
    expect(dialog().querySelector('select')?.value).toBe('cedar')
    expect(dialog().querySelector<HTMLInputElement>('input')?.value).toBe('Task for cedar')
    expect(query().get('tab')).toBe('notes')
    expect(query().has('task')).toBe(false)
    await cancelDialog()
    noWrites()
  })

  it('opens header forms on the current job and its work phase, and cancels cleanly', async () => {
    await render()
    for (const [label, heading] of [['Log hours', 'Log hours'], ['Add task', 'New task']]) {
      await act(async () => button(label).click())
      expect(dialog().querySelector('h2')?.textContent).toBe(heading)
      const selects = dialog().querySelectorAll('select')
      expect(selects[0].value).toBe('cedar')
      expect(selects[1].value).toBe('phase-cedar')
      await cancelDialog()
    }
    noWrites()
  })

  it('preserves an explicitly chosen phase in phase-scoped editors', async () => {
    store.phases.push(phase('cedar', { id: 'later-phase', kind: 'plan_check', name: 'Plan check', sort_order: 2 }))
    await render()
    for (const label of ['Test add task to later-phase', 'Test log phase later-phase']) {
      await act(async () => button(label).click())
      const selects = dialog().querySelectorAll('select')
      expect(selects[0].value).toBe('cedar')
      expect(selects[1].value).toBe('later-phase')
      await cancelDialog()
    }
    noWrites()
  })

  it('does not start another timer after stopping an existing timer fails', async () => {
    store.timeEntries.push({ ...hours(), id: 'other-running', job_id: 'atlas', phase_id: 'phase-atlas', hours: null, started_at: '2026-10-19T11:00:00-07:00' })
    vi.mocked(store.update).mockResolvedValue(false)
    await render()
    await act(async () => button('Start timer').click())
    expect(store.update).toHaveBeenCalledWith('time_entries', 'other-running', { hours: 1, started_at: null })
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('preserves General when logging a general task or editing an existing general entry', async () => {
    store.tasks.push({ ...task('cedar'), id: 'task-general', phase_id: null, title: 'General task' })
    store.timeEntries = [{ ...hours(), phase_id: null, task_id: 'task-general', notes: 'General saved entry' }]
    await render()
    await act(async () => button('Test log general task').click())
    expect(dialog().querySelectorAll('select')[1].value).toBe('')
    expect(dialog().querySelectorAll('select')[2].value).toBe('task-general')
    await cancelDialog()
    await act(async () => button('Hours & charges').click())
    await act(async () => button('Edit hours on 2026-10-19: General saved entry').click())
    expect(dialog().querySelectorAll('select')[1].value).toBe('')
    expect(dialog().querySelectorAll('select')[2].value).toBe('task-general')
    await cancelDialog()
    noWrites()
  })

  it('guards simultaneous timer starts and retains the selected billing mode', async () => {
    let resolveInsert!: (value: null) => void
    vi.mocked(store.insert).mockImplementation(() => new Promise(resolve => { resolveInsert = resolve }))
    await render()
    const mode = container.querySelector<HTMLSelectElement>('select[aria-label="Timer billing mode"]')!
    await change(mode, 'nonbillable')
    await act(async () => { button('Start timer').click(); button('Start timer').click() })
    expect(store.insert).toHaveBeenCalledTimes(1)
    expect(store.insert).toHaveBeenCalledWith('time_entries', expect.objectContaining({ job_id: 'cedar', phase_id: 'phase-cedar', billable: false, user_id: 'owner', hours: null, date: TODAY }))
    await act(async () => resolveInsert(null))
  })

  it('blocks starting another timer when multiple older timers already remain', async () => {
    store.timeEntries.push(...['atlas', 'held'].map(jobId => ({ ...hours(), id: `running-${jobId}`, job_id: jobId, hours: null, started_at: STAMP })))
    await render()
    await act(async () => button('Start timer').click())
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('More than one timer is running')
    noWrites()
  })

  it('keeps a failed note draft so it can be retried', async () => {
    vi.mocked(store.insert).mockResolvedValue(null)
    await render('/jobs/cedar?tab=notes')
    await change(noteField(), '  Notes survive a failed save.  ')
    await act(async () => button('Post note').click())
    expect(store.insert).toHaveBeenCalledWith('comments', { job_id: 'cedar', user_id: 'owner', body: 'Notes survive a failed save.' })
    expect(noteField().value).toBe('  Notes survive a failed save.  ')
    expect(button('Post note').disabled).toBe(false)
  })

  it('posts a pending note only once across repeated button and shortcut input', async () => {
    let resolveInsert!: (value: Awaited<ReturnType<Store['insert']>>) => void
    vi.mocked(store.insert).mockImplementation(() => new Promise(resolve => { resolveInsert = resolve }))
    await render('/jobs/cedar?tab=notes')
    await change(noteField(), 'One synthetic note')
    const post = button('Post note')
    await act(async () => {
      post.click()
      post.click()
      noteField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
    })
    expect(store.insert).toHaveBeenCalledTimes(1)
    expect(post.disabled).toBe(true)
    await act(async () => resolveInsert({ id: 'saved-note', job_id: 'cedar', user_id: 'owner', body: 'One synthetic note', created_at: STAMP }))
    expect(noteField().value).toBe('')
  })

  it('does not post an empty or whitespace-only note', async () => {
    await render('/jobs/cedar?tab=notes')
    await change(noteField(), '   ')
    expect(button('Post note').disabled).toBe(true)
    await act(async () => noteField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })))
    noWrites()
  })

  it('keeps archived job history selected in hours, charge, and deposit forms', async () => {
    store.jobs = store.jobs.map(job => job.id === 'cedar' ? { ...job, status: 'archived' } : job)
    await render()
    expect([...container.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Start timer')).toBe(false)
    for (const label of ['Log hours', 'Add charge', 'Record deposit']) {
      await act(async () => button(label).click())
      expect(dialog().querySelector('select')?.value).toBe('cedar')
      expect([...dialog().querySelector('select')!.options].some(option => option.value === 'cedar')).toBe(true)
      await cancelDialog()
    }
    noWrites()
  })

  it('renders every hour entry newest first with real timesheet links and working filters', async () => {
    store.timeEntries = Array.from({ length: 15 }, (_, index) => ({ ...hours(), id: `entry-${index}`, date: `2026-10-${String(index + 1).padStart(2, '0')}`, notes: `Historic ${index}`, billable: index % 2 === 0 }))
    store.timeEntries = [store.timeEntries[6], ...store.timeEntries.filter((_, index) => index !== 6)]
    await render('/jobs/cedar?tab=hours')
    const links = () => [...container.querySelectorAll<HTMLAnchorElement>('.job-hours-section tbody a')]
    expect(links()).toHaveLength(15)
    expect(links()[0].getAttribute('href')).toBe('/time?entry=entry-14&job=cedar')
    expect(links()[14].getAttribute('href')).toBe('/time?entry=entry-0&job=cedar')
    expect(container.querySelector('a[href="/time?job=cedar"]')).toBeTruthy()
    await change(container.querySelector<HTMLSelectElement>('select[aria-label="Hours to show"]')!, 'nonbillable')
    expect(links()).toHaveLength(7)
    await change(container.querySelector<HTMLInputElement>('input[aria-label="Search hours"]')!, 'Historic 3')
    expect(links()).toHaveLength(1)
    expect(links()[0].getAttribute('href')).toBe('/time?entry=entry-3&job=cedar')
    await act(async () => button('Edit hours on 2026-10-04: Historic 3').click())
    expect(dialog().querySelector('select')?.value).toBe('cedar')
    await cancelDialog()
    noWrites()
  })

  it('orders charges newest first and edits the selected charge through an accessible button', async () => {
    store.items = [['old', '2026-10-01'], ['latest', '2026-10-19'], ['middle', '2026-10-10']].map(([id, date]) => ({ id, job_id: 'cedar', date, category: 'Expense', description: `${id} synthetic charge`, quantity: 1, unit_price: 50, billed: false, invoice_id: null, deposit_applied: null, created_by: 'owner', created_at: STAMP }))
    await render('/jobs/cedar?tab=hours')
    const charges = [...container.querySelectorAll<HTMLButtonElement>('[aria-labelledby="job-charges-title"] tbody .job-text-button')]
    expect(charges.map(button => button.textContent)).toEqual(['latest synthetic charge', 'middle synthetic charge', 'old synthetic charge'])
    await act(async () => button('Edit charge: middle synthetic charge').click())
    expect(dialog().querySelector('h2')?.textContent).toBe('Edit charge')
    expect([...dialog().querySelectorAll('input')].some(input => input.value === 'middle synthetic charge')).toBe(true)
    await cancelDialog()
    noWrites()
  })

  it('shows historical context without active deadline alerts or new timers on a cancelled job', async () => {
    store.jobs = store.jobs.map(job => job.id === 'cedar' ? { ...job, status: 'cancelled' } : job)
    await render()
    expect(container.querySelector('.job-status-notice')?.textContent).toContain('Cancelled job')
    expect(container.querySelector('.job-detail-stats')?.textContent).toContain('No pending date')
    expect(container.textContent).not.toContain('Upcoming dates')
    expect([...container.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Start timer')).toBe(false)
    expect(container.querySelector('a[href="/billing?job=cedar"]')).toBeTruthy()
    const timeline = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(link => link.textContent?.includes('Open timeline'))!
    const filters = new URL(timeline.href).searchParams
    expect(filters.get('view')).toBe('gantt')
    expect(filters.get('status')).toBe('cancelled')
    expect(filters.get('client')).toBe('client-a')
    expect(filters.get('q')).toBe('SYN-101')
    noWrites()
  })

  it('shows notes newest first and discards a local draft when opening another job', async () => {
    store.comments = [{ id: 'old-note', job_id: 'cedar', user_id: 'owner', body: 'Earlier note', created_at: '2026-10-18T09:00:00-07:00' }, { id: 'new-note', job_id: 'cedar', user_id: 'owner', body: 'Latest note', created_at: STAMP }]
    await render('/jobs/cedar?tab=notes')
    expect([...container.querySelectorAll('.job-note-body')].map(note => note.textContent)).toEqual(['Latest note', 'Earlier note'])
    await change(noteField(), 'Draft for Cedar only')
    await act(async () => button('Test open atlas').click())
    expect(container.querySelector('h1')?.textContent).toContain('Atlas duplex')
    expect(noteField().value).toBe('')
    noWrites()
  })

  it('provides a way back when a job no longer exists', async () => {
    await render('/jobs/missing')
    expect(container.textContent).toContain('Job not found')
    expect(container.querySelector('a[href="/jobs"]')).toBeTruthy()
    noWrites()
  })
})
