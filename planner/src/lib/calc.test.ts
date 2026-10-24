import { describe, expect, it } from 'vitest'
import { balanceHistory, depositUsage, jobBilling, jobCharges, soloWorkload, teamWorkload, workPhase } from './calc'
import type { Deposit, Invoice, Job, JobItem, Phase, Profile, TimeEntry } from './types'

type MoneyStore = Parameters<typeof jobBilling>[0]

const job: Job = {
  id: 'job', client_id: 'client', job_number: '1', name: 'Test job',
  description: '', address: '', status: 'active', priority: 0, fee: null, job_type_id: null, size: null, use_in_estimates: true, estimate_note: '', closeout_reason: '',
  queued_date: null, start_date: null, due_date: null, created_at: '2026-01-01T00:00:00Z',
}

function entry(patch: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'hours', job_id: job.id, phase_id: null, task_id: null, user_id: 'owner',
    date: '2026-01-02', hours: 1, started_at: null, rate: 150, notes: '',
    billed: false, billable: true, invoice_id: null, deposit_applied: null,
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
    profiles: [], settings: { id: 1, company_name: 'Test', business_email: '', default_rate: 150, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' },
    ...patch,
  }
}

function billedEntry(patch: Partial<TimeEntry> = {}): TimeEntry {
  return entry({ billed: true, invoice_id: 'invoice', deposit_applied: 100, ...patch })
}

describe('retired planning phases', () => {
  const phase = (patch: Partial<Phase> = {}): Phase => ({ id: 'design', job_id: 'job', name: 'Design', kind: 'design',
    status: 'in_progress', sort_order: 2, estimate_hours: 10, start_date: null, due_date: null, assignee_id: 'owner', notes: '', ...patch })
  it('never defaults new work to planning history, including jobs with only retained phases', () => {
    const history = phase({ id: 'history', kind: 'queued', sort_order: 1 })
    const design = phase({ status: 'complete' })
    expect(workPhase([history, design], 'job')).toBe(design)
    expect(workPhase([history], 'job')).toBeUndefined()
    expect(workPhase([phase({ id: 'late', kind: 'construction', sort_order: 5 }), phase(), history], 'job')?.id).toBe('design')
  })
  it('removes historical estimates from solo and legacy workload while keeping actual time and money', () => {
    const owner: Profile = { id: 'owner', full_name: 'Owner', email: null, color: '#123456', hourly_rate: 150,
      weekly_hours: 40, ics_token: '', created_at: '' }
    const s = { ...store({ timeEntries: [entry({ hours: 4, phase_id: 'design' }), entry({ id: 'history-time', phase_id: 'history', hours: 2, billable: false })] }),
      jobs: [job], profiles: [owner], me: owner,
      phases: [phase(), phase({ id: 'history', kind: 'queued', status: 'waiting', estimate_hours: 80 })],
    }
    expect(soloWorkload(s)).toMatchObject({ remainingHours: 6, weeksOut: 0.15 })
    expect(soloWorkload(s).openPhases.map(phase => phase.id)).toEqual(['design'])
    expect(teamWorkload(s)[0]).toMatchObject({ remainingHours: 6, weeksOut: 0.15 })
    expect(teamWorkload(s)[0].openPhases.map(phase => phase.id)).toEqual(['design'])
    expect(jobBilling(s, job)).toMatchObject({ loggedHours: 6, billableHours: 4, nonBillableHours: 2,
      hoursValue: 900, nonBillableValue: 300, deposits: 100, unbilledAmount: 500, balance: -800 })
  })
})

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

describe('billable time and effective hourly fees', () => {
  it('divides $1,000 of fees by all 10 hours, including 2 non-billable hours', () => {
    const s = store({
      deposits: [], invoices: [invoice({ amount: 1000 })],
      timeEntries: [entry({ hours: 8 }), entry({ id: 'non-billable', hours: 2, billable: false })],
    })
    expect(jobBilling(s, job)).toMatchObject({
      loggedHours: 10, billableHours: 8, nonBillableHours: 2, nonBillableValue: 300,
      hoursValue: 1500, workValue: 1500, feeRevenue: 1000, effectiveHourlyRate: 100,
      balance: -500,
    })
    expect(balanceHistory(s, job.id).at(-1)?.balance).toBe(-500)
  })

  it('keeps non-billable effort in the balance without consuming deposits or creating work to invoice', () => {
    const s = store({ timeEntries: [
      entry({ id: 'non-billable', date: '2026-01-01', hours: 2, billable: false }),
      entry({ id: 'billable', date: '2026-01-02' }),
    ] })
    const hours = jobCharges(s, job.id).hours
    expect(hours.find(h => h.entry.id === 'non-billable')).toMatchObject({ amount: 300, covered: 0, status: 'nonbillable' })
    expect(hours.find(h => h.entry.id === 'billable')).toMatchObject({ amount: 150, covered: 100, status: 'partial' })
    const b = jobBilling(s, job)
    expect(b).toMatchObject({
      nonBillableValue: 300, workValue: 450, depositUsed: 100, depositRemaining: 0,
      unbilledHours: 1 / 3, unbilledAmount: 50, paidAmount: 100, waitingAmount: 0, balance: -350,
    })
    expect(b.paidAmount + b.waitingAmount + b.unbilledAmount + b.nonBillableValue).toBe(b.workValue)
  })

  it('releases dynamic deposit coverage when uninvoiced time becomes non-billable', () => {
    const s = store({ timeEntries: [entry(), entry({ id: 'later', date: '2026-01-03' })] })
    expect(jobCharges(s, job.id).hours[0].covered).toBe(100)
    s.timeEntries[0].billable = false
    const hours = jobCharges(s, job.id).hours
    expect(hours[0]).toMatchObject({ status: 'nonbillable', covered: 0 })
    expect(hours[1]).toMatchObject({ status: 'partial', covered: 100 })
    expect(jobBilling(s, job).depositUsed).toBe(100)
  })

  it('leaves charges out of fees using only their funded invoice portion', () => {
    const s = store({
      timeEntries: [entry({ hours: 10 })], deposits: [], invoices: [invoice({ amount: 1200 })],
      items: [charge({ unit_price: 200, billed: true, invoice_id: 'invoice', deposit_applied: 0 })],
    })
    expect(jobBilling(s, job)).toMatchObject({
      invoiced: 1200, itemsValue: 200, feeRevenue: 1000, effectiveHourlyRate: 100,
      workValue: 1700, balance: -500,
    })
    s.items[0].category = 'Fixed fee'
    expect(jobBilling(s, job).feeRevenue).toBe(1000)
  })

  it('counts deposits and invoices once and excludes deposit-funded charges without double subtraction', () => {
    const s = store({
      deposits: [deposit({ amount: 500 })], invoices: [invoice({ amount: 700 })],
      timeEntries: [billedEntry({ hours: 10, rate: 100, deposit_applied: 300 })],
      items: [charge({ unit_price: 200, billed: true, invoice_id: 'invoice', deposit_applied: 200 })],
    })
    expect(jobBilling(s, job)).toMatchObject({
      deposits: 500, invoiced: 700, feeRevenue: 1000, effectiveHourlyRate: 100,
      workValue: 1200, depositUsed: 500, balance: 0,
    })
    s.invoices[0].paid_date = '2026-01-05'
    expect(jobBilling(s, job)).toMatchObject({ collected: 1200, feeRevenue: 1000, effectiveHourlyRate: 100 })
  })

  it('allocates custom invoice amounts to linked charges first and treats standalone invoices as fees', () => {
    const s = store({
      timeEntries: [entry({ hours: 10 })], deposits: [], invoices: [invoice({ amount: 50 })],
      items: [charge({ billed: true, invoice_id: 'invoice', deposit_applied: 0 })],
    })
    expect(jobBilling(s, job)).toMatchObject({ feeRevenue: 0, effectiveHourlyRate: 0 })
    s.invoices[0].amount = 250
    expect(jobBilling(s, job)).toMatchObject({ feeRevenue: 150, effectiveHourlyRate: 15 })
    s.invoices.push(invoice({ id: 'standalone', amount: 75 }))
    expect(jobBilling(s, job)).toMatchObject({ feeRevenue: 225, effectiveHourlyRate: 22.5 })
  })

  it('does not subtract unfunded charges from the fee revenue of unrelated invoices', () => {
    const s = store({
      timeEntries: [entry({ hours: 10 })], deposits: [], invoices: [invoice({ amount: 1000 })],
      items: [charge({ unit_price: 200 })],
    })
    expect(jobBilling(s, job)).toMatchObject({ feeRevenue: 1000, effectiveHourlyRate: 100, unbilledItems: 200 })
  })

  it('excludes charge portions funded partly by deposit and partly by invoice', () => {
    const s = store({
      deposits: [deposit()], invoices: [invoice({ amount: 1050 })],
      timeEntries: [entry({ hours: 10 })],
      items: [charge({ unit_price: 150, billed: true, invoice_id: 'invoice', deposit_applied: 100 })],
    })
    expect(jobBilling(s, job)).toMatchObject({
      feeRevenue: 1000, effectiveHourlyRate: 100, depositUsed: 100, depositRemaining: 0,
    })
  })

  it('keeps all-non-billable time in the hourly denominator for a fixed-fee job', () => {
    const s = store({
      timeEntries: [entry({ hours: 10, billable: false })], deposits: [], invoices: [invoice({ amount: 1000 })],
    })
    expect(jobBilling(s, job)).toMatchObject({
      loggedHours: 10, billableHours: 0, nonBillableHours: 10,
      unbilledAmount: 0, unbilledHours: 0, feeRevenue: 1000, effectiveHourlyRate: 100,
      nonBillableValue: 1500, workValue: 1500, balance: -500,
    })
  })

  it('excludes running timers from both hourly revenue denominators and monetary work values', () => {
    const s = store({
      timeEntries: [entry({ hours: 2, billable: false }), entry({ id: 'running', hours: null, started_at: '2026-01-01T00:00:00Z' })],
      deposits: [], invoices: [invoice({ amount: 1000 })],
    })
    expect(jobBilling(s, job)).toMatchObject({
      loggedHours: 2, billableHours: 0, nonBillableHours: 2,
      workValue: 300, feeRevenue: 1000, effectiveHourlyRate: 500,
    })
    s.timeEntries = [s.timeEntries[1]]
    expect(jobBilling(s, job)).toMatchObject({ loggedHours: 0, workValue: 0, feeRevenue: 1000, effectiveHourlyRate: null })
  })

  it('treats legacy missing billable flags as billable and preserves their saved rates', () => {
    const oldEntry = entry({ hours: 4, rate: 150 })
    Reflect.deleteProperty(oldEntry, 'billable')
    const s = store({ timeEntries: [oldEntry], deposits: [], invoices: [invoice({ amount: 1000 })] })
    s.settings.default_rate = 999
    expect(jobBilling(s, job)).toMatchObject({
      loggedHours: 4, billableHours: 4, nonBillableHours: 0, hoursValue: 600,
      feeRevenue: 1000, effectiveHourlyRate: 250, balance: 400,
    })
  })

  it('does not create negative fee revenue when old charge credits exceed deposits after a deletion', () => {
    const s = store({
      timeEntries: [entry()], deposits: [],
      items: [charge({ billed: true, invoice_id: 'invoice', deposit_applied: 100 })], invoices: [invoice({ amount: 25 })],
    })
    expect(jobBilling(s, job)).toMatchObject({ feeRevenue: 0, effectiveHourlyRate: 0, invoiced: 25, depositUsed: 100 })
  })
})
