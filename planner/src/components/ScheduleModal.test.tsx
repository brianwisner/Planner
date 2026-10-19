// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Phase, ScheduleEntry } from '../lib/types'
import { ScheduleModal } from './ScheduleModal'

let store: Store, root: Root, container: HTMLDivElement
vi.mock('../lib/store', () => ({ useData: () => store }))
const today = '2026-10-19'
function phase(patch: Partial<Phase> = {}): Phase { return { id: 'design', job_id: 'job', kind: 'design', name: 'Design', status: 'in_progress', sort_order: 2, estimate_hours: 8, start_date: null, due_date: null, assignee_id: null, notes: '', ...patch } }
function plan(patch: Partial<ScheduleEntry> = {}): ScheduleEntry { return { id: 'saved', job_id: 'job', phase_id: 'history', user_id: 'owner', date: today, hours: 2, note: '', created_at: '', ...patch } }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const owner = { id: 'owner', full_name: 'Owner', email: null, color: '#123456', hourly_rate: 100, weekly_hours: 40, ics_token: '', created_at: '' }
  store = { session: null, me: owner, profiles: [owner], settings: { id: 1, company_name: 'Synthetic', default_rate: 100, weekly_capacity: 40 }, clients: [],
    jobs: [{ id: 'job', client_id: 'client', job_number: '', name: 'Synthetic residence', description: '', address: '', status: 'active', priority: 1, fee: null, queued_date: null, start_date: null, due_date: null, created_at: '' }],
    phases: [phase({ id: 'history', kind: 'queued', name: 'Custom Queued name', sort_order: 1, estimate_hours: 80 }), phase()], tasks: [], timeEntries: [], invoices: [], deposits: [], items: [], comments: [], schedule: [],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(), insert: vi.fn(async () => null), update: vi.fn(async () => true), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() })
async function render(props: Partial<Parameters<typeof ScheduleModal>[0]> = {}) { const close = props.onClose ?? vi.fn(); await act(async () => root.render(<ScheduleModal jobId="job" phaseId="design" from={today} to={today} {...props} onClose={close} />)); return close }
function button(name: string | RegExp) { const found = [...container.querySelectorAll('button')].find(button => typeof name === 'string' ? button.textContent?.trim() === name : name.test(button.textContent?.trim() ?? '')); if (!found) throw new Error(`Missing button ${name}`); return found }
function hours(date = today) { return container.querySelector<HTMLInputElement>(`input[aria-label="Hours on ${date}"]`)! }
function control(label: string) { const field = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select')].find(control => [...control.labels ?? []].some(element => element.textContent?.trim() === label)); if (!field) throw new Error(`Missing ${label}`); return field }
async function change(field: HTMLInputElement | HTMLSelectElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
async function save() { await act(async () => button(/^Save /).click()) }
function noWrites() { expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }

describe('workflow and retained saved plans', () => {
  it('excludes retired choices for new work and defaults away from an empty passed history phase', async () => {
    await render({ phaseId: 'history' })
    expect(control('Phase').value).toBe('design')
    expect([...container.querySelectorAll('option')].map(option => option.value)).toEqual(['design', ''])
    expect(container.textContent).not.toContain('Custom Queued name')
    noWrites()
  })
  it('edits only existing owner dates in passed history, keeping new dates zero and other owners unchanged', async () => {
    store.schedule = [plan(), plan({ id: 'last', date: '2026-10-21', hours: 1 }), plan({ id: 'other', user_id: 'legacy', date: '2026-10-20', hours: 3 })]
    const close = await render({ phaseId: 'history', to: '2026-10-21' })
    expect(control('Phase').value).toBe('history')
    expect(hours().value).toBe('2')
    expect(hours('2026-10-20').value).toBe('0')
    expect(hours('2026-10-20').disabled).toBe(true)
    expect(container.textContent).toContain('Additional saved plans: 3h')
    expect(container.textContent).not.toContain('estimate 80h')
    await act(async () => button('4h').click())
    await save()
    expect(store.update).toHaveBeenCalledTimes(2)
    expect(store.update).toHaveBeenCalledWith('schedule_entries', 'saved', { hours: 4 })
    expect(store.update).toHaveBeenCalledWith('schedule_entries', 'last', { hours: 4 })
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
    expect(store.schedule[2]).toMatchObject({ user_id: 'legacy', hours: 3, phase_id: 'history' })
    expect(close).toHaveBeenCalledOnce()
  })
  it('keeps other-owner history visible without enabling a new owner plan on that phase', async () => {
    store.schedule = [plan({ user_id: 'legacy' })]
    await render({ phaseId: 'history' })
    expect(control('Phase').value).toBe('history')
    expect(hours().value).toBe('0')
    expect(hours().disabled).toBe(true)
    expect(button(/^Save /).disabled).toBe(true)
    expect(button('Clear these days').disabled).toBe(true)
    noWrites()
  })
  it('counts all additional active plans and excludes complete/on-hold work from daily capacity', async () => {
    store.jobs.push(...['complete', 'on_hold'].map((status, i) => ({ ...store.jobs[0], id: `closed-${i}`, status: status as 'complete' | 'on_hold' })))
    store.schedule = [plan({ user_id: 'legacy', hours: 3 }), plan({ id: 'complete', job_id: 'closed-0', hours: 20 }), plan({ id: 'held', job_id: 'closed-1', hours: 20 })]
    await render()
    await change(hours(), '4')
    expect(container.querySelector('.sched-day')?.textContent).toContain('+ 3h other active plans')
    expect(container.querySelector('.sched-day')?.textContent).not.toContain('over a full day')
    noWrites()
  })
  it('shows duplicate owner slots as combined readonly hours and never doubles them on Save', async () => {
    store.schedule = [plan(), plan({ id: 'duplicate', hours: 3 }), plan({ id: 'legacy', user_id: 'legacy', hours: 4 })]
    const close = await render({ phaseId: 'history' })
    expect(hours().value).toBe('5')
    expect(hours().readOnly).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('multiple plans')
    await save()
    noWrites()
    expect(close).toHaveBeenCalledOnce()
  })
  it('validates all numeric days before making any writes', async () => {
    const close = await render()
    await change(hours(), '-1')
    await save()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('zero and 24')
    noWrites()
    expect(close).not.toHaveBeenCalled()
  })
  it('does not let a readonly duplicate total above 24 block another editable day', async () => {
    store.schedule = [plan({ hours: 20 }), plan({ id: 'duplicate', hours: 20 }), plan({ id: 'tomorrow', date: '2026-10-20', hours: 1 })]
    const close = await render({ phaseId: 'history', to: '2026-10-20' })
    expect(hours().value).toBe('40')
    expect(hours().readOnly).toBe(true)
    await change(hours('2026-10-20'), '4')
    await save()
    expect(store.update).toHaveBeenCalledExactlyOnceWith('schedule_entries', 'tomorrow', { hours: 4 })
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('guarded save and clear failures', () => {
  it('guards pending saves and close actions, awaits a failed refresh and retains the draft', async () => {
    store.schedule = [plan({ phase_id: 'design' })]
    let resolve!: (success: boolean) => void
    vi.mocked(store.update).mockImplementation(() => new Promise(done => { resolve = done }))
    vi.mocked(store.refresh).mockRejectedValue(new Error('Offline refresh'))
    const close = await render()
    await change(hours(), '4')
    const submit = button(/^Save /)
    await act(async () => { submit.click(); submit.click(); button('Cancel').click() })
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(store.update).toHaveBeenCalledExactlyOnceWith('schedule_entries', 'saved', { hours: 4 })
    expect(close).not.toHaveBeenCalled()
    await act(async () => resolve(false))
    expect(store.refresh).toHaveBeenCalledWith('schedule_entries')
    expect(hours().value).toBe('4')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be saved')
    expect(store.toast).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
  it('retains the form after thrown writes even if refresh also rejects', async () => {
    vi.mocked(store.insert).mockRejectedValue(new Error('Write disconnected'))
    vi.mocked(store.refresh).mockRejectedValue(new Error('Refresh disconnected'))
    const close = await render()
    await change(hours(), '3')
    await save()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not confirm the save')
    expect(hours().value).toBe('3')
    expect(close).not.toHaveBeenCalled()
    expect(store.toast).not.toHaveBeenCalled()
  })
  it('stops a multi-day save at the first failure and reports possible earlier saved days', async () => {
    store.schedule = [plan({ phase_id: 'design' })]
    vi.mocked(store.insert).mockResolvedValue(null)
    const close = await render({ to: '2026-10-21' })
    await act(async () => button('4h').click())
    await save()
    expect(store.update).toHaveBeenCalledOnce()
    expect(store.insert).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Some earlier days may already be saved')
    expect(close).not.toHaveBeenCalled()
    expect(store.toast).not.toHaveBeenCalled()
  })
  it('guards clearing, retains failed drafts, and clears every owner duplicate while preserving other owners', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    store.schedule = [plan(), plan({ id: 'duplicate', hours: 3 }), plan({ id: 'legacy', user_id: 'legacy', hours: 9 })]
    let resolve!: (success: boolean) => void
    vi.mocked(store.remove).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    vi.mocked(store.refresh).mockRejectedValue(new Error('Offline refresh'))
    const close = await render({ phaseId: 'history' })
    const clear = button('Clear these days')
    await act(async () => { clear.click(); clear.click() })
    expect(confirm).toHaveBeenCalledOnce()
    expect(store.remove).toHaveBeenCalledOnce()
    await act(async () => resolve(false))
    expect(hours().value).toBe('5')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('could not be cleared')
    expect(close).not.toHaveBeenCalled()
    expect(store.toast).not.toHaveBeenCalled()
    await act(async () => button('Clear these days').click())
    expect(vi.mocked(store.remove).mock.calls.map(call => call[1])).toEqual(['saved', 'saved', 'duplicate'])
    expect(store.remove).not.toHaveBeenCalledWith('schedule_entries', 'legacy')
    expect(close).toHaveBeenCalledOnce()
  })
  it('retains saved plans after a thrown clear and unavailable refresh', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    store.schedule = [plan()]
    vi.mocked(store.remove).mockRejectedValue(new Error('Clear disconnected'))
    vi.mocked(store.refresh).mockRejectedValue(new Error('Refresh disconnected'))
    const close = await render({ phaseId: 'history' })
    await act(async () => button('Clear these days').click())
    expect(hours().value).toBe('2')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not confirm the clear')
    expect(close).not.toHaveBeenCalled()
    expect(store.toast).not.toHaveBeenCalled()
  })
})
