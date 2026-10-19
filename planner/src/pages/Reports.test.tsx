// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import type { Store } from '../lib/store'
import { downloadCSV } from '../lib/utils'
import { Reports } from './Reports'

let store: Store
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../lib/utils', async importOriginal => ({ ...await importOriginal<typeof import('../lib/utils')>(), downloadCSV: vi.fn() }))

it('keeps recorded planning estimates and actuals, displaying and exporting Planning history without renaming the phase', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  store = {
    session: null, me: null, settings: { id: 1, company_name: 'Synthetic', default_rate: 150, weekly_capacity: 40 }, profiles: [],
    clients: [{ id: 'client', name: 'Synthetic client', contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: '' }],
    jobs: [{ id: 'job', client_id: 'client', job_number: 'SYN-1', name: 'Synthetic job', description: '', address: '', status: 'active', priority: 1, fee: null, queued_date: '2026-01-02', start_date: null, due_date: null, created_at: '' }],
    phases: [{ id: 'history', job_id: 'job', kind: 'queued', name: 'Retired custom queue label', sort_order: 2, status: 'waiting', estimate_hours: 4, start_date: null, due_date: null, assignee_id: null, notes: '' }],
    timeEntries: [{ id: 'hours', job_id: 'job', phase_id: 'history', task_id: null, user_id: 'legacy', date: '2026-10-17', hours: 2, started_at: null, rate: 123.45, notes: 'Saved planning hours', billable: false, billed: false, invoice_id: null, deposit_applied: null, created_at: '' }],
    tasks: [], schedule: [], comments: [], items: [], invoices: [], deposits: [], loading: false, error: null, online: true, toasts: [],
    insert: vi.fn(async () => null), update: vi.fn(async () => true), remove: vi.fn(async () => true), recordInvoice: vi.fn(async () => null), refresh: vi.fn(async () => {}), signOut: vi.fn(async () => {}), toast: vi.fn(),
  }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter><Reports /></MemoryRouter>))
    const button = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!
    await act(async () => button('Estimate vs actual').click())
    const row = container.querySelector('tbody tr')!
    expect(row.textContent).toContain('Planning history')
    expect(row.textContent).not.toContain('Retired custom queue label')
    expect([...row.querySelectorAll('.num')].map(cell => cell.textContent)).toEqual(['4h', '2h', '-2h'])
    await act(async () => button('CSV').click())
    expect(vi.mocked(downloadCSV).mock.calls[0][2][0]).toEqual(['SYN-1', 'Synthetic job', 'Planning history', 'waiting', 4, 2, -2, 50])
    expect(store.phases[0].name).toBe('Retired custom queue label')
    expect(store.timeEntries[0]).toMatchObject({ phase_id: 'history', rate: 123.45, hours: 2, billable: false })
    expect(store.jobs[0].queued_date).toBe('2026-01-02')
    expect(store.update).not.toHaveBeenCalled(); expect(store.insert).not.toHaveBeenCalled(); expect(store.remove).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); container.remove() }
})
