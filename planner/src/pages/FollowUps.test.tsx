// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { FollowUp, PlanningStore } from '../lib/planningTypes'
import { FollowUps } from './FollowUps'

let store: Store, planning: PlanningStore, container: HTMLDivElement, root: Root
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/planningStore', () => ({ usePlanning: () => planning }))
vi.mock('../components/FollowUpEditor', () => ({ FollowUpEditor: ({ followUp, defaults, onClose }: { followUp?: FollowUp; defaults?: { job_id?: string }; onClose: () => void }) => <div role="dialog" data-job={followUp?.job_id ?? defaults?.job_id}>{followUp?.title ?? 'New follow-up'}<button onClick={onClose}>Cancel editor</button></div> }))
function follow(patch: Partial<FollowUp> = {}): FollowUp { return { id: 'today', revision: 3, created_at: '', updated_at: '', job_id: 'job', invoice_id: null, title: 'Call architect', waiting_on: 'Architect', reason: 'Missing roof height', status: 'open', next_follow_up_date: '2026-10-19', promised_date: '2026-10-22', invoice_due_date: null, contact_log: [{ id: 'contact', date: '2026-10-18', note: 'Left a message' }], notes: '', ...patch } }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T23:30:00')); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  store = { jobs: [{ id: 'job', name: 'Cedar residence', job_number: 'SYN-001' }, { id: 'closed', name: 'Finished project', job_number: 'SYN-002' }], invoices: [{ id: 'invoice', job_id: 'closed', number: 'SYN-I', amount: 500, paid_date: null }] } as Store
  planning = { reviews: [], followUps: [follow(), follow({ id: 'past', title: 'Collect payment', job_id: 'closed', invoice_id: 'invoice', next_follow_up_date: '2026-10-18', invoice_due_date: '2026-10-20' }), follow({ id: 'undated', title: 'Undated check-in', job_id: null, next_follow_up_date: null }), follow({ id: 'done', title: 'Completed call', status: 'done' })], availability: [], blocks: [], jobPlanning: [], decisions: [], events: [], loading: false, error: null, refresh: vi.fn(async () => {}), save: vi.fn(async () => null), remove: vi.fn(async () => false), applyMoves: vi.fn(async () => false) } as PlanningStore
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })
function Probe() { const location = useLocation(); return <output data-testid="location">{location.search}</output> }
async function render(url = '/follow-ups') { await act(async () => root.render(<MemoryRouter initialEntries={[url]}><FollowUps /><Probe /></MemoryRouter>)) }
function button(label: string) { const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label); if (!found) throw new Error(`Missing button ${label}`); return found }
async function change(label: string, value: string) { const control = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!; const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
function titles() { return [...container.querySelectorAll('.follow-up-title')].map(button => button.textContent) }
function query() { return new URLSearchParams(container.querySelector('[data-testid="location"]')?.textContent ?? '') }
describe('FollowUps shared list', () => {
  it('shows open job and general follow-ups with last-contact and distinct promise/due dates without writes', async () => {
    await render()
    expect(titles()).toEqual(['Collect payment', 'Call architect', 'Undated check-in'])
    expect(container.querySelector('a[href="/jobs/closed"]')).toBeTruthy()
    expect(container.querySelector('a[href="/billing?job=closed&section=invoices"]')).toBeTruthy()
    expect(container.textContent).toContain('Last contact Oct 18: Left a message')
    expect(container.textContent).toContain('Promised'); expect(container.textContent).toContain('Invoice due')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('restores URL filters, preserves raw search spaces and unrelated parameters, and resets explicitly', async () => {
    await render('/follow-ups?status=all&job=closed&due=overdue&q=payment&source=review')
    expect(titles()).toEqual(['Collect payment'])
    await change('Search follow-ups', 'payment ')
    expect(query().get('q')).toBe('payment '); expect(query().get('status')).toBe('all'); expect(query().get('source')).toBe('review')
    await act(async () => button('Reset filters').click())
    expect(titles()).toHaveLength(3); expect(query().toString()).toBe('source=review')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('uses local today and undated filters and gives a usable empty result', async () => {
    await render(); await change('Filter follow-ups by date', 'today')
    expect(titles()).toEqual(['Call architect'])
    await change('Filter follow-ups by date', 'undated'); expect(titles()).toEqual(['Undated check-in'])
    await change('Search follow-ups', 'not present'); expect(container.textContent).toContain('No follow-ups match these filters')
  })
  it('guards concurrent Done clicks, sends the saved revision, and retains the row on failure', async () => {
    let finish!: (row: FollowUp | null) => void
    vi.mocked(planning.save).mockImplementationOnce(() => new Promise(done => { finish = done }))
    await render(); await act(async () => { button('Mark done: Call architect').click(); button('Mark done: Call architect').click() })
    expect(planning.save).toHaveBeenCalledExactlyOnceWith('follow_ups', { id: 'today', status: 'done' }, 3)
    await act(async () => finish(null))
    expect(titles()).toContain('Call architect'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('not saved')
    expect(button('Mark done: Call architect').disabled).toBe(false)
  })
  it('reopens a completed follow-up without editing its contact history or job', async () => {
    await render('/follow-ups?status=done'); expect(titles()).toEqual(['Completed call'])
    await act(async () => button('Reopen: Completed call').click())
    expect(planning.save).toHaveBeenCalledWith('follow_ups', { id: 'done', status: 'open' }, 3)
  })
  it('opens existing/new scoped editors and cancels without a write', async () => {
    await render('/follow-ups?job=closed')
    await act(async () => button('New follow-up').click())
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-job')).toBe('closed')
    await act(async () => button('Cancel editor').click())
    await act(async () => button('Edit follow-up: Collect payment').click())
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Collect payment')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('distinguishes unavailable shared data from an empty business', async () => {
    planning = { ...planning, followUps: [], error: 'Synthetic unavailable' }
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded')
    expect(container.textContent).not.toContain('No follow-ups yet')
    expect(button('New follow-up').disabled).toBe(true)
  })
  it('keeps an open editor mounted through a refresh error and blocks status writes', async () => {
    await render(); await act(async () => button('Edit follow-up: Call architect').click())
    const editor = container.querySelector('[role="dialog"]')
    planning = { ...planning, error: 'Synthetic unavailable' }
    await render()
    expect(container.querySelector('[role="dialog"]')).toBe(editor)
    expect(button('Mark done: Call architect').disabled).toBe(true)
    expect(planning.save).not.toHaveBeenCalled()
  })
})
