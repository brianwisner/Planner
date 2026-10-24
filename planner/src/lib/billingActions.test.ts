import { describe, expect, it } from 'vitest'
import { invoiceWorkLinks } from './billingActions'

function fixture() {
  const store: Parameters<typeof invoiceWorkLinks>[0] = {
    settings: { id: 1, company_name: 'Synthetic', business_email: '', default_rate: 150, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' }, profiles: [], invoices: [],
    deposits: [{ id: 'deposit', job_id: 'job', amount: 100, received_date: '2026-01-01', method: '', notes: '', created_at: '2026-01-01T00:00:00Z' }],
    timeEntries: [{
      id: 'hours', job_id: 'job', user_id: 'owner', phase_id: null, task_id: null,
      date: '2026-01-02', hours: 1, rate: 150, started_at: null, notes: '', billed: false,
      invoice_id: null, deposit_applied: null, billable: true, created_at: '2026-01-02T00:00:00Z',
    }],
    items: [{
      id: 'charge', job_id: 'job', date: '2026-01-03', category: 'Expense', description: '',
      quantity: 1, unit_price: 50, billed: false, invoice_id: null, deposit_applied: null,
      created_by: 'owner', created_at: '2026-01-03T00:00:00Z',
    }],
  }
  return store
}

describe('capturing invoice work', () => {
  it('captures the current gross value and credit before any work is billed', () => {
    const store = fixture()
    expect(invoiceWorkLinks(store, 'job', ['hours'], [])).toEqual([
      { table: 'time_entries', id: 'hours', amount: 150, depositApplied: 100 },
    ])
  })

  it('captures hours and charge credits from one allocation and ignores duplicate selections', () => {
    const store = fixture()
    expect(invoiceWorkLinks(store, 'job', ['hours', 'hours'], ['charge'])).toEqual([
      { table: 'time_entries', id: 'hours', amount: 150, depositApplied: 100 },
      { table: 'job_items', id: 'charge', amount: 50, depositApplied: 0 },
    ])
  })

  it('captures explicit zero when no deposit is used', () => {
    const store = fixture()
    store.deposits = []
    expect(invoiceWorkLinks(store, 'job', ['hours'], ['charge']).map(l => l.depositApplied)).toEqual([0, 0])
  })

  it('rejects already billed, missing, and foreign-job selections', () => {
    const store = fixture()
    store.timeEntries[0].billed = true
    expect(() => invoiceWorkLinks(store, 'job', ['hours'], [])).toThrow('Selected hours have changed')
    expect(() => invoiceWorkLinks(store, 'job', ['missing'], [])).toThrow('Selected hours have changed')
    expect(() => invoiceWorkLinks(store, 'other-job', [], ['charge'])).toThrow('Selected charges have changed')
  })

  it('rejects selected work that is fully covered by a deposit', () => {
    const store = fixture()
    store.deposits[0].amount = 200
    expect(() => invoiceWorkLinks(store, 'job', ['hours'], [])).toThrow('Selected hours have changed')
    expect(() => invoiceWorkLinks(store, 'job', [], ['charge'])).toThrow('Selected charges have changed')
  })

  it('excludes non-billable time without spending the deposit that can cover charges', () => {
    const store = fixture()
    store.timeEntries[0].billable = false
    expect(() => invoiceWorkLinks(store, 'job', ['hours'], [])).toThrow('Selected hours have changed')
    store.items[0].unit_price = 150
    expect(invoiceWorkLinks(store, 'job', [], ['charge'])).toEqual([
      { table: 'job_items', id: 'charge', amount: 150, depositApplied: 100 },
    ])
  })
})
