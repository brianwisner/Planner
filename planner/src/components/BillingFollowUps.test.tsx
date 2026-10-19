// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FollowUp, PlanningStore } from '../lib/planningTypes'
import type { Invoice } from '../lib/types'
import type { BillingJobRow } from '../lib/billingView'
import { BillingFollowUps } from './BillingFollowUps'

let planning: PlanningStore, root: Root, container: HTMLDivElement
vi.mock('../lib/planningStore', () => ({ usePlanning: () => planning }))
vi.mock('./FollowUpEditor', () => ({ FollowUpEditor: ({ followUp, defaults, onClose }: { followUp?: FollowUp; defaults: { invoice_id: string; job_id: string }; onClose: () => void }) => <div role="dialog" data-id={followUp?.id} data-invoice={defaults.invoice_id} data-job={defaults.job_id}><button onClick={onClose}>Close test editor</button></div> }))
const today = '2026-10-19', stamp = `${today}T09:00:00Z`
const invoice = (patch: Partial<Invoice> = {}): Invoice => ({ id: 'invoice', job_id: 'job', number: 'SYN-101', amount: 300, issued_date: '2026-10-01', paid_date: null, notes: '', created_at: stamp, ...patch })
const followUp = (patch: Partial<FollowUp> = {}): FollowUp => ({ id: 'tracker', revision: 2, created_at: stamp, updated_at: stamp, job_id: 'job', invoice_id: 'invoice', title: 'Payment', waiting_on: '', reason: '', status: 'open', next_follow_up_date: null, promised_date: null, invoice_due_date: null, contact_log: [], notes: '', ...patch })
const jobs = [{ job: { id: 'job', name: 'Completed project', status: 'complete' }, billing: { unbilledAmount: 100 }, clientName: 'Synthetic' }] as BillingJobRow[]
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${today}T23:30:00`))
  planning = { followUps: [], jobPlanning: [], decisions: [], reviews: [], availability: [], blocks: [], events: [], loading: false, error: null, save: vi.fn(), remove: vi.fn(), refresh: vi.fn(), applyMoves: vi.fn() }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers() })
async function render(invoices = [invoice()]) { await act(async () => root.render(<MemoryRouter><BillingFollowUps jobs={jobs} invoices={invoices} /></MemoryRouter>)) }
function button(label: string) { const match = [...container.querySelectorAll('button')].find(row => (row.getAttribute('aria-label') ?? row.textContent) === label); if (!match) throw new Error(`Missing button: ${label}`); return match }
describe('BillingFollowUps', () => {
  it('scopes debts to matched jobs, retains closed history, excludes paid/zero and never writes on opening', async () => {
    await render([invoice(), invoice({ id: 'paid', number: 'PAID', paid_date: today }), invoice({ id: 'zero', number: 'ZERO', amount: 0 }), invoice({ id: 'other', number: 'OTHER', job_id: 'outside' })])
    expect(container.querySelectorAll('.billing-collection-row')).toHaveLength(1)
    expect(container.textContent).toContain('Completed project'); expect(container.textContent).not.toContain('OTHER'); expect(container.textContent).not.toContain('PAID'); expect(container.textContent).not.toContain('ZERO')
    expect(container.querySelector('a[href="/billing?job=job"]')).toBeTruthy()
    expect(container.querySelector('a[href="/follow-ups"]')).toBeTruthy(); expect(planning.save).not.toHaveBeenCalled()
  })
  it('shows age without inventing a payment due date and uses the local calendar day', async () => {
    await render()
    expect(container.textContent).toContain('18 days since issue')
    expect(container.textContent).toContain('Payment due date not recorded')
    expect(container.querySelector('.billing-follow-overdue')).toBeNull()
  })
  it('shows an actual overdue invoice, newest contact and promised/next follow-up dates', async () => {
    planning.followUps = [followUp({ invoice_due_date: '2026-10-18', next_follow_up_date: today, promised_date: '2026-10-21', contact_log: [{ id: 'new', date: today, note: '' }, { id: 'old', date: '2026-10-01', note: '' }] })]
    await render()
    expect(container.querySelector('.billing-follow-overdue')?.textContent).toContain('Overdue')
    expect(container.textContent).toContain('Last contact Oct 19'); expect(container.textContent).toContain('Promised Oct 21'); expect(container.textContent).toContain('· today')
  })
  it('reuses an existing done tracker instead of offering another tracker for the invoice', async () => {
    planning.followUps = [followUp({ status: 'done' })]; await render()
    expect(container.textContent).toContain('Tracker marked done')
    await act(async () => button('Edit follow-up for invoice SYN-101').click())
    const editor = container.querySelector('[role="dialog"]')!
    expect(editor.getAttribute('data-id')).toBe('tracker'); expect(editor.getAttribute('data-invoice')).toBe('invoice')
    expect(planning.save).not.toHaveBeenCalled()
  })
  it.each(['2026-10-18', today])('keeps done follow-ups historical while retaining actual invoice overdue status (%s)', async nextDate => {
    planning.followUps = [followUp({ status: 'done', next_follow_up_date: nextDate, invoice_due_date: '2026-10-17' })]
    await render()
    expect(container.textContent).toContain('Recorded follow-up')
    expect(container.textContent).not.toContain('follow-up overdue')
    expect(container.textContent).not.toContain('· today')
    expect(container.querySelector('.billing-follow-overdue')?.textContent).toContain('Overdue')
    expect(button('Edit follow-up for invoice SYN-101').disabled).toBe(false)
    expect(planning.save).not.toHaveBeenCalled()
  })
  it('opens a new tracker with the exact invoice/job and keeps its editor after invoice changes', async () => {
    await render(); await act(async () => button('Set follow-up for invoice SYN-101').click())
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-job')).toBe('job')
    await render([invoice({ paid_date: today })])
    expect(container.querySelector('[role="dialog"]')?.getAttribute('data-invoice')).toBe('invoice')
    expect(container.querySelectorAll('.billing-collection-row')).toHaveLength(0)
  })
  it('does not offer writes when planning records failed to load', async () => {
    planning.error = 'Synthetic failure'; await render(); expect(button('Set follow-up for invoice SYN-101').disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('unavailable')
  })
  it('keeps the open tracker editor mounted through a planning-refresh error', async () => {
    await render(); await act(async () => button('Set follow-up for invoice SYN-101').click())
    const editor = container.querySelector('[role="dialog"]')!
    planning.error = 'Synthetic refresh failure'; await render()
    expect(container.querySelector('[role="dialog"]')).toBe(editor)
    planning.error = null; await render()
    expect(container.querySelector('[role="dialog"]')).toBe(editor); expect(planning.save).not.toHaveBeenCalled()
  })
})
