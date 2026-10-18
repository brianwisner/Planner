// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Job, Phase, Task, TimeEntry } from '../lib/types'
import { Dashboard } from './Dashboard'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/reminders', () => ({ useReminders: vi.fn() }))

const TODAY = '2026-10-19'
const STAMP = `${TODAY}T09:00:00-07:00`
let container: HTMLDivElement
let root: Root

function job(overrides: Partial<Job> = {}): Job {
  return { id: 'job', client_id: 'client', job_number: 'SYNTHETIC', name: 'Cedar residence', description: '', address: '', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: STAMP, ...overrides }
}

function phase(overrides: Partial<Phase> = {}): Phase {
  return { id: 'phase', job_id: 'job', kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 20, start_date: null, due_date: null, assignee_id: null, notes: '', ...overrides }
}

function task(overrides: Partial<Task> = {}): Task {
  return { id: 'task', job_id: 'job', phase_id: 'phase', title: 'Prepare framing plan', description: 'Synthetic task notes', status: 'todo', assignee_id: null, due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: 'owner', created_at: STAMP, ...overrides }
}

function hours(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'hours', job_id: 'job', phase_id: 'phase', task_id: null, user_id: 'owner', date: TODAY, hours: 2, started_at: null, rate: 125, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP, ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 125, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 125, weekly_capacity: 40 }, profiles: [owner],
    clients: [{ id: 'client', name: 'Oak Street client', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: true, created_at: STAMP }],
    jobs: [job()], phases: [phase()], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [],
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

async function render() {
  await act(async () => root.render(<MemoryRouter><Dashboard /></MemoryRouter>))
}

function card(title: string): HTMLElement {
  const heading = [...container.querySelectorAll('h2')].find(h => h.textContent?.trim().startsWith(title))
  const section = heading?.closest<HTMLElement>('.card')
  if (!section) throw new Error(`Missing dashboard card: ${title}`)
  return section
}

function stat(title: string): HTMLAnchorElement {
  const link = [...container.querySelectorAll('a')].find(a => a.textContent?.trim().startsWith(title))
  if (!link) throw new Error(`Missing linked dashboard summary: ${title}`)
  return link
}

function button(scope: ParentNode, text: string | RegExp): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find(b => typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent?.trim() ?? ''))
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

describe('Dashboard', () => {
  it('keeps an empty business compact with one deadlines card and useful navigation', async () => {
    store.jobs = []; store.phases = []; store.clients = []
    await render()
    for (const title of ['Deadlines', 'Tasks', 'This week & capacity', 'Billing follow-up', 'Job queue', 'Job checks']) expect(card(title)).toBeTruthy()
    expect([...container.querySelectorAll('h2')].filter(h => h.textContent?.trim().startsWith('Deadlines'))).toHaveLength(1)
    expect([...container.querySelectorAll('h2')].some(h => /^(Overdue|Open tasks|Due in the next 7 days)\b/.test(h.textContent?.trim() ?? ''))).toBe(false)
    expect(stat('Ready to bill').getAttribute('href')).toContain('/billing')
    expect(stat('Awaiting payment').getAttribute('href')).toContain('/billing')
    expect(stat('This week').getAttribute('href')).toContain('/time')
    expect(stat('Active jobs').getAttribute('href')).toContain('/jobs')
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })

  it('switches between actionable and waiting tasks while excluding closed work', async () => {
    store.jobs = [job(), job({ id: 'hold', name: 'Birch addition', status: 'on_hold' }), job({ id: 'closed', status: 'complete' }), job({ id: 'archived', status: 'archived' }), job({ id: 'cancelled', status: 'cancelled' })]
    store.tasks = [
      task(), task({ id: 'waiting', job_id: 'hold', title: 'Await architect sections', status: 'waiting' }),
      task({ id: 'complete-task', job_id: 'closed', title: 'Hidden completed job task' }),
      task({ id: 'archive-task', job_id: 'archived', title: 'Hidden archived job task' }),
      task({ id: 'cancelled-task', job_id: 'cancelled', title: 'Hidden cancelled job task' }),
    ]
    await render()
    const tasks = card('Tasks')
    const ready = button(tasks, 'Ready (1)')
    const waiting = button(tasks, 'Waiting (1)')
    expect(ready.getAttribute('aria-pressed')).toBe('true')
    expect(tasks.textContent).toContain('Prepare framing plan')
    expect(tasks.textContent).toContain('Oak Street client')
    expect(tasks.textContent).toContain('Cedar residence')
    expect(tasks.textContent).not.toContain('Await architect sections')
    expect(container.textContent).not.toContain('Hidden completed job task')
    expect(container.textContent).not.toContain('Hidden archived job task')
    expect(container.textContent).not.toContain('Hidden cancelled job task')
    await act(async () => waiting.click())
    expect(waiting.getAttribute('aria-pressed')).toBe('true')
    expect(ready.getAttribute('aria-pressed')).toBe('false')
    expect(tasks.textContent).toContain('Await architect sections')
    expect(tasks.textContent).toContain('Birch addition')
    expect(tasks.textContent).not.toContain('Prepare framing plan')
  })

  it('groups deadlines in one place with job/client context and task deep links', async () => {
    store.jobs[0].due_date = '2026-10-22'
    store.tasks = [
      task({ id: 'overdue', title: 'Overdue design review', due_date: '2026-10-18' }),
      task({ id: 'visit', title: 'Scheduled site visit', due_date: TODAY, is_site_visit: true, scheduled_at: '2026-10-19T14:30:00-07:00' }),
    ]
    await render()
    const deadlines = card('Deadlines')
    expect(deadlines.textContent).toContain('Overdue')
    expect(deadlines.textContent).toContain('Today')
    expect(deadlines.textContent).toContain('Coming up')
    expect(deadlines.textContent).toContain('Oak Street client')
    expect(deadlines.textContent).toContain('Cedar residence')
    expect(deadlines.querySelector('a[href="/jobs/job?task=visit"]')?.textContent).toContain('Scheduled site visit')
    expect(deadlines.querySelector('a[href="/jobs/job"]')).not.toBeNull()
  })

  it('opens the task editor and uses recurring completion from the dashboard checkbox', async () => {
    store.tasks = [task({ due_date: TODAY, recurrence: 'weekly' })]
    const child = task({ id: 'next', due_date: '2026-10-26', recurrence_parent_id: 'task' })
    store.insert = vi.fn(async () => child) as Store['insert']
    await render()
    await act(async () => button(card('Tasks'), 'Prepare framing plan').click())
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.querySelector('h2')?.textContent).toBe('Edit task')
    expect([...dialog.querySelectorAll('input')].some(i => i.value === 'Prepare framing plan')).toBe(true)
    await act(async () => button(dialog, 'Cancel').click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    const complete = card('Tasks').querySelector<HTMLButtonElement>('button[aria-label="Complete Prepare framing plan"]')
    expect(complete).not.toBeNull()
    await act(async () => complete!.click())
    expect(store.update).toHaveBeenCalledWith('tasks', 'task', expect.objectContaining({ status: 'done' }))
    expect(store.insert).toHaveBeenCalledWith('tasks', expect.objectContaining({ recurrence_parent_id: 'task', status: 'todo', due_date: '2026-10-26', assignee_id: 'owner' }))
  })

  it('shows weekly nonbillable work without presenting it as ready for invoicing', async () => {
    store.timeEntries = [hours({ hours: 3, billable: false })]
    await render()
    expect(stat('Ready to bill').textContent).toContain('$0')
    expect(stat('This week').textContent).toContain('3h')
    expect(card('This week & capacity').textContent).toContain('3h nonbillable')
    expect(card('Billing follow-up').textContent).not.toContain('Cedar residence')
    expect(card('Job queue').textContent).toContain('Cedar residence')
  })

  it('separates completed hours, remaining plans and a running timer in the capacity view', async () => {
    store.me!.weekly_hours = 20
    store.timeEntries = [hours({ hours: 4 }), hours({ id: 'running', hours: null, billable: false, started_at: '2026-10-19T10:00:00-07:00' })]
    store.schedule = [
      { id: 'future-plan', job_id: 'job', phase_id: 'phase', user_id: 'owner', date: TODAY, hours: 6, note: '', created_at: STAMP },
      { id: 'old-plan', job_id: 'job', phase_id: 'phase', user_id: 'owner', date: '2026-10-18', hours: 30, note: '', created_at: STAMP },
    ]
    await render()
    expect(stat('This week').textContent).toContain('4h')
    const week = card('This week & capacity')
    const meter = week.querySelector('[role="meter"]')!
    expect(meter.getAttribute('aria-valuenow')).toBe('4')
    expect(meter.getAttribute('aria-valuemax')).toBe('20')
    const planned = [...week.querySelectorAll('dt')].find(dt => dt.textContent === 'Planned today onward')
    expect(planned?.nextElementSibling?.textContent).toBe('6h')
    expect(week.textContent).toContain('Planned hours are separate from worked time')
    expect(container.textContent).toContain('Timer running')
    expect(container.textContent).toContain('Nonbillable · not included in completed hours yet')
    const timer = [...container.querySelectorAll('a')].find(a => a.textContent?.includes('Review timer'))
    expect(timer?.getAttribute('href')).toBe('/time')
  })

  it('keeps the full task board reachable when the compact list is truncated', async () => {
    store.tasks = Array.from({ length: 8 }, (_, index) => task({ id: `task-${index}`, title: `Review synthetic detail ${index + 1}`, sort_order: index }))
    await render()
    const tasks = card('Tasks')
    expect(tasks.querySelectorAll('button[aria-label^="Edit task:"]')).toHaveLength(6)
    const more = [...tasks.querySelectorAll('a')].find(a => a.textContent?.includes('Showing 6 of 8'))
    expect(more?.getAttribute('href')).toBe('/jobs?view=board')
  })

  it('keeps cancelled-job financial work reachable without putting it into the active queue', async () => {
    store.jobs[0].status = 'cancelled'
    store.timeEntries = [hours({ hours: 4 })]
    store.tasks = [task({ title: 'Cancelled task is not current work' })]
    await render()
    expect(stat('Ready to bill').textContent).toContain('$500')
    expect(card('Billing follow-up').textContent).toContain('Cedar residence')
    expect(card('Billing follow-up').querySelector('a[href="/billing?job=job"]')).not.toBeNull()
    expect(card('Job queue').textContent).not.toContain('Cedar residence')
    expect(card('Tasks').textContent).not.toContain('Cancelled task is not current work')
  })

  it('surfaces phase overruns without repeating the waiting-task list in job checks', async () => {
    store.phases = [phase({ estimate_hours: 2 })]
    store.timeEntries = [hours({ hours: 4 })]
    store.tasks = [task({ title: 'Call for missing dimensions', status: 'waiting' })]
    await render()
    const checks = card('Job checks')
    expect(checks.textContent).toContain('Cedar residence')
    expect(checks.textContent).toContain('2h')
    expect(checks.textContent).not.toContain('Call for missing dimensions')
    await act(async () => button(card('Tasks'), 'Waiting (1)').click())
    expect(card('Tasks').textContent).toContain('Call for missing dimensions')
  })

  it('labels lifetime fee efficiency separately from this week’s worked hours', async () => {
    store.timeEntries = [
      hours({ hours: 8, date: '2026-10-18', billed: true, invoice_id: 'invoice', deposit_applied: 200 }),
      hours({ id: 'nonbillable', hours: 2, billable: false }),
    ]
    store.invoices = [{ id: 'invoice', job_id: 'job', number: 'SYNTHETIC-INV', amount: 800, issued_date: TODAY, paid_date: null, notes: '', created_at: STAMP }]
    store.deposits = [{ id: 'deposit', job_id: 'job', amount: 200, received_date: '2026-10-17', method: '', notes: '', created_at: STAMP }]
    await render()
    expect(stat('This week').textContent).toContain('2h')
    const billing = card('Billing follow-up')
    expect(billing.textContent).toContain('Fees per worked hour')
    expect(billing.textContent).toContain('$100/h')
    expect(billing.textContent).toContain('10h')
    expect(billing.textContent).toMatch(/overhead|tax/)
  })
})
