// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { DailyReview, FollowUp, PlanningEvent, PlanningStore } from '../lib/planningTypes'
import { MorningReview } from './MorningReview'

let store: Store, planning: PlanningStore, container: HTMLDivElement, root: Root
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/planningStore', () => ({ usePlanning: () => planning }))
vi.mock('../components/FollowUpEditor', () => ({ FollowUpEditor: ({ followUp, onClose }: { followUp: FollowUp; onClose: () => void }) => <div role="dialog">{followUp.title}<button onClick={onClose}>Cancel follow-up</button></div> }))
const local = (date = '2026-10-19', time = '09:00:00') => new Date(`${date}T${time}`).toISOString()
function review(patch: Partial<DailyReview> = {}): DailyReview { return { id: 'review', revision: 1, created_at: local(), updated_at: local(), review_date: '2026-10-19', checkpoint_at: local(), completed_at: null, notes: 'Shared saved notes', priorities: [{ id: 'priority', title: 'Finish Cedar', job_id: 'job', done: false }], ...patch } }
function event(patch: Partial<PlanningEvent> = {}): PlanningEvent { return { id: 'event', occurred_at: local('2026-10-19', '08:30:00'), actor_id: 'partner', entity_type: 'tasks', entity_id: 'task', job_id: 'job', action: 'update', summary: 'Task status changed', changed_fields: ['status'], ...patch } }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T09:00:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  store = { jobs: [{ id: 'job', client_id: 'client', name: 'Cedar residence', job_number: 'SYN-001', status: 'active', priority: 1, created_at: '2026-10-01T12:00:00Z', due_date: null }], clients: [{ id: 'client', name: 'Synthetic Builders' }], phases: [], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [], profiles: [], settings: { default_rate: 125, weekly_capacity: 40 }, me: { weekly_hours: 40 }, toast: vi.fn(), update: vi.fn(), insert: vi.fn(), remove: vi.fn() } as unknown as Store
  planning = { reviews: [], followUps: [], availability: [], blocks: [], jobPlanning: [], decisions: [], events: [], loading: false, error: null, refresh: vi.fn(async () => {}), save: vi.fn(async () => null), remove: vi.fn(async () => false), applyMoves: vi.fn(async () => false) } as PlanningStore
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })
async function render(url = '/review') { await act(async () => root.render(<MemoryRouter initialEntries={[url]}><MorningReview /></MemoryRouter>)) }
function button(label: string) { const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label); if (!match) throw new Error(`Missing button ${label}`); return match }
function field(label: string) { const match = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`); if (!match) throw new Error(`Missing field ${label}`); return match }
async function change(label: string, value: string) { const control = field(label), prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })) }) }
function confirmSaves() {
  vi.mocked(planning.save).mockImplementation(async (_table, row, revision) => {
    const confirmed = review({ ...row, id: row.id, revision: (revision ?? 0) + 1, checkpoint_at: planning.reviews.find(review => review.id === row.id)?.checkpoint_at ?? local('2026-10-19', '09:00:01') } as Partial<DailyReview>)
    planning = { ...planning, reviews: [...planning.reviews.filter(review => review.id !== confirmed.id), confirmed] }
    return confirmed as never
  })
}

describe('MorningReview shared daily workspace', () => {
  it('opens a local-day draft with useful agenda links and makes no automatic writes', async () => {
    await render()
    expect(field('Review date').value).toBe('2026-10-19')
    expect(container.querySelectorAll('.review-priority-list li')).toHaveLength(3)
    expect(container.querySelector('a[href="/availability?date=2026-10-19"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Review agenda"]')?.textContent).toContain('8h available')
    await change('Review notes', 'Only a draft')
    expect(planning.save).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled()
  })
  it('carries only unfinished items from the last prior review and deduplicates repeated carry clicks', async () => {
    const previous = review({ id: 'prior', review_date: '2026-10-18', priorities: [{ id: 'carried', source_id: 'original', title: 'Call architect', job_id: 'job', done: false }, { id: 'done', title: 'Sent drawings', job_id: 'job', done: true }] })
    planning.reviews = [review({ id: 'older', review_date: '2026-10-17', priorities: [{ id: 'old', title: 'Do not carry', job_id: null, done: false }] }), previous]
    await render(); await act(async () => button('Carry unfinished (1)').click())
    expect(container.querySelectorAll('.review-priority-list li')).toHaveLength(1)
    expect(field('Priority 1').value).toBe('Call architect')
    expect(button('Carry unfinished (0)').disabled).toBe(true)
    await act(async () => button('Save review').click())
    expect(planning.save).toHaveBeenCalledWith('daily_reviews', expect.objectContaining({ priorities: [expect.objectContaining({ title: 'Call architect', source_id: 'original', job_id: 'job', done: false })] }), undefined)
    expect(previous.priorities[0].id).toBe('carried')
  })
  it('keeps activity after an incomplete saved review available on the next day', async () => {
    planning.reviews = [review({ id: 'prior', review_date: '2026-10-18', checkpoint_at: local('2026-10-18'), completed_at: null })]
    planning.events = [event({ id: 'evening', occurred_at: local('2026-10-18', '17:00:00'), summary: 'Work moved yesterday evening' })]
    await render()
    expect(container.querySelector('.review-activity-list')?.textContent).toContain('Work moved yesterday evening')
    expect(container.querySelector('.review-activity')?.textContent).toContain('After the Oct 18 review checkpoint')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('lets the checkbox label toggle a priority through its larger touch target without saving', async () => {
    await render()
    const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Priority 1 done"]')!
    const target = checkbox.closest<HTMLLabelElement>('label.review-priority-check')!
    expect(target).toBeTruthy()
    await act(async () => target.click())
    expect(checkbox.checked).toBe(true)
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('freezes at the server first-save checkpoint and preserves meeting changes for the next completed review window', async () => {
    planning.reviews = [review({ id: 'prior', review_date: '2026-10-18', checkpoint_at: local('2026-10-18'), completed_at: local('2026-10-18', '09:30:00') })]
    planning.events = [event(), event({ id: 'meeting', occurred_at: local('2026-10-19', '09:15:00'), summary: 'Meeting schedule change' })]
    confirmSaves(); await render(); await change('Priority 1', 'Deliver plans')
    await act(async () => button('Save review').click())
    const first = vi.mocked(planning.save).mock.calls[0][1]
    expect(first).not.toHaveProperty('checkpoint_at')
    vi.setSystemTime(new Date('2026-10-19T09:30:00'))
    await act(async () => button('Complete review').click())
    expect(vi.mocked(planning.save).mock.calls[1][1]).toMatchObject({ checkpoint_at: local('2026-10-19', '09:00:01'), completed_at: local('2026-10-19', '09:30:00') })
    expect(container.querySelector('.review-activity-list')?.textContent).not.toContain('Meeting schedule change')
    expect(container.textContent).toContain('Review completed')
    vi.setSystemTime(new Date('2026-10-20T09:00:00'))
    await change('Review date', '2026-10-20')
    expect(container.querySelector('.review-activity-list')?.textContent).toContain('Meeting schedule change')
  })
  it('retains an unsaved partner draft until an explicit reload of the shared revision', async () => {
    planning.reviews = [review()]
    await render(); await change('Review notes', 'My unsaved decisions')
    planning = { ...planning, reviews: [review({ revision: 2, notes: 'Partner saved decisions' })] }
    await render(); expect(field('Review notes').value).toBe('My unsaved decisions')
    await act(async () => button('Save review').click())
    expect(planning.save).not.toHaveBeenCalled()
    await act(async () => button('Load saved version (replaces draft)').click())
    expect(field('Review notes').value).toBe('Partner saved decisions')
    await act(async () => button('Save review').click())
    expect(planning.save).toHaveBeenCalledWith('daily_reviews', expect.anything(), 2)
  })
  it('keeps the same draft ID and notes after a failed first save', async () => {
    await render(); await change('Review notes', 'Keep these decisions')
    await act(async () => button('Save review').click()); await act(async () => button('Save review').click())
    expect(vi.mocked(planning.save).mock.calls[0][1].id).toBe(vi.mocked(planning.save).mock.calls[1][1].id)
    expect(field('Review notes').value).toBe('Keep these decisions')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('draft is still here')
  })
  it('keeps the dirty review mounted when a shared refresh reports an error', async () => {
    await render(); await change('Review notes', 'Keep the shared decisions draft')
    const original = field('Review notes')
    planning = { ...planning, error: 'Synthetic unavailable' }
    await render()
    expect(field('Review notes')).toBe(original); expect(field('Review notes').value).toBe('Keep the shared decisions draft')
    expect(button('Save review').disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('guards concurrent Save and Complete actions and releases them after a thrown request', async () => {
    let reject!: (error: Error) => void
    vi.mocked(planning.save).mockImplementationOnce(() => new Promise((_resolve, failed) => { reject = failed }))
    await render(); await change('Review notes', 'Still here')
    await act(async () => { button('Save review').click(); button('Complete review').click() })
    expect(planning.save).toHaveBeenCalledTimes(1); expect(button('Complete review').disabled).toBe(true)
    await act(async () => reject(new Error('Synthetic offline')))
    expect(button('Save review').disabled).toBe(false); expect(field('Review notes').value).toBe('Still here')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not confirm')
  })
  it('opens historical shared notes read-only and requires an explicit edit action', async () => {
    planning.reviews = [review({ review_date: '2026-10-18', completed_at: local('2026-10-18', '09:30:00'), notes: 'Both agreed on this' })]
    await render('/review?date=2026-10-18')
    expect(container.querySelector('[aria-label="Review notes"]')).toBeNull()
    expect(container.querySelector('.review-saved-notes')?.textContent).toBe('Both agreed on this')
    await act(async () => button('Edit saved review').click())
    expect(field('Review notes').value).toBe('Both agreed on this')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('does not create an empty historical review on opening a date without saved history', async () => {
    await render('/review?date=2026-10-18')
    expect(container.textContent).toContain('No review was saved on this date')
    expect(container.querySelector('[aria-label="Review notes"]')).toBeNull()
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('distinguishes operational commitments, internal targets, and approval decisions', async () => {
    store.jobs.push({ ...store.jobs[0], id: 'closed', name: 'Finished job', status: 'complete' })
    planning.jobPlanning = [{ id: 'plan', job_id: 'job', client_commitment_date: '2026-10-21', internal_target_date: '2026-10-20' }, { id: 'closed-plan', job_id: 'closed', client_commitment_date: '2026-10-19', internal_target_date: null }] as PlanningStore['jobPlanning']
    planning.decisions = [{ id: 'decision', job_id: 'job', title: 'Approve added site visit', kind: 'scope_change', approval: 'needed', billing_treatment: 'undecided', recorded_date: '2026-10-19' }] as PlanningStore['decisions']
    await render()
    const agenda = container.querySelector('[aria-label="Review agenda"]')!.textContent
    expect(agenda).toContain('Client commitment · Oct 21'); expect(agenda).toContain('Internal target · Oct 20')
    expect(agenda).toContain('Approve added site visit'); expect(agenda).toContain('Approval needed')
    expect(agenda).not.toContain('Finished job')
    expect(planning.save).not.toHaveBeenCalled()
  })
})
