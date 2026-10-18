// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Invoice, Task } from '../lib/types'
import { InvoiceModal, ItemModal, TaskModal, TimeModal } from './editors'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))

let container: HTMLDivElement
let root: Root
const issued: Invoice = { id: 'invoice', job_id: 'job', number: 'INV-1001', amount: 50, issued_date: '2026-01-04', paid_date: null, notes: '', created_at: '2026-01-04T00:00:00Z' }
const task: Task = {
  id: 'task', job_id: 'job', phase_id: null, title: 'Weekly check', description: '', status: 'todo',
  assignee_id: 'owner', due_date: '2026-01-02', scheduled_at: null, is_site_visit: false,
  estimate_hours: 1, recurrence: 'weekly', recurrence_parent_id: null, sort_order: 0,
  completed_at: null, created_by: 'owner', created_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const profile = { id: 'owner', email: 'owner@example.test', full_name: 'Synthetic Owner', color: '#1f6feb', hourly_rate: 150, weekly_hours: 40, ics_token: 'synthetic', created_at: '' }
  store = {
    session: null, me: profile, settings: { id: 1, company_name: 'Synthetic', default_rate: 150, weekly_capacity: 40 },
    profiles: [profile], clients: [], phases: [], tasks: [{ ...task }], items: [], schedule: [], deposits: [], invoices: [], comments: [],
    jobs: [{ id: 'job', client_id: 'client', job_number: 'TEST', name: 'Synthetic job', description: '', address: '', status: 'active', priority: 0, fee: null, queued_date: null, start_date: null, due_date: null, created_at: '' }],
    timeEntries: [{ id: 'hours', job_id: 'job', phase_id: null, task_id: null, user_id: 'owner', date: '2026-01-02', hours: 1, started_at: null, rate: 150, notes: '', billed: false, invoice_id: null, deposit_applied: null, created_at: '' }],
    loading: false, error: null, online: true, toasts: [], refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
    insert: vi.fn(async () => null), update: vi.fn(async () => true), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => issued),
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function clickButton(text: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  if (!button) throw new Error(`Missing button ${text}`)
  await act(async () => button.click())
}

async function change(label: string, value: string) {
  const field = [...container.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent === label)
  const input = field?.querySelector('input,select') as HTMLInputElement | HTMLSelectElement | null
  if (!input) throw new Error(`Missing field ${label}`)
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}

describe('invoice form', () => {
  it('submits the invoice and captured deposit credit in one operation', async () => {
    store.deposits = [{ id: 'deposit', job_id: 'job', amount: 100, received_date: '2026-01-01', method: '', notes: '', created_at: '' }]
    const close = vi.fn()
    await act(async () => root.render(<InvoiceModal jobId="job" entryIds={['hours']} defaultAmount={50} onClose={close} />))
    await clickButton('Save')
    expect(store.recordInvoice).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ job_id: 'job', amount: 50 }), [
      { table: 'time_entries', id: 'hours', amount: 150, depositApplied: 100 },
    ])
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('retains opening credits for server validation if deposits change while open', async () => {
    store.deposits = [{ id: 'deposit', job_id: 'job', amount: 100, received_date: '2026-01-01', method: '', notes: '', created_at: '' }]
    store.recordInvoice = vi.fn(async () => null)
    const close = vi.fn()
    await act(async () => root.render(<InvoiceModal jobId="job" entryIds={['hours']} defaultAmount={50} onClose={close} />))
    store.deposits[0].amount = 150
    await clickButton('Save')
    expect(store.recordInvoice).toHaveBeenCalledWith(expect.anything(), [{ table: 'time_entries', id: 'hours', amount: 150, depositApplied: 100 }])
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps a failed atomic save open and permits a clean retry', async () => {
    store.recordInvoice = vi.fn<Store['recordInvoice']>().mockResolvedValueOnce(null).mockResolvedValueOnce(issued)
    const close = vi.fn()
    await act(async () => root.render(<InvoiceModal jobId="job" entryIds={['hours']} defaultAmount={150} onClose={close} />))
    await clickButton('Save')
    expect(close).not.toHaveBeenCalled()
    await clickButton('Save')
    expect(close).toHaveBeenCalledOnce()
    expect(store.recordInvoice).toHaveBeenCalledTimes(2)
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('deletes the invoice once and lets database constraints unlink all its work', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const close = vi.fn()
    await act(async () => root.render(<InvoiceModal invoice={issued} jobId="job" onClose={close} />))
    await clickButton('Delete')
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('invoices', 'invoice')
    expect(store.update).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('task and credited-work forms', () => {
  it('creates the next occurrence when Done is saved in the task form', async () => {
    const child = { ...task, id: 'next', due_date: '2026-01-09', recurrence_parent_id: task.id }
    store.insert = vi.fn(async () => child) as Store['insert']
    const close = vi.fn()
    await act(async () => root.render(<TaskModal task={task} onClose={close} />))
    await change('Status', 'done')
    await clickButton('Save')
    expect(store.insert).toHaveBeenCalledWith('tasks', expect.objectContaining({ recurrence_parent_id: 'task', due_date: '2026-01-09', status: 'todo' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('requires unbilling before reducing time below its saved deposit credit', async () => {
    const entry = { ...store.timeEntries[0], billed: true, invoice_id: 'invoice', deposit_applied: 100 }
    const close = vi.fn()
    await act(async () => root.render(<TimeModal entry={entry} onClose={close} />))
    await change('Hours', '0.5')
    await clickButton('Save')
    expect(store.update).not.toHaveBeenCalled()
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('Unbill these hours'), 'error')
    expect(close).not.toHaveBeenCalled()
  })

  it('requires unbilling before reducing a charge below its saved deposit credit', async () => {
    const item = { id: 'charge', job_id: 'job', date: '2026-01-02', category: 'Expense', description: '', quantity: 1, unit_price: 150, billed: true, invoice_id: 'invoice', deposit_applied: 100, created_by: 'owner', created_at: '' }
    const close = vi.fn()
    await act(async () => root.render(<ItemModal item={item} onClose={close} />))
    await change('Price each ($)', '75')
    await clickButton('Save $75')
    expect(store.update).not.toHaveBeenCalled()
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('Unbill this charge'), 'error')
    expect(close).not.toHaveBeenCalled()
  })
})
