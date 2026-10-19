// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Job, Phase, Task, TimeEntry } from '../lib/types'
import { JobWork, type JobWorkProps } from './JobWork'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
const TODAY = '2026-10-19'
const STAMP = `${TODAY}T09:00:00-07:00`
let container: HTMLDivElement
let root: Root
let props: JobWorkProps

function job(overrides: Partial<Job> = {}): Job {
  return { id: 'job', client_id: 'client', job_number: 'SYNTHETIC', name: 'Cedar residence', description: '', address: '', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: STAMP, ...overrides }
}
function phase(overrides: Partial<Phase> = {}): Phase {
  return { id: 'design', job_id: 'job', kind: 'design', name: 'Original design', sort_order: 1, status: 'in_progress', estimate_hours: 10, start_date: null, due_date: null, assignee_id: 'legacy-owner', notes: 'Saved design note', ...overrides }
}
function task(overrides: Partial<Task> = {}): Task {
  return { id: 'task', job_id: 'job', phase_id: 'design', title: 'Prepare framing plan', description: 'Synthetic review notes', status: 'todo', assignee_id: 'legacy-owner', due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: 1, recurrence: 'none', recurrence_parent_id: null, sort_order: 1, completed_at: null, created_by: 'legacy-owner', created_at: STAMP, ...overrides }
}
function hours(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return { id: 'hours', job_id: 'job', phase_id: 'design', task_id: null, user_id: 'legacy-owner', date: TODAY, hours: 2, started_at: null, rate: 125, notes: '', billable: false, billed: false, invoice_id: null, deposit_applied: null, created_at: STAMP, ...overrides }
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T12:00:00-07:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#123456', hourly_rate: 125, weekly_hours: 40, ics_token: 'synthetic', created_at: STAMP }
  store = {
    session: null, me: owner, settings: { id: 1, company_name: 'Synthetic', default_rate: 125, weekly_capacity: 40 }, profiles: [owner], clients: [],
    jobs: [job()], phases: [phase()], tasks: [task()], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    update: vi.fn(async () => true), insert: vi.fn(async () => null), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null),
  }
  props = { job: store.jobs[0], phases: store.phases, tasks: store.tasks, timeEntries: store.timeEntries, operational: true, timerBillable: true, onAddTask: vi.fn(), onEditTask: vi.fn(), onLog: vi.fn(), onStart: vi.fn() }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers()
})
async function render(patch: Partial<JobWorkProps> = {}) {
  props = { ...props, ...patch }
  await act(async () => root.render(<JobWork {...props} />))
}
function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
function card(name = 'Original design'): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.job-phase-card')].find(card => card.getAttribute('aria-label') === name)
  if (!found) throw new Error(`Missing phase: ${name}`)
  return found
}
function dialog(): HTMLElement {
  const found = container.querySelector<HTMLElement>('[role="dialog"]')
  if (!found) throw new Error('Missing phase editor')
  return found
}
function field(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const found = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`)
  if (!found) throw new Error(`Missing field: ${label}`)
  return found
}
async function change(label: string, value: string) {
  const control = field(label)
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value)
    control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function visibleTasks() { return [...container.querySelectorAll<HTMLButtonElement>('.job-task-edit')].filter(button => !button.closest('[hidden]')).map(button => button.textContent) }
function noWrites() { expect(store.update).not.toHaveBeenCalled(); expect(store.insert).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }
async function openEditor(name = 'Original design') { await act(async () => button(`Edit phase: ${name}`).click()) }
async function save() { await act(async () => button('Save phase').click()) }

describe('JobWork phases and tasks', () => {
  it('orders phases and tasks, expands current work, and counts all ownership and nonbillable effort', async () => {
    const phases = [phase({ id: 'construction', kind: 'construction', name: 'Construction changes', sort_order: 2, status: 'waiting' }), phase()]
    const tasks = [task({ id: 'later', title: 'Second task', sort_order: 3 }), task(), task({ id: 'done', title: 'Completed task', status: 'done', sort_order: 0 })]
    await render({ phases, tasks, timeEntries: [hours({ hours: 12 }), hours({ id: 'foreign', job_id: 'another-job', hours: 40 })] })
    expect([...container.querySelectorAll('.job-phase-card')].map(card => card.getAttribute('aria-label'))).toEqual(['Original design', 'Construction changes', 'General tasks'])
    expect(card().querySelector('.job-phase-toggle')?.getAttribute('aria-expanded')).toBe('true')
    expect(card('Construction changes').querySelector('.job-phase-toggle')?.getAttribute('aria-expanded')).toBe('false')
    expect(card().querySelector('.job-phase-summary')?.textContent).toContain('1 / 3 tasks done · 12h / 10h worked')
    expect(card().textContent).toContain('Over estimate by 2h')
    expect(card().textContent).toContain('12h nonbillable')
    expect(visibleTasks()).toEqual(['Prepare framing plan', 'Second task'])
    noWrites()
  })

  it('finds completed and waiting tasks across collapsed phases and general tasks', async () => {
    const phases = [phase(), phase({ id: 'construction', kind: 'construction', name: 'Construction changes', sort_order: 2 })]
    const tasks = [task(), task({ id: 'done', phase_id: 'construction', title: 'Delivered plans', status: 'done' }), task({ id: 'general', phase_id: null, title: 'Call architect', status: 'waiting', description: 'Discuss roof framing' })]
    await render({ phases, tasks })
    await change('Task status', 'done')
    expect(visibleTasks()).toContain('Delivered plans')
    expect(visibleTasks()).not.toContain('Prepare framing plan')
    await change('Task status', 'waiting')
    expect(visibleTasks()).toEqual(['Call architect'])
    await change('Task status', 'all')
    await change('Search tasks', 'roof framing')
    expect(visibleTasks()).toEqual(['Call architect'])
    expect(container.querySelector('[role="status"]')?.textContent).toContain('1 matching task')
    await act(async () => button('Clear filters').click())
    expect((field('Task status') as HTMLSelectElement).value).toBe('open')
    expect((field('Search tasks') as HTMLInputElement).value).toBe('')
    noWrites()
  })

  it('keeps orphan and foreign phase tasks in General without rewriting their references', async () => {
    const orphan = task({ id: 'orphan', phase_id: 'missing-phase', title: 'Legacy permit call' })
    const foreign = task({ id: 'foreign', phase_id: 'other-phase', title: 'Imported site visit' })
    await render({ phases: [phase(), phase({ id: 'other-phase', job_id: 'another-job' })], tasks: [orphan, foreign, task({ id: 'hidden', job_id: 'another-job', phase_id: null, title: 'Other job task' })] })
    expect(visibleTasks()).toEqual(['Imported site visit', 'Legacy permit call'])
    expect(container.textContent).not.toContain('Other job task')
    expect(card('General tasks').textContent).toContain('Unavailable phase')
    await act(async () => { button('Edit task: Legacy permit call').click(); button('Log hours for task: Legacy permit call').click() })
    expect(props.onEditTask).toHaveBeenCalledWith(orphan)
    expect(props.onLog).toHaveBeenCalledWith(null, 'orphan')
    expect(orphan.phase_id).toBe('missing-phase')
    noWrites()
  })

  it('lets a matching filtered group be collapsed and opens it again for a new search', async () => {
    await render({ tasks: [task({ phase_id: null })] })
    await change('Search tasks', 'framing')
    const toggle = card('General tasks').querySelector<HTMLButtonElement>('.job-phase-toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await change('Search tasks', 'prepare')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    noWrites()
  })

  it('keeps completed phase effort visible without an active over-estimate warning', async () => {
    await render({ phases: [phase({ status: 'complete', estimate_hours: 1 })], timeEntries: [hours({ hours: 4 })] })
    expect(card().querySelector('.job-phase-summary')?.textContent).toContain('4h / 1h worked')
    expect(card().textContent).not.toContain('Over estimate by')
  })

  it('gives general tasks the same visit, date, status and recurrence context', async () => {
    await render({ tasks: [task({ phase_id: null, status: 'waiting', title: 'Site inspection', is_site_visit: true, scheduled_at: new Date('2026-10-19T14:30:00').toISOString(), due_date: TODAY, recurrence: 'weekly', estimate_hours: 2 })] })
    const general = card('General tasks')
    expect(general.textContent).toContain('Site visit')
    expect(general.textContent).toContain('2:30')
    expect(general.textContent).toContain('Waiting')
    expect(general.textContent).toContain('Every week')
    expect(general.textContent).toContain('2h estimate')
    expect(general.querySelector('.job-task-edit')?.tagName).toBe('BUTTON')
  })

  it('routes phase and task actions with the right context and disables pending timers', async () => {
    await render({ timerBillable: false })
    await act(async () => { button('Add task to Original design').click(); button('Log hours for Original design').click(); button('Log hours for task: Prepare framing plan').click(); button('Start nonbillable timer for task: Prepare framing plan').click() })
    expect(props.onAddTask).toHaveBeenCalledWith('design')
    expect(props.onLog).toHaveBeenCalledWith('design')
    expect(props.onLog).toHaveBeenCalledWith('design', 'task')
    expect(props.onStart).toHaveBeenCalledWith('design', 'task')
    await render({ timerBusy: true })
    expect([...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Start nonbillable timer"]')].every(button => button.disabled)).toBe(true)
  })

  it('retains historical edits and logging without overdue alerts or timer suggestions', async () => {
    await render({ job: job({ status: 'cancelled' }), operational: false, phases: [phase({ due_date: '2026-10-01', estimate_hours: 1 })], tasks: [task({ due_date: '2026-10-01' })], timeEntries: [hours({ hours: 4 })] })
    expect(card().textContent).toContain('Recorded due')
    expect(container.textContent).not.toContain('Over estimate by')
    expect(container.textContent).not.toContain('overdue')
    expect(container.querySelector('button[aria-label^="Start "]')).toBeNull()
    expect(button('Edit phase: Original design')).toBeTruthy()
    expect(button('Complete Prepare framing plan')).toBeTruthy()
    await act(async () => { button('Add task to Original design').click(); button('Log hours for Original design').click() })
    expect(props.onAddTask).toHaveBeenCalledWith('design'); expect(props.onLog).toHaveBeenCalledWith('design')
  })

  it('uses the shared recurrence completion rules and preserves existing ownership', async () => {
    const recurring = task({ due_date: TODAY, recurrence: 'weekly' })
    store.tasks = [recurring]
    store.insert = vi.fn(async () => task({ id: 'next', recurrence_parent_id: 'task', due_date: '2026-10-26' })) as Store['insert']
    await render({ tasks: [recurring] })
    await act(async () => button('Complete Prepare framing plan').click())
    expect(store.update).toHaveBeenCalledWith('tasks', 'task', expect.objectContaining({ status: 'done' }))
    expect(store.update).not.toHaveBeenCalledWith('tasks', 'task', expect.objectContaining({ assignee_id: expect.anything() }))
    expect(store.insert).toHaveBeenCalledWith('tasks', expect.objectContaining({ due_date: '2026-10-26', recurrence_parent_id: 'task', assignee_id: 'owner', created_by: 'legacy-owner' }))
  })

  it('guards task completion while pending and surfaces failure for retry', async () => {
    let resolve!: (value: boolean) => void
    store.update = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    await render()
    await act(async () => { button('Complete Prepare framing plan').click(); button('Complete Prepare framing plan').click() })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(button('Complete Prepare framing plan').disabled).toBe(true)
    await act(async () => { resolve(false) })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be saved')
    expect(button('Complete Prepare framing plan').disabled).toBe(false)
  })
})

describe('JobWork explicit phase editing', () => {
  it('keeps estimate, dates and notes local until Save, preserving ownership', async () => {
    await render(); await openEditor()
    await change('Estimate (hours)', '12.5'); await change('Phase start date', TODAY); await change('Phase due date', '2026-10-22'); await change('Phase notes', 'Updated engineering note'); await change('Phase status', 'waiting')
    await act(async () => field('Phase notes').dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    noWrites()
    await save()
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.update).toHaveBeenCalledWith('phases', 'design', { estimate_hours: 12.5, start_date: TODAY, due_date: '2026-10-22', notes: 'Updated engineering note', status: 'waiting' })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('discards Cancel and Escape without any writes', async () => {
    await render(); await openEditor(); await change('Phase notes', 'Discard this')
    await act(async () => button('Cancel', dialog()).click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    await openEditor()
    expect((field('Phase notes') as HTMLTextAreaElement).value).toBe('Saved design note')
    await change('Estimate (hours)', '50')
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    noWrites()
  })

  it.each(['', '-1', '1e999'])('rejects invalid estimate %s without saving', async value => {
    await render(); await openEditor(); await change('Estimate (hours)', value); await save()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('zero hours or more')
    noWrites()
  })

  it('rejects reversed dates and allows a zero estimate with equal dates', async () => {
    await render(); await openEditor(); await change('Phase start date', '2026-10-22'); await change('Phase due date', TODAY); await save()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('on or after')
    noWrites()
    await change('Phase due date', '2026-10-22'); await change('Estimate (hours)', '0'); await save()
    expect(store.update).toHaveBeenCalledWith('phases', 'design', expect.objectContaining({ estimate_hours: 0, start_date: '2026-10-22', due_date: '2026-10-22' }))
  })

  it('retains a failed workflow draft without writing queue dates', async () => {
    store.update = vi.fn(async () => false)
    await render(); await openEditor(); await change('Phase status', 'waiting'); await change('Phase notes', 'Keep this draft'); await save()
    expect((field('Phase notes') as HTMLTextAreaElement).value).toBe('Keep this draft')
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('changes are still here')
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(vi.mocked(store.update).mock.calls[0][0]).toBe('phases')
    expect(store.jobs[0].queued_date).toBeNull()
  })

  it('omits empty retired phases and retains meaningful planning history without workflow controls', async () => {
    const retired = phase({ id: 'queued', kind: 'queued', name: 'Queued', estimate_hours: 0, notes: '', due_date: null, status: 'in_progress' })
    await render({ phases: [retired, phase()] })
    expect(container.textContent).not.toContain('Queued')
    expect(container.querySelector('.job-planning-history')).toBeNull()
    await render({ phases: [{ ...retired, notes: 'Saved planning note', due_date: '2026-10-01', estimate_hours: 4 }, phase()], timeEntries: [hours({ phase_id: 'queued', hours: 2 })] })
    const history = container.querySelector('.job-planning-history')!
    expect(history.textContent).toContain('Planning history · 2h worked')
    expect(history.textContent).toContain('Recorded estimate: 4h')
    expect(history.textContent).toContain('Saved planning note')
    expect(history.textContent).toContain('2h nonbillable')
    expect(history.querySelector('button, .badge')).toBeNull()
    expect(card('General tasks').querySelector('.job-phase-summary')?.textContent).toContain('0h worked')
    expect(container.querySelector('[aria-label="Edit phase: Queued"]')).toBeNull()
    noWrites()
  })

  it('keeps saved planning tasks operable under General without assigning new time to history', async () => {
    const retired = phase({ id: 'queued', kind: 'queued', name: 'Custom saved queue', estimate_hours: 0, notes: '' })
    const saved = task({ phase_id: 'queued' })
    await render({ phases: [retired, phase()], tasks: [saved] })
    expect(visibleTasks()).toEqual(['Prepare framing plan'])
    expect(card('General tasks').textContent).toContain('Planning history')
    expect(card('General tasks').textContent).not.toContain('Unavailable phase')
    await act(async () => { button('Log hours for task: Prepare framing plan').click(); button('Start billable timer for task: Prepare framing plan').click(); button('Edit task: Prepare framing plan').click() })
    expect(props.onLog).toHaveBeenCalledWith(null, 'task')
    expect(props.onStart).toHaveBeenCalledWith(null, 'task')
    expect(props.onEditTask).toHaveBeenCalledWith(saved)
    expect(saved.phase_id).toBe('queued')
    noWrites()
  })

  it('saves a pending phase only once and prevents closing before the result', async () => {
    let resolve!: (value: boolean) => void
    store.update = vi.fn(() => new Promise<boolean>(done => { resolve = done }))
    await render(); await openEditor()
    await act(async () => { button('Save phase').click(); button('Save phase').click() })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(button('Saving…').disabled).toBe(true)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(dialog()).toBeTruthy()
    await act(async () => { resolve(true) })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })
})
