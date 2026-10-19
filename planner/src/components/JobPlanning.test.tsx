// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { JobDecision, JobPlanning as SavedPlan, PlanningStore } from '../lib/planningTypes'
import { jobBilling } from '../lib/calc'
import { JobPlanning } from './JobPlanning'

let store: Store, planning: PlanningStore, root: Root, container: HTMLDivElement
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/planningStore', () => ({ usePlanning: () => planning }))
const date = '2026-10-19', stamp = `${date}T09:00:00Z`
const savedPlan = (): SavedPlan => ({ id: 'plan', job_id: 'job', revision: 3, created_at: stamp, updated_at: stamp, status_update: 'Waiting for field dimensions', next_deliverable: 'Foundation plan', remaining_hours: 4, internal_target_date: '2026-10-21', client_commitment_date: '2026-10-23' })
const savedDecision = (patch: Partial<JobDecision> = {}): JobDecision => ({ id: 'decision', job_id: 'job', revision: 2, created_at: stamp, updated_at: stamp, kind: 'scope_change', title: 'Add retaining wall', notes: 'Saved approval context', estimated_hours: 2, billing_treatment: 'billable', approval: 'needed', recorded_date: date, ...patch })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${date}T12:00:00`))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  store = { jobs: [{ id: 'job', client_id: 'client', name: 'Cedar', job_number: 'SYN', priority: 1, status: 'active', address: '', description: '', fee: 1000, queued_date: null, start_date: null, due_date: null, created_at: stamp }], profiles: [{ id: 'owner', hourly_rate: 999 }], settings: { default_rate: 999 },
    timeEntries: [{ id: 'billable', job_id: 'job', hours: 2, billable: true, rate: 100, date, billed: false, invoice_id: null, deposit_applied: null, started_at: null, created_at: stamp }, { id: 'nb', job_id: 'job', hours: 2, billable: false, rate: 50, date, billed: false, invoice_id: null, deposit_applied: null, started_at: null, created_at: stamp }], invoices: [{ id: 'invoice', job_id: 'job', amount: 800, paid_date: null }], deposits: [], items: [], update: vi.fn(), insert: vi.fn(), remove: vi.fn() } as unknown as Store
  planning = { jobPlanning: [savedPlan()], decisions: [savedDecision(), savedDecision({ id: 'other', job_id: 'different', title: 'Unrelated' })], followUps: [], reviews: [], availability: [], blocks: [], events: [], loading: false, error: null, save: vi.fn(async () => null), remove: vi.fn(async () => false), refresh: vi.fn(async () => {}), applyMoves: vi.fn(async () => false) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers() })
async function render() { await act(async () => root.render(<MemoryRouter><JobPlanning jobId="job" /></MemoryRouter>)) }
function button(label: string) { const match = [...container.querySelectorAll('button')].find(row => (row.getAttribute('aria-label') ?? row.textContent) === label); if (!match) throw new Error(`Missing button: ${label}`); return match }
function field(label: string) { const match = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input,select,textarea')].find(row => [...row.labels ?? []].some(element => { const copy = element.cloneNode(true) as HTMLElement; copy.querySelectorAll('input,select,textarea').forEach(control => control.remove()); return copy.textContent === label })); if (!match) throw new Error(`Missing field: ${label}`); return match }
async function change(label: string, value: string) { const input = field(label); const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
function noFinancialWrites() { expect(store.update).not.toHaveBeenCalled(); expect(store.insert).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }

describe('JobPlanning', () => {
  it('opens read-only context without writes and preserves saved-rate/nonbillable profitability', async () => {
    const before = jobBilling(store, store.jobs[0])
    await render()
    expect(container.querySelector('#job-planning')).toBeTruthy()
    expect(container.textContent).toContain('Foundation plan')
    expect(container.textContent).toContain('$200/h recorded hourly return')
    expect(container.textContent).toContain('2h nonbillable')
    expect(container.textContent).not.toContain('Unrelated')
    expect(planning.save).not.toHaveBeenCalled(); noFinancialWrites()
    expect(jobBilling(store, store.jobs[0])).toEqual(before)
  })
  it('saves the manual estimate and distinct dates with the original revision only', async () => {
    await render(); await act(async () => button('Edit plan').click())
    await change('Remaining work estimate (hours)', '0'); await change('Next deliverable', 'Stamped foundation plan')
    await submit()
    expect(planning.save).toHaveBeenCalledWith('job_planning', expect.objectContaining({ id: 'plan', job_id: 'job', remaining_hours: 0, next_deliverable: 'Stamped foundation plan', internal_target_date: '2026-10-21', client_commitment_date: '2026-10-23' }), 3)
    expect(field('Next deliverable').value).toBe('Stamped foundation plan')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('draft is still here')
    noFinancialWrites()
  })
  it('keeps a dirty plan when a newer revision arrives and requires reviewing it', async () => {
    await render(); await act(async () => button('Edit plan').click()); await change('Status update', 'My local draft')
    planning.jobPlanning = [{ ...savedPlan(), revision: 4, status_update: 'A newer saved update' }]; await render()
    expect(field('Status update').value).toBe('My local draft')
    expect(button('Save plan').disabled).toBe(true)
    await submit(); expect(planning.save).not.toHaveBeenCalled()
    await act(async () => button('Cancel').click())
    expect(container.textContent).toContain('A newer saved update')
  })
  it('uses one new ID across retry, keeps a rejected draft and guards duplicate saves/cancel', async () => {
    planning.jobPlanning = []
    let resolve: (value: null) => void = () => {}
    vi.mocked(planning.save).mockImplementationOnce(() => new Promise<null>(done => { resolve = done }))
    await render(); await act(async () => button('Edit plan').click()); await change('Next deliverable', 'First issue')
    await submit(); await submit()
    expect(planning.save).toHaveBeenCalledTimes(1); expect(button('Cancel').matches(':disabled')).toBe(true)
    const firstId = vi.mocked(planning.save).mock.calls[0][1].id
    await act(async () => resolve(null))
    await submit()
    expect(vi.mocked(planning.save).mock.calls[1][1].id).toBe(firstId)
    expect(field('Next deliverable').value).toBe('First issue')
  })
  it('records billing intent and approval without generating hours or charges', async () => {
    vi.mocked(planning.save).mockImplementationOnce(async (_table, row) => ({ ...savedDecision(), ...row }) as never)
    await render(); await act(async () => button('Record decision or change').click())
    await change('Title', 'Additional beam design'); await change('Notes', 'Owner requested this after issue.'); await change('Estimated effort (hours)', '3.5'); await change('Billing treatment', 'billable'); await change('Approval', 'approved'); await submit()
    expect(planning.save).toHaveBeenCalledWith('job_decisions', expect.objectContaining({ job_id: 'job', kind: 'scope_change', title: 'Additional beam design', estimated_hours: 3.5, billing_treatment: 'billable', approval: 'approved', recorded_date: date }), undefined)
    expect(container.querySelector('form')).toBeNull(); noFinancialWrites()
    expect(container.textContent).toContain('Hours and billing were not changed')
  })
  it('retains edit notes on thrown save and prevents overwriting a newer decision', async () => {
    vi.mocked(planning.save).mockRejectedValueOnce(new Error('Synthetic disconnect'))
    await render(); await act(async () => button('Edit record: Add retaining wall').click()); await change('Notes', 'Do not lose these notes'); await submit()
    expect(field('Notes').value).toBe('Do not lose these notes')
    expect(vi.mocked(planning.save).mock.calls[0][2]).toBe(2)
    planning.decisions[0] = { ...savedDecision(), revision: 3, notes: 'Saved elsewhere' }; await render()
    expect(field('Notes').value).toBe('Do not lose these notes'); expect(button('Save record').disabled).toBe(true)
    await submit(); expect(planning.save).toHaveBeenCalledTimes(1)
  })
  it('does not create a replacement when an existing plan is removed during editing', async () => {
    await render(); await act(async () => button('Edit plan').click()); planning.jobPlanning = []; await render(); await submit()
    expect(planning.save).not.toHaveBeenCalled(); expect(field('Next deliverable').value).toBe('Foundation plan')
  })
  it('preserves a dirty plan through a planning-refresh error and recovery', async () => {
    await render(); await act(async () => button('Edit plan').click()); await change('Status update', 'Offline draft stays here')
    planning.error = 'Synthetic refresh failure'; await render()
    expect(field('Status update').value).toBe('Offline draft stays here'); expect(button('Save plan').disabled).toBe(true)
    planning.error = null; await render()
    expect(field('Status update').value).toBe('Offline draft stays here'); expect(button('Save plan').disabled).toBe(false)
    expect(planning.save).not.toHaveBeenCalled(); noFinancialWrites()
  })
  it('names every planning control explicitly independent of saved values and select options', async () => {
    await render(); await act(async () => button('Edit plan').click())
    for (const label of ['Status update', 'Next deliverable', 'Remaining work estimate (hours)', 'Internal target date', 'Client commitment date']) expect(field(label).getAttribute('aria-label')).toBe(label)
    await act(async () => button('Cancel').click()); await act(async () => button('Edit record: Add retaining wall').click())
    for (const label of ['Record type', 'Recorded date', 'Title', 'Notes', 'Estimated effort (hours)', 'Billing treatment', 'Approval']) expect(field(label).getAttribute('aria-label')).toBe(label)
    expect(planning.save).not.toHaveBeenCalled(); noFinancialWrites()
  })
})
