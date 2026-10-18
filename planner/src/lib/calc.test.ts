import { describe, expect, it } from 'vitest'
import { balanceHistory, depositUsage, jobBilling, jobCharges } from './calc'
import type { Deposit, Invoice, Job, JobItem, TimeEntry } from './types'

type MoneyStore = Parameters<typeof jobBilling>[0]

const job: Job = {
  id: 'job', client_id: 'client', job_number: '1', name: 'Test job',
  description: '', address: '', status: 'active', priority: 0, fee: null,
  queued_date: null, start_date: null, due_date: null, created_at: '2026-01-01T00:00:00Z',
}

function entry(patch: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'hours', job_id: job.id, phase_id: null, task_id: null, user_id: 'owner',
    date: '2026-01-02', hours: 1, started_at: null, rate: 150, notes: '',
    billed: false, invoice_id: null, deposit_applied: null,
    created_at: '2026-01-02T00:00:00Z', ...patch,
  }
}

function charge(patch: Partial<JobItem> = {}): JobItem {
  return {
    id: 'charge', job_id: job.id, date: '2026-01-03', category: 'Expense',
    description: '', quantity: 1, unit_price: 100, billed: false,
    invoice_id: null, deposit_applied: null, created_by: 'owner',
    created_at: '2026-01-03T00:00:00Z', ...patch,
  }
}

function deposit(patch: Partial<Deposit> = {}): Deposit {
  return {
    id: 'deposit', job_id: job.id, amount: 100, received_date: '2026-01-01',
    method: 'Check', notes: '', created_at: '2026-01-01T00:00:00Z', ...patch,
  }
}

function invoice(patch: Partial<Invoice> = {}): Invoice {
  return {
    id: 'invoice', job_id: job.id, number: 'INV-1', amount: 50,
    issued_date: '2026-01-04', paid_date: null, notes: '',
    created_at: '2026-01-04T00:00:00Z', ...patch,
  }
}

function store(patch: Partial<MoneyStore> = {}): MoneyStore {
  return {
    timeEntries: [entry()], items: [], deposits: [deposit()], invoices: [],
    profiles: [], settings: { id: 1, company_name: 'Test', default_rate: 150, weekly_capacity: 40 },
    ...patch,
  }
}

function billedEntry(patch: Partial<TimeEntry> = {}): TimeEntry {
  return entry({ billed: true, invoice_id: 'invoice', deposit_applied: 100, ...patch })
}

describe('deposit allocation across invoicing', () => {
  it('matches database timestamp order for whole seconds, fractions, and microseconds', () => {
    const s = store({ timeEntries: [
      entry({ id: 'fraction', created_at: '2026-01-02T00:00:00.1+00:00' }),
      entry({ id: 'micro-later', created_at: '2026-01-02T00:00:00.000002Z' }),
      entry({ id: 'whole', created_at: '2026-01-02T00:00:00+00:00' }),
      entry({ id: 'micro-first', created_at: '2026-01-02T01:00:00.000001+01:00' }),
    ] })
    const hours = jobCharges(s, job.id).hours
    expect(hours.map(h => h.entry.id)).toEqual(['whole', 'micro-first', 'micro-later', 'fraction'])
    expect(hours.map(h => h.covered)).toEqual([100, 0, 0, 0])
  })

  it('covers $100 of $150 work and leaves $50 to invoice', () => {
    const s = store()
    expect(jobCharges(s, job.id).hours[0]).toMatchObject({ amount: 150, covered: 100, status: 'partial' })
    expect(jobBilling(s, job)).toMatchObject({
      depositUsed: 100, depositRemaining: 0, unbilledAmount: 50,
      paidAmount: 100, waitingAmount: 0, balance: -50,
    })
  })

  it('keeps the deposit used when only the $50 remainder is invoiced', () => {
    const s = store({ timeEntries: [billedEntry()], invoices: [invoice()] })
    expect(jobCharges(s, job.id).hours[0]).toMatchObject({ amount: 150, covered: 100, status: 'billed' })
    expect(jobBilling(s, job)).toMatchObject({
      depositUsed: 100, depositRemaining: 0, unbilledAmount: 0,
      paidAmount: 100, waitingAmount: 50, outstanding: 50, balance: 0,
    })
    expect(depositUsage(s, job.id).get('deposit')).toBe(100)
    expect(balanceHistory(s, job.id).at(-1)?.balance).toBe(0)
  })

  it('counts all $150 of work as paid after the $50 invoice is paid', () => {
    const s = store({ timeEntries: [billedEntry()], invoices: [invoice({ paid_date: '2026-01-05' })] })
    expect(jobCharges(s, job.id).hours[0]).toMatchObject({ covered: 100, status: 'paid' })
    expect(jobBilling(s, job)).toMatchObject({
      depositUsed: 100, depositRemaining: 0, paidAmount: 150,
      waitingAmount: 0, outstanding: 0, collected: 150, balance: 0,
    })
  })

  it('reallocates the deposit normally after unbilling or deleting the invoice', () => {
    const unbilled = entry({ billed: false, invoice_id: null, deposit_applied: null })
    const s = store({ timeEntries: [unbilled], invoices: [invoice()] })
    expect(jobCharges(s, job.id).hours[0]).toMatchObject({ covered: 100, status: 'partial' })
    expect(jobBilling(s, job)).toMatchObject({ unbilledAmount: 50, depositRemaining: 0 })
    s.invoices = []
    expect(jobBilling(s, job)).toMatchObject({
      unbilledAmount: 50, paidAmount: 100, waitingAmount: 0, balance: -50,
    })
  })

  it('reserves billed coverage before allocating a newly added backdated entry', () => {
    const s = store({
      timeEntries: [entry({ id: 'backdated', date: '2025-12-20', rate: 60 }), billedEntry()],
      invoices: [invoice()],
    })
    const hours = jobCharges(s, job.id).hours
    expect(hours.find(h => h.entry.id === 'backdated')).toMatchObject({ covered: 0, status: 'unbilled' })
    expect(hours.find(h => h.entry.id === 'hours')).toMatchObject({ covered: 100, status: 'billed' })
    expect(jobBilling(s, job)).toMatchObject({
      depositUsed: 100, unbilledAmount: 60, paidAmount: 100, waitingAmount: 50,
    })
  })

  it('shares one deposit pool between hours and charges and retains invoiced charge coverage', () => {
    const s = store({
      deposits: [deposit({ amount: 120 })],
      timeEntries: [entry({ id: 'older-hours', rate: 60 }), entry({ id: 'later-hours', date: '2026-01-04', rate: 50 })],
      items: [charge()],
    })
    expect(jobCharges(s, job.id).items[0]).toMatchObject({ amount: 100, covered: 60, status: 'partial' })
    s.items = [charge({ billed: true, invoice_id: 'invoice', deposit_applied: 60 })]
    s.timeEntries[1] = entry({ id: 'later-hours', date: '2026-01-04', rate: 50, billed: true, invoice_id: 'invoice', deposit_applied: 0 })
    s.invoices = [invoice({ amount: 90 })]
    expect(jobCharges(s, job.id).items[0]).toMatchObject({ covered: 60, status: 'billed' })
    expect(jobBilling(s, job)).toMatchObject({
      workValue: 210, depositUsed: 120, depositRemaining: 0,
      paidAmount: 120, waitingAmount: 90, unbilledAmount: 0, balance: 0,
    })
  })

  it.each([null, undefined])('does not invent a deposit credit for legacy billed rows with snapshot %s', snapshot => {
    const legacy = billedEntry({ deposit_applied: null })
    if (snapshot === undefined) Reflect.deleteProperty(legacy, 'deposit_applied')
    const s = store({ timeEntries: [legacy, entry({ id: 'new-hours', date: '2026-01-05', rate: 80 })], invoices: [invoice()] })
    expect(jobCharges(s, job.id).hours.find(h => h.entry.id === 'hours')).toMatchObject({ covered: 0, status: 'billed' })
    expect(jobBilling(s, job)).toMatchObject({
      depositUsed: 80, depositRemaining: 20, paidAmount: 80, waitingAmount: 150,
    })
  })

  it('does not infer deposit credits from a custom invoice amount', () => {
    const s = store({ timeEntries: [billedEntry()], invoices: [invoice({ amount: 25 })] })
    expect(jobBilling(s, job)).toMatchObject({
      depositUsed: 100, paidAmount: 100, waitingAmount: 50, outstanding: 25, balance: -25,
    })
    s.invoices = [invoice({ amount: 200 })]
    expect(jobBilling(s, job)).toMatchObject({
      depositUsed: 100, paidAmount: 100, waitingAmount: 50, outstanding: 200, balance: 150,
    })
  })

  it('applies later deposits to unbilled work without changing billed coverage', () => {
    const s = store({
      timeEntries: [billedEntry(), entry({ id: 'new-hours', date: '2026-01-05' })],
      invoices: [invoice()],
      deposits: [deposit(), deposit({ id: 'future-deposit', amount: 200, received_date: '2026-02-01' })],
    })
    expect(jobCharges(s, job.id).hours.find(h => h.entry.id === 'hours')).toMatchObject({ covered: 100, status: 'billed' })
    expect(jobCharges(s, job.id).hours.find(h => h.entry.id === 'new-hours')).toMatchObject({ covered: 150, status: 'deposit' })
    expect(jobBilling(s, job)).toMatchObject({ depositUsed: 250, depositRemaining: 50, waitingAmount: 50 })
    expect(depositUsage(s, job.id)).toEqual(new Map([['deposit', 100], ['future-deposit', 150]]))
  })

  it('retains historical billed credits if a deposit is subsequently removed', () => {
    const s = store({
      timeEntries: [billedEntry(), entry({ id: 'new-hours', date: '2026-01-05', rate: 60 })],
      invoices: [invoice()], deposits: [],
    })
    expect(jobCharges(s, job.id).hours.find(h => h.entry.id === 'hours')).toMatchObject({ covered: 100, status: 'billed' })
    expect(jobCharges(s, job.id).hours.find(h => h.entry.id === 'new-hours')).toMatchObject({ covered: 0, status: 'unbilled' })
    expect(jobBilling(s, job)).toMatchObject({ depositUsed: 100, depositRemaining: 0, unbilledAmount: 60, waitingAmount: 50 })
  })
})
