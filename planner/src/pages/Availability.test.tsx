// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { AvailabilityBlock, DailyAvailability, PlanningStore } from '../lib/planningTypes'
import type { ScheduleEntry } from '../lib/types'
import { Availability } from './Availability'

let store: Store, planning: PlanningStore, root: Root, container: HTMLDivElement
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/planningStore', () => ({ usePlanning: () => planning }))
vi.mock('../components/ScheduleModal', () => ({ ScheduleModal: () => <div role="dialog">Schedule editor</div> }))
const date = '2026-10-19', stamp = `${date}T09:00:00Z`
const override = (patch: Partial<DailyAvailability> = {}): DailyAvailability => ({ id: 'override', date, base_hours: 5, note: 'Saved daily context', revision: 2, created_at: stamp, updated_at: stamp, ...patch })
const block = (patch: Partial<AvailabilityBlock> = {}): AvailabilityBlock => ({ id: 'block', date, title: 'Site travel', kind: 'travel', hours: 1.5, note: 'Saved travel note', revision: 3, created_at: stamp, updated_at: stamp, ...patch })
const plan = (patch: Partial<ScheduleEntry> = {}): ScheduleEntry => ({ id: 'plan', job_id: 'job', phase_id: 'design', user_id: 'owner', date, hours: 4, note: 'Keep schedule context', created_at: stamp, ...patch })
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${date}T23:30:00`)); vi.spyOn(window, 'confirm').mockReturnValue(true)
  store = { me: { id: 'owner', weekly_hours: 40 }, settings: { weekly_capacity: 40 }, jobs: [{ id: 'job', name: 'Cedar', status: 'active', priority: 1 }, { id: 'other', name: 'Maple', status: 'active', priority: 2 }, { id: 'closed', name: 'Closed project', status: 'complete' }, { id: 'held', name: 'Held project', status: 'on_hold' }], phases: [{ id: 'design', job_id: 'job', kind: 'design', name: 'Design' }, { id: 'history', job_id: 'job', kind: 'queued', name: 'Legacy custom label' }], schedule: [plan()], toast: vi.fn(), refresh: vi.fn(async () => {}), insert: vi.fn(), update: vi.fn(), remove: vi.fn() } as unknown as Store
  planning = { followUps: [], jobPlanning: [], decisions: [], reviews: [], availability: [], blocks: [], events: [], loading: false, error: null, save: vi.fn(async () => null), remove: vi.fn(async () => false), refresh: vi.fn(async () => {}), applyMoves: vi.fn(async () => false) }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render(url = `/availability?date=${date}`) { await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Availability /></MemoryRouter>)) }
function button(label: string, scope: ParentNode = container) { const match = [...scope.querySelectorAll('button')].find(row => (row.getAttribute('aria-label') ?? row.textContent?.trim()) === label); if (!match) throw new Error(`Missing button: ${label}`); return match }
function field(label: string) { const match = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`); if (!match) throw new Error(`Missing field: ${label}`); return match }
async function change(label: string, value: string) { const input = field(label); const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
async function click(label: string) { await act(async () => button(label).click()) }
function modal() { return container.querySelector('[role="dialog"]') }
function noWrites() { expect(planning.save).not.toHaveBeenCalled(); expect(planning.remove).not.toHaveBeenCalled(); expect(planning.applyMoves).not.toHaveBeenCalled(); expect(store.insert).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled() }

describe('Availability daily hours and blocks', () => {
  it('loads with no writes and honors explicit weekday zero plus a working weekend override', async () => {
    planning.availability = [override({ base_hours: 0 }), override({ id: 'weekend', date: '2026-10-24', base_hours: 3 })]
    planning.blocks = [block({ hours: 2 })]
    await render()
    expect(button(`Availability for ${date}`).textContent).toContain('0h available')
    expect(button('Availability for 2026-10-24').textContent).toContain('3h available')
    expect(button('Availability for 2026-10-25').textContent).toContain('0h available')
    expect(container.textContent).toContain('Blocks exceed the base hours')
    noWrites()
  })
  it('saves an explicit zero with original revision and preserves a rejected draft', async () => {
    planning.availability = [override()]; await render(); await click('Set daily hours'); await change('Base hours', '0'); await change('Daily availability note', 'Day off draft'); await submit()
    expect(planning.save).toHaveBeenCalledWith('daily_availability', { id: 'override', date, base_hours: 0, note: 'Day off draft' }, 2)
    expect(modal()).toBeTruthy(); expect(field('Daily availability note').value).toBe('Day off draft')
    expect(modal()?.textContent).toContain('Your draft is kept')
  })
  it('preserves local daily edits on a colliding shared override and reloads its revision explicitly', async () => {
    await render(); await click('Set daily hours'); await change('Base hours', '6'); await change('Daily availability note', 'Local unsaved note')
    planning.availability = [override({ revision: 7, note: 'Saved in another session', base_hours: 2 })]; await render()
    expect(field('Daily availability note').value).toBe('Local unsaved note')
    await submit(); expect(modal()).toBeTruthy()
    await click('Reload saved version'); expect(field('Daily availability note').value).toBe('Saved in another session'); expect(field('Base hours').value).toBe('2')
    await submit(); expect(vi.mocked(planning.save).mock.calls.at(-1)).toEqual(['daily_availability', { id: 'override', date, base_hours: 2, note: 'Saved in another session' }, 7])
  })
  it('keeps one new override ID across retries and guards duplicate saves and closing while pending', async () => {
    let resolve: (value: null) => void = () => {}
    vi.mocked(planning.save).mockImplementationOnce(() => new Promise<null>(done => { resolve = done }))
    await render(); await click('Set daily hours'); await change('Base hours', '4'); await submit(); await submit()
    expect(planning.save).toHaveBeenCalledTimes(1); expect(button('Cancel').disabled).toBe(true)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(modal()).toBeTruthy()
    const id = vi.mocked(planning.save).mock.calls[0][1].id
    await act(async () => resolve(null)); await submit()
    expect(vi.mocked(planning.save).mock.calls[1][1].id).toBe(id)
    expect(field('Base hours').value).toBe('4')
  })
  it('keeps an open daily draft when a failed data refresh temporarily reports an error', async () => {
    planning.availability = [override()]
    await render(); await click('Set daily hours'); await change('Base hours', '6.5'); await change('Daily availability note', 'Do not lose this offline draft')
    planning.error = 'Synthetic refresh failure'; await render()
    planning.error = null; await render()
    expect(modal()).toBeTruthy(); expect(field('Base hours').value).toBe('6.5'); expect(field('Daily availability note').value).toBe('Do not lose this offline draft')
    noWrites()
  })
  it('guards override deletion with revision and retains it after an unconfirmed delete', async () => {
    planning.availability = [override()]; let resolve: (value: boolean) => void = () => {}
    vi.mocked(planning.remove).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    await render(); await click('Set daily hours'); await click('Use weekly default'); await click('Use weekly default')
    expect(planning.remove).toHaveBeenCalledTimes(1); expect(planning.remove).toHaveBeenCalledWith('daily_availability', 'override', 2)
    expect(button('Cancel').disabled).toBe(true)
    await act(async () => resolve(false)); expect(modal()).toBeTruthy(); expect(modal()?.textContent).toContain('could not be removed')
  })
  it('rejects zero, blank and excessive blocks before saving, then retains a valid rejected block', async () => {
    await render(); await click('Block time'); await change('Time block title', 'County appointment')
    for (const hours of ['0', '', '25', '-1']) { await change('Time block hours', hours); await submit() }
    expect(planning.save).not.toHaveBeenCalled()
    await change('Time block hours', '1.25'); await change('Time block note', 'Draft travel details'); await submit()
    expect(planning.save).toHaveBeenCalledWith('availability_blocks', expect.objectContaining({ date, title: 'County appointment', kind: 'appointment', hours: 1.25, note: 'Draft travel details' }), undefined)
    expect(modal()).toBeTruthy(); expect(field('Time block note').value).toBe('Draft travel details')
  })
  it('keeps block notes after a thrown edit, reloads latest saved context, and guards deletion', async () => {
    planning.blocks = [block()]; vi.mocked(planning.save).mockRejectedValueOnce(new Error('Synthetic disconnect'))
    await render(); await click('Edit block: Site travel'); await change('Time block note', 'My travel edit'); await submit()
    expect(field('Time block note').value).toBe('My travel edit')
    planning.blocks = [block({ revision: 4, note: 'Latest shared note' })]; await render(); expect(field('Time block note').value).toBe('My travel edit')
    await click('Reload saved version'); expect(field('Time block note').value).toBe('Latest shared note')
    let resolve: (value: boolean) => void = () => {}
    vi.mocked(planning.remove).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    await click('Remove block'); await click('Remove block'); expect(planning.remove).toHaveBeenCalledTimes(1)
    expect(planning.remove).toHaveBeenCalledWith('availability_blocks', 'block', 4)
    await act(async () => resolve(false)); expect(modal()).toBeTruthy(); expect(modal()?.textContent).toContain('could not be removed')
  })
})

describe('Availability schedule preview', () => {
  it('previews and discards without writes or mutating any saved plan context', async () => {
    const saved = structuredClone(store.schedule)
    await render(); await click(`Move plan for Cedar on ${date}`); await change('Preview date for plan plan', '2026-10-20'); await change('Preview hours for plan plan', '3')
    expect(button(`Availability for ${date}`).textContent).toContain('0h planned in preview')
    expect(button('Availability for 2026-10-20').textContent).toContain('3h planned in preview')
    noWrites(); expect(store.schedule).toEqual(saved)
    await click('Discard preview'); expect(container.querySelector('[aria-label="Schedule preview"]')).toBeNull(); expect(store.schedule).toEqual(saved); noWrites()
  })
  it('retains a failed atomic move preview and sends complete original job/phase/date/hour snapshots', async () => {
    await render(); await click(`Move plan for Cedar on ${date}`); await change('Preview date for plan plan', '2026-10-20'); await change('Preview hours for plan plan', '3.5'); await click('Save preview')
    expect(planning.applyMoves).toHaveBeenCalledWith([{ id: 'plan', expected_job_id: 'job', expected_phase_id: 'design', expected_date: date, expected_hours: 4, date: '2026-10-20', hours: 3.5 }])
    expect(field('Preview date for plan plan').value).toBe('2026-10-20'); expect(field('Preview hours for plan plan').value).toBe('3.5')
    expect(container.textContent).toContain('Your preview is kept'); expect(store.toast).not.toHaveBeenCalled(); expect(store.schedule[0]).toEqual(plan())
  })
  it('saves two moves as one request, guards duplicate submits, and clears only after confirmation', async () => {
    store.schedule.push(plan({ id: 'second', job_id: 'other', phase_id: null, hours: 2 }))
    let resolve: (value: boolean) => void = () => {}
    vi.mocked(planning.applyMoves).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    await render(); await click(`Move plan for Cedar on ${date}`); await change('Preview date for plan plan', '2026-10-20'); await click(`Move plan for Maple on ${date}`); await change('Preview date for plan second', '2026-10-21'); await click('Save preview')
    expect(planning.applyMoves).toHaveBeenCalledTimes(1); expect(vi.mocked(planning.applyMoves).mock.calls[0][0]).toHaveLength(2)
    expect(button('Saving moves…').disabled).toBe(true); expect(button('Discard preview').disabled).toBe(true)
    expect(field('Preview date for plan plan').disabled).toBe(true)
    await act(async () => resolve(true))
    expect(container.querySelector('[aria-label="Schedule preview"]')).toBeNull(); expect(store.refresh).toHaveBeenCalledWith('schedule_entries'); expect(store.toast).toHaveBeenCalledWith('Schedule changes saved')
    expect(store.update).not.toHaveBeenCalled()
  })
  it('blocks target collisions and stale original rows without applying the preview', async () => {
    store.schedule.push(plan({ id: 'occupied', date: '2026-10-20' }))
    await render(); await click(`Move plan for Cedar on ${date}`); await change('Preview date for plan plan', '2026-10-20')
    expect(container.textContent).toContain('already have a saved plan'); expect(button('Save preview').disabled).toBe(true)
    await change('Preview date for plan plan', '2026-10-21'); store.schedule[0] = { ...store.schedule[0], hours: 5 }; await render()
    expect(container.textContent).toContain('changed while this preview was open'); expect(field('Preview hours for plan plan').value).toBe('4'); noWrites()
  })
  it('keeps historical ownership, retired phases and inactive plans read-only and counts active commitments', async () => {
    store.schedule = [plan({ id: 'legacy', user_id: 'legacy', hours: 3 }), plan({ id: 'history', phase_id: 'history', hours: 2 }), plan({ id: 'closed', job_id: 'closed', phase_id: null, hours: 10 }), plan({ id: 'held', job_id: 'held', phase_id: null, hours: 8 })]
    await render(); expect(button(`Availability for ${date}`).textContent).toContain('5h planned')
    expect(container.querySelectorAll('.availability-plans tbody tr')).toHaveLength(2)
    const check = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => check.click()); expect(container.querySelectorAll('.availability-plans tbody tr')).toHaveLength(4)
    expect(container.textContent).toContain('Planning history'); expect(container.textContent).not.toContain('Legacy custom label')
    expect([...container.querySelectorAll('.availability-plans tbody button')].filter(row => row.textContent === 'Move')).toHaveLength(0)
    expect(container.querySelectorAll('.availability-plans tbody a[href="/jobs?view=gantt"]')).toHaveLength(4); noWrites()
  })
  it('prevents creating another preview while an atomic save is pending', async () => {
    store.schedule.push(plan({ id: 'second', job_id: 'other', phase_id: null }))
    let resolve: (value: boolean) => void = () => {}
    vi.mocked(planning.applyMoves).mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done }))
    await render(); await click(`Move plan for Cedar on ${date}`); await change('Preview date for plan plan', '2026-10-20'); await click('Save preview'); await click(`Move plan for Maple on ${date}`)
    expect(container.querySelector('[aria-label="Preview date for plan second"]')).toBeNull()
    await act(async () => resolve(true))
  })
})
