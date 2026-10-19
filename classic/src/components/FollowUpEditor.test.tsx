// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { FollowUp, PlanningStore } from '../lib/planningTypes'
import { FollowUpEditor, type FollowUpEditorProps } from './FollowUpEditor'

let store: Store, planning: PlanningStore, container: HTMLDivElement, root: Root
let props: FollowUpEditorProps
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/planningStore', () => ({ usePlanning: () => planning }))
function follow(patch: Partial<FollowUp> = {}): FollowUp { return { id: 'follow', revision: 4, created_at: '', updated_at: '', job_id: 'job', invoice_id: null, title: 'Get dimensions', waiting_on: 'Architect', reason: 'Missing roof height', status: 'open', next_follow_up_date: '2026-10-19', promised_date: null, invoice_due_date: null, contact_log: [], notes: '', ...patch } }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T10:00:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  store = { jobs: [{ id: 'job', name: 'Cedar residence', job_number: 'SYN-001', status: 'active' }, { id: 'closed', name: 'Finished job', status: 'complete' }, { id: 'archived', name: 'Archived job', status: 'archived' }], invoices: [], toast: vi.fn() } as unknown as Store
  planning = { reviews: [], followUps: [], availability: [], blocks: [], jobPlanning: [], decisions: [], events: [], loading: false, error: null, refresh: vi.fn(async () => {}), save: vi.fn(async () => null), remove: vi.fn(async () => false), applyMoves: vi.fn(async () => false) } as PlanningStore
  props = { onClose: vi.fn() }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers() })
async function render(patch: Partial<FollowUpEditorProps> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<FollowUpEditor {...props} />)) }
function field(label: string) { const found = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`); if (!found) throw new Error(`Missing field ${label}`); return found }
function button(label: string) { const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label); if (!found) throw new Error(`Missing button ${label}`); return found }
async function change(label: string, value: string) { const control = field(label), prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })) }) }
async function save() { await act(async () => button('Save follow-up').click()) }

describe('FollowUpEditor shared drafts', () => {
  it('opens without writes, limits new job choices to open work, and cancels without saving', async () => {
    await render()
    expect([...((field('Follow-up job') as HTMLSelectElement).options)].map(option => option.value)).toEqual(['', 'job'])
    await change('Follow-up title', 'A local draft')
    await act(async () => button('Cancel').click())
    expect(props.onClose).toHaveBeenCalledTimes(1); expect(planning.save).not.toHaveBeenCalled()
  })
  it('allows a closed job with an unpaid invoice and opens an existing done tracker instead of creating another', async () => {
    store.invoices = [{ id: 'invoice', job_id: 'closed', number: 'SYN-I', amount: 500, paid_date: null }] as Store['invoices']
    const original = follow({ job_id: 'closed', invoice_id: 'invoice', status: 'done' }); planning.followUps = [original]
    await render({ defaults: { invoice_id: 'invoice', job_id: 'closed', title: 'New duplicate' } })
    expect(container.querySelector('h2')?.textContent).toBe('Edit follow-up')
    expect(field('Follow-up title').value).toBe('Get dimensions'); expect(field('Follow-up status').value).toBe('done')
    expect(field('Follow-up job').value).toBe('closed')
    await save()
    expect(planning.save).toHaveBeenCalledWith('follow_ups', expect.objectContaining({ id: 'follow', invoice_id: 'invoice', status: 'done' }), 4)
  })
  it('preserves contact history and saves a newly recorded contact and promise together', async () => {
    const original = follow({ contact_log: [{ id: 'first', date: '2026-10-18', note: 'Emailed the architect' }] }); planning.followUps = [original]
    await render({ followUp: original })
    await change('Contact note', 'Architect promised a reply'); await change('Contact promised date', '2026-10-22')
    await save()
    const payload = vi.mocked(planning.save).mock.calls[0][1] as FollowUp
    expect(payload.contact_log).toHaveLength(2)
    expect(payload.contact_log[0]).toEqual(original.contact_log[0])
    expect(payload.contact_log[1]).toMatchObject({ date: '2026-10-19', note: 'Architect promised a reply', promised_date: '2026-10-22' })
    expect(payload.promised_date).toBe('2026-10-22')
    expect(original.contact_log).toHaveLength(1)
  })
  it('keeps one stable new record ID and one appended contact across failed retries', async () => {
    await render(); await change('Follow-up title', 'Call the client'); await change('Contact note', 'Left voicemail')
    await save(); await save()
    expect(planning.save).toHaveBeenCalledTimes(2)
    const first = vi.mocked(planning.save).mock.calls[0][1] as FollowUp, second = vi.mocked(planning.save).mock.calls[1][1] as FollowUp
    expect(first.id).toBe(second.id); expect(first.contact_log).toEqual(second.contact_log); expect(second.contact_log).toHaveLength(1)
    expect(field('Follow-up title').value).toBe('Call the client'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('draft is still here')
    expect(props.onClose).not.toHaveBeenCalled()
  })
  it('validates title and future contact dates before making a write', async () => {
    await render(); await save()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('title')
    await change('Follow-up title', 'Call the client'); await change('Contact note', 'Future conversation'); await change('Contact date', '2026-10-20'); await save()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('through today')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('keeps a promise draft until a contact note is provided', async () => {
    await render(); await change('Follow-up title', 'Call the client'); await change('Contact promised date', '2026-10-22'); await save()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('contact note')
    expect(field('Contact promised date').value).toBe('2026-10-22'); expect(planning.save).not.toHaveBeenCalled()
  })
  it('locks duplicate saves and all close paths while a confirmed save is pending', async () => {
    let resolve!: (value: FollowUp | null) => void
    vi.mocked(planning.save).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    await render(); await change('Follow-up title', 'Call the client')
    await act(async () => { button('Save follow-up').click(); button('Save follow-up').click() })
    expect(planning.save).toHaveBeenCalledTimes(1); expect(button('Saving…').disabled).toBe(true)
    await act(async () => { button('Close').click(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(props.onClose).not.toHaveBeenCalled()
    await act(async () => resolve(follow()))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })
  it('retains a draft after a thrown save', async () => {
    vi.mocked(planning.save).mockRejectedValueOnce(new Error('Synthetic offline'))
    await render(); await change('Follow-up title', 'Keep this draft'); await save()
    expect(field('Follow-up title').value).toBe('Keep this draft'); expect(button('Save follow-up').disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not confirm')
    expect(props.onClose).not.toHaveBeenCalled()
  })
  it('keeps a stale partner draft and requires explicit reload before writing the new revision', async () => {
    const original = follow(); planning.followUps = [original]
    await render({ followUp: original }); await change('Follow-up title', 'My unsaved draft')
    planning = { ...planning, followUps: [follow({ revision: 5, title: 'Partner saved update' })] }
    await render(); expect(field('Follow-up title').value).toBe('My unsaved draft')
    await save(); expect(planning.save).not.toHaveBeenCalled()
    await act(async () => button('Load saved version (replaces draft)').click())
    expect(field('Follow-up title').value).toBe('Partner saved update')
    await save(); expect(planning.save).toHaveBeenCalledWith('follow_ups', expect.objectContaining({ id: 'follow', title: 'Partner saved update' }), 5)
  })
  it('handles an invoice tracker created by a partner while a new draft was open', async () => {
    store.invoices = [{ id: 'invoice', job_id: 'job', number: 'SYN-I', amount: 500, paid_date: null }] as Store['invoices']
    await render({ defaults: { invoice_id: 'invoice', title: 'My collection draft' } })
    planning = { ...planning, followUps: [follow({ invoice_id: 'invoice', title: 'Shared tracker' })] }
    await render(); expect(field('Follow-up title').value).toBe('My collection draft')
    await save(); expect(planning.save).not.toHaveBeenCalled()
    expect(container.textContent).toContain('already has a shared follow-up')
    await act(async () => button('Load saved version (replaces draft)').click())
    expect(field('Follow-up title').value).toBe('Shared tracker')
  })
  it('keeps the editor and local draft when a shared refresh fails', async () => {
    await render(); await change('Follow-up title', 'Keep this working draft')
    planning = { ...planning, error: 'Synthetic unavailable' }
    await render()
    expect(field('Follow-up title').value).toBe('Keep this working draft')
    expect(button('Save follow-up').disabled).toBe(true)
    await act(async () => button('Retry loading follow-ups').click())
    expect(planning.refresh).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled(); expect(planning.save).not.toHaveBeenCalled()
  })
})
