// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import type { Invoice, Task } from '../lib/types'
import { InvoiceModal, ItemModal, JobModal, TaskModal, TimeModal } from './editors'
import { FeesSummary, WorkStatusBar } from './MoneyCharts'
import { jobBilling } from '../lib/calc'

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
    timeEntries: [{ id: 'hours', job_id: 'job', phase_id: null, task_id: null, user_id: 'owner', date: '2026-01-02', hours: 1, started_at: null, rate: 150, notes: '', billed: false, invoice_id: null, deposit_applied: null, billable: true, created_at: '' }],
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

async function render(node: ReactNode) {
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>))
}

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
    await render(<InvoiceModal jobId="job" entryIds={['hours']} defaultAmount={50} onClose={close} />)
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
    await render(<InvoiceModal jobId="job" entryIds={['hours']} defaultAmount={50} onClose={close} />)
    store.deposits[0].amount = 150
    await clickButton('Save')
    expect(store.recordInvoice).toHaveBeenCalledWith(expect.anything(), [{ table: 'time_entries', id: 'hours', amount: 150, depositApplied: 100 }])
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps a failed atomic save open and permits a clean retry', async () => {
    store.recordInvoice = vi.fn<Store['recordInvoice']>().mockResolvedValueOnce(null).mockResolvedValueOnce(issued)
    const close = vi.fn()
    await render(<InvoiceModal jobId="job" entryIds={['hours']} defaultAmount={150} onClose={close} />)
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
    await render(<InvoiceModal invoice={issued} jobId="job" onClose={close} />)
    await clickButton('Delete')
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('invoices', 'invoice')
    expect(store.update).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('task and credited-work forms', () => {
  it('defaults new hours to billable', async () => {
    store.insert = vi.fn(async () => store.timeEntries[0]) as Store['insert']
    await render(<TimeModal onClose={vi.fn()} />)
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(true)
    await change('Hours', '1')
    await clickButton('Save')
    expect(store.insert).toHaveBeenCalledWith('time_entries', expect.objectContaining({ billable: true, hours: 1, rate: 150 }))
  })

  it('saves non-billable hours at their original rate instead of erasing their time value', async () => {
    store.insert = vi.fn(async () => store.timeEntries[0]) as Store['insert']
    await render(<TimeModal onClose={vi.fn()} />)
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.click())
    await change('Hours', '2')
    await clickButton('Save')
    expect(store.insert).toHaveBeenCalledWith('time_entries', expect.objectContaining({ billable: false, hours: 2, rate: 150 }))
  })

  it('allows unbilled hours to become non-billable even if a deposit currently covers them', async () => {
    store.deposits = [{ id: 'deposit', job_id: 'job', amount: 100, received_date: '2026-01-01', method: '', notes: '', created_at: '' }]
    await render(<TimeModal entry={store.timeEntries[0]} onClose={vi.fn()} />)
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.disabled).toBe(false)
    await act(async () => checkbox.click())
    await clickButton('Save')
    expect(store.update).toHaveBeenCalledWith('time_entries', 'hours', expect.objectContaining({ billable: false, rate: 150 }))
  })

  it('keeps billed hours billable until the invoice link is released', async () => {
    const entry = { ...store.timeEntries[0], billed: true, invoice_id: 'invoice', deposit_applied: 100 }
    store.timeEntries = [entry]
    await render(<TimeModal entry={entry} onClose={vi.fn()} />)
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(true)
    expect(container.textContent).toContain('Unbill')
  })

  it('can reclassify an unbilled non-billable entry without changing the saved hourly rate', async () => {
    const entry = { ...store.timeEntries[0], billable: false, rate: 125 }
    store.timeEntries = [entry]
    await render(<TimeModal entry={entry} onClose={vi.fn()} />)
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(false)
    await act(async () => checkbox.click())
    await clickButton('Save')
    expect(store.update).toHaveBeenCalledWith('time_entries', 'hours', expect.objectContaining({ billable: true, rate: 125 }))
  })

  it('creates the next occurrence when Done is saved in the task form', async () => {
    const child = { ...task, id: 'next', due_date: '2026-01-09', recurrence_parent_id: task.id }
    store.insert = vi.fn(async () => child) as Store['insert']
    const close = vi.fn()
    await render(<TaskModal task={task} onClose={close} />)
    await change('Status', 'done')
    await clickButton('Save')
    expect(store.insert).toHaveBeenCalledWith('tasks', expect.objectContaining({ recurrence_parent_id: 'task', due_date: '2026-01-09', status: 'todo' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('requires unbilling before reducing time below its saved deposit credit', async () => {
    const entry = { ...store.timeEntries[0], billed: true, invoice_id: 'invoice', deposit_applied: 100 }
    store.timeEntries = [entry]
    const close = vi.fn()
    await render(<TimeModal entry={entry} onClose={close} />)
    await change('Hours', '0.5')
    await clickButton('Save')
    expect(store.update).not.toHaveBeenCalled()
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('Unbill these hours'), 'error')
    expect(close).not.toHaveBeenCalled()
  })

  it('requires unbilling before reducing a charge below its saved deposit credit', async () => {
    const item = { id: 'charge', job_id: 'job', date: '2026-01-02', category: 'Expense', description: '', quantity: 1, unit_price: 150, billed: true, invoice_id: 'invoice', deposit_applied: 100, created_by: 'owner', created_at: '' }
    const close = vi.fn()
    await render(<ItemModal item={item} onClose={close} />)
    await change('Price each ($)', '75')
    await clickButton('Save $75')
    expect(store.update).not.toHaveBeenCalled()
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('Unbill this charge'), 'error')
    expect(close).not.toHaveBeenCalled()
  })
})

describe('job fees and effective hourly rate', () => {
  it('shows $100 per hour for $1,000 of fees and ten hours including two non-billable hours', async () => {
    const original = store.timeEntries[0]
    store.timeEntries = [
      { ...original, hours: 8, rate: 125, billed: true, invoice_id: 'invoice' },
      { ...original, id: 'internal', hours: 2, rate: 125, billable: false },
    ]
    store.invoices = [{ ...issued, amount: 1000 }]
    await render(<FeesSummary b={jobBilling(store, store.jobs[0])} />)
    expect([...container.querySelectorAll('.fee-value')].map(e => e.textContent)).toEqual(['$1,000', '$100/h'])
    expect(container.textContent).toContain('10h completed · 8h billable · 2h nonbillable')
    expect(container.textContent).toContain('Nonbillable time value: $250')
    expect(container.textContent).toContain('Includes unused deposits')
  })

  it('keeps cents in the hourly rate and shows no rate before any completed hours', async () => {
    store.timeEntries[0].hours = 3
    store.invoices = [{ ...issued, amount: 400 }]
    await render(<FeesSummary b={jobBilling(store, store.jobs[0])} />)
    expect(container.textContent).toContain('$133.33/h')
    store.timeEntries = []
    await render(<FeesSummary b={jobBilling(store, store.jobs[0])} />)
    expect([...container.querySelectorAll('.fee-value')].map(e => e.textContent)).toEqual(['$400', '–'])
  })

  it('does not present an all-nonbillable job as unpaid client work', async () => {
    store.timeEntries[0].billable = false
    const b = jobBilling(store, store.jobs[0])
    await render(<><FeesSummary b={b} /><WorkStatusBar b={b} /></>)
    expect(container.textContent).toContain('$0/h')
    expect(container.textContent).toContain('1h completed · 0h billable · 1h nonbillable')
    expect(container.textContent).toContain('Nonbillable time value: $150')
    expect(container.textContent).toContain('No billable work or deposits yet')
  })
})

describe('job deletion', () => {
  const findButton = (text: string) => {
    const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === text)
    if (!button) throw new Error(`Missing button ${text}`)
    return button
  }
  const jobName = () => [...container.querySelectorAll('.field')]
    .find(field => field.querySelector('label')?.textContent === 'Job name')!.querySelector('input')!

  it.each(['returns false', 'throws'])('retains the edited draft and awaits authoritative refresh when deletion %s', async failure => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const close = vi.fn(), deleted = vi.fn()
    let resolveRefresh!: () => void
    vi.mocked(store.refresh).mockImplementation(() => new Promise(resolve => { resolveRefresh = resolve }))
    if (failure === 'throws') vi.mocked(store.remove).mockRejectedValue(new Error('Synthetic connection failure'))
    else vi.mocked(store.remove).mockResolvedValue(false)
    await render(<JobModal job={store.jobs[0]} onClose={close} onDeleted={deleted} />)
    await change('Job name', 'Keep this edited job draft')
    await clickButton('Delete job')
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('jobs', 'job')
    expect(store.refresh).toHaveBeenCalledExactlyOnceWith('jobs')
    expect(close).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
    expect(jobName().matches(':disabled')).toBe(true)
    await act(async () => resolveRefresh())
    expect(jobName().value).toBe('Keep this edited job draft')
    expect(jobName().matches(':disabled')).toBe(false)
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/delet|confirm/i)
    expect(close).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })

  it('guards duplicate delete/save/close actions until deletion succeeds, then notifies before closing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const close = vi.fn(), deleted = vi.fn()
    let resolveRemove!: (value: boolean) => void
    vi.mocked(store.remove).mockImplementation(() => new Promise(resolve => { resolveRemove = resolve }))
    await render(<JobModal job={store.jobs[0]} onClose={close} onDeleted={deleted} />)
    const remove = findButton('Delete job'), save = findButton('Save'), cancel = findButton('Cancel')
    await act(async () => { remove.click(); remove.click(); save.click(); cancel.click() })
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(confirm).toHaveBeenCalledOnce()
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('jobs', 'job')
    expect(store.update).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(deleted).not.toHaveBeenCalled()
    expect(remove.disabled).toBe(true)
    expect(save.disabled).toBe(true)
    expect(cancel.disabled).toBe(true)
    await act(async () => resolveRemove(true))
    expect(deleted).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(deleted.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0])
  })

  it('blocks deletion while an edited job save is pending', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const close = vi.fn()
    let resolveUpdate!: (value: boolean) => void
    vi.mocked(store.update).mockImplementation(() => new Promise(resolve => { resolveUpdate = resolve }))
    await render(<JobModal job={store.jobs[0]} onClose={close} />)
    await change('Job name', 'Pending edited job')
    const save = findButton('Save'), remove = findButton('Delete job')
    await act(async () => { save.click(); remove.click() })
    expect(store.update).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
    expect(remove.disabled).toBe(true)
    await act(async () => resolveUpdate(false))
    expect(close).not.toHaveBeenCalled()
    expect(jobName().value).toBe('Pending edited job')
  })
})
