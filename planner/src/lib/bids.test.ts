import { describe, expect, it, vi } from 'vitest'
import { bidOutcome, bidSummary, FOLLOW_UP_TITLE, lastSourceFor, markLost, markProposalSent, sourceReport, sourceSuggestions, typeBidRecord } from './bids'
import type { Client, Job, Phase, PhaseKind, PhaseStatus, Quote, Settings, Task, TimeEntry } from './types'

const job = (over: Partial<Job> = {}): Job => ({ id: 'j', client_id: 'c', job_number: '', name: 'Job', description: '', address: '', status: 'active', priority: 1, fee: null, job_type_id: null, size: null, use_in_estimates: true, estimate_note: '', closeout_reason: '', source: '', lost_reason: '', lost_date: null, queued_date: null, start_date: null, due_date: null, created_at: '2026-01-01T00:00:00Z', ...over })
const kinds: PhaseKind[] = ['bidding', 'design', 'plan_check', 'construction', 'client_changes']
const phasesFor = (jobId: string, statuses: PhaseStatus[]): Phase[] => kinds.map((kind, i) => ({
  id: `${jobId}-${kind}`, job_id: jobId, kind, name: kind, sort_order: i + 1, status: statuses[i] ?? 'not_started',
  estimate_hours: 0, start_date: null, due_date: null, assignee_id: null, notes: '',
}))
const client = (id: string, name: string): Client => ({ id, name, contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false, created_at: '' })
const quote = (jobId: string, fee: number): Quote => ({ id: `q-${jobId}`, job_id: jobId, job_type_id: null, rate: 150, design_hours: 0, plan_check_hours: 0, construction_hours: 0, site_visits: 0, visit_hours: 0, allowance_hours: 0, rush_percent: 0, size: null, suggested_fee: fee, fee, fee_note: '', created_at: '2026-02-01T00:00:00Z' })
const entry = (jobId: string, hours: number): TimeEntry => ({ id: `t-${jobId}`, job_id: jobId, phase_id: null, task_id: null, user_id: 'me', date: '2026-03-01', hours, started_at: null, rate: 100, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: '' } as TimeEntry)
const settings: Settings = { id: 1, company_name: '', business_email: '', default_rate: 100, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' }

describe('bidOutcome', () => {
  it('reads leads, open bids, wins and losses from the job and its phases', () => {
    expect(bidOutcome(phasesFor('j', []), job())).toBe('lead')
    expect(bidOutcome(phasesFor('j', ['waiting']), job())).toBe('bidding')
    expect(bidOutcome(phasesFor('j', ['complete']), job())).toBe('won')
    expect(bidOutcome(phasesFor('j', ['not_started', 'in_progress']), job())).toBe('won')
    expect(bidOutcome(phasesFor('j', ['waiting']), job({ status: 'cancelled', lost_date: '2026-02-01', lost_reason: 'Fee too high' }))).toBe('lost')
  })
  it('counts a job cancelled before it was won as lost, and a won job cancelled later as won', () => {
    expect(bidOutcome(phasesFor('j', ['waiting']), job({ status: 'cancelled' }))).toBe('lost')
    expect(bidOutcome(phasesFor('j', ['complete', 'in_progress']), job({ status: 'cancelled' }))).toBe('won')
  })
  it('treats finished older jobs as won even without phase history', () => {
    expect(bidOutcome([], job({ status: 'complete' }))).toBe('won')
  })
})

describe('sources', () => {
  const clients = [client('arch', 'Harbor Architects'), client('home', 'Garcia'), client('gc', 'Cascade Builders')]
  const jobs = [
    job({ id: 'a', client_id: 'arch', fee: 4000, status: 'complete' }),
    job({ id: 'b', client_id: 'home', source: 'harbor architects', fee: 2000 }),
    job({ id: 'c', client_id: 'home', source: 'Harbor Architects', fee: 3000, status: 'cancelled', lost_date: '2026-02-01', lost_reason: 'Fee too high', created_at: '2026-03-01T00:00:00Z' }),
    job({ id: 'd', client_id: 'gc' }),
  ]
  const phases = [...phasesFor('a', ['complete', 'complete', 'complete', 'complete']), ...phasesFor('b', ['complete', 'in_progress']), ...phasesFor('c', ['waiting']), ...phasesFor('d', [])]
  const store = { jobs, clients, phases, quotes: [quote('c', 3000)], timeEntries: [entry('a', 20)], invoices: [{ id: 'i', job_id: 'a', number: '1', amount: 4000, issued_date: '2026-03-02', paid_date: null, notes: '', created_at: '' }], deposits: [], items: [], profiles: [], settings }

  it('groups a referral with the client of the same name, ignoring case', () => {
    const rows = sourceReport(store)
    const harbor = rows.find(r => r.name === 'Harbor Architects')!
    expect(harbor).toMatchObject({ jobs: 3, won: 2, lost: 1, open: 0, workWon: 6000, clients: ['Garcia'] })
    expect(harbor.winRate).toBeCloseTo(2 / 3)
    expect(harbor.rate).toBe(200) // finished job only: $4,000 ÷ 20 h
    expect(rows.find(r => r.name === 'Cascade Builders')).toMatchObject({ jobs: 1, open: 1, winRate: null })
  })
  it('summarizes leads, wins, losses and reasons', () => {
    const s = bidSummary(store)
    expect(s.leads.map(j => j.id)).toEqual(['d'])
    expect(s.won).toBe(2)
    expect(s.lost).toHaveLength(1)
    expect(s.reasons).toEqual([{ reason: 'Fee too high', count: 1 }])
    expect(s.avgLost).toBe(3000)
    expect(s.winRate).toBeCloseTo(2 / 3)
  })
  it('suggests typed sources first, then client names, without repeats', () => {
    expect(sourceSuggestions(store)).toEqual(['Harbor Architects', 'Garcia', 'Cascade Builders'])
    expect(lastSourceFor(store, 'home')).toBe('Harbor Architects')
    expect(lastSourceFor(store, 'gc')).toBe('')
  })
  it('lists bids lost on price for a job type', () => {
    const typed = { ...store, jobs: store.jobs.map(j => ({ ...j, job_type_id: 'beam' })) }
    expect(typeBidRecord(typed, 'beam')).toEqual({ won: 2, lost: 1, lostOnFee: [3000] })
  })
})

describe('actions', () => {
  it('marks a bid lost and undoes it', async () => {
    const update = vi.fn().mockResolvedValue(true)
    const toast = vi.fn()
    const j = job({ status: 'active' })
    expect(await markLost({ phases: [], jobs: [j], update, toast }, j, 'Fee too high')).toBe(true)
    expect(update).toHaveBeenCalledWith('jobs', 'j', expect.objectContaining({ status: 'cancelled', lost_reason: 'Fee too high' }))
    await toast.mock.calls[0][2].run()
    expect(update).toHaveBeenLastCalledWith('jobs', 'j', { status: 'active', lost_reason: '', lost_date: null })
  })
  it('sends a proposal: bidding waits on the client and a follow-up is due in two weeks', async () => {
    const update = vi.fn().mockResolvedValue(true)
    const insert = vi.fn().mockResolvedValue({ id: 'new' })
    const store = { phases: phasesFor('j', []), tasks: [] as Task[], update, insert, remove: vi.fn(), toast: vi.fn(), me: null }
    expect(await markProposalSent(store, job(), '2026-10-31')).toBe(true)
    expect(update).toHaveBeenCalledWith('phases', 'j-bidding', { status: 'waiting' })
    expect(insert).toHaveBeenCalledWith('tasks', expect.objectContaining({ title: FOLLOW_UP_TITLE, due_date: '2026-11-14', phase_id: 'j-bidding' }))
  })
  it('moves an existing follow-up instead of adding a second one', async () => {
    const update = vi.fn().mockResolvedValue(true)
    const insert = vi.fn()
    const open = { id: 'f', job_id: 'j', title: FOLLOW_UP_TITLE, status: 'todo', due_date: '2026-10-01' } as Task
    const store = { phases: phasesFor('j', ['in_progress']), tasks: [open], update, insert, remove: vi.fn(), toast: vi.fn(), me: null }
    await markProposalSent(store, job(), '2026-10-31')
    expect(insert).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith('tasks', 'f', { due_date: '2026-11-14' })
  })
})
