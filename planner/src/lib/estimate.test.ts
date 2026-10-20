import { describe, expect, it } from 'vitest'
import { estimateHours, finishedJobs, roundFee, splitFee } from './estimate'
import type { Invoice, Job, JobType, Phase, PhaseKind, TimeEntry } from './types'

type EstimateStore = Parameters<typeof estimateHours>[0]

const adu: JobType = { id: 'adu', name: 'ADU', design_hours: 30, plan_check_hours: 8, construction_hours: 6, notes: '', created_at: '2026-01-01T00:00:00Z' }

function job(id: string, patch: Partial<Job> = {}): Job {
  return {
    id, client_id: 'client', job_number: id, name: id, description: '', address: '', status: 'complete', priority: 0,
    fee: null, job_type_id: 'adu', queued_date: null, start_date: null, due_date: null, created_at: '2026-01-01T00:00:00Z', ...patch,
  }
}

const KINDS: PhaseKind[] = ['bidding', 'design', 'plan_check', 'construction', 'client_changes']
const phases = (jobId: string): Phase[] => KINDS.map((kind, i) => ({
  id: `${jobId}:${kind}`, job_id: jobId, kind, name: kind, sort_order: i, status: 'complete', estimate_hours: 0,
  start_date: null, due_date: null, assignee_id: null, notes: '',
}))

let n = 0
function hours(jobId: string, kind: PhaseKind | null, h: number | null, patch: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: `e${++n}`, job_id: jobId, phase_id: kind ? `${jobId}:${kind}` : null, task_id: null, user_id: 'owner', date: '2026-02-01',
    hours: h, started_at: null, rate: 150, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null,
    created_at: '2026-02-01T00:00:00Z', ...patch,
  }
}

function store(jobs: Job[], timeEntries: TimeEntry[], invoices: Invoice[] = []): EstimateStore {
  return {
    jobs, phases: jobs.flatMap(j => phases(j.id)), timeEntries, invoices, deposits: [], items: [], profiles: [],
    settings: { id: 1, company_name: '', business_email: '', default_rate: 150, weekly_capacity: 40 },
  }
}

describe('fee estimator', () => {
  it('uses the starter numbers until a job of the type is finished', () => {
    const est = estimateHours(store([job('open', { status: 'active' })], [hours('open', 'design', 80)]), adu)
    expect(est.hours).toEqual({ design: 30, plan_check: 8, construction: 6 })
    expect(est.total).toBe(44)
    expect(est.finished).toHaveLength(0)
    expect(est.low).toBeNull()
  })

  it('counts the starter numbers as two jobs and each finished job as one', () => {
    const s = store([job('a'), job('b')], [
      hours('a', 'design', 36), hours('a', 'plan_check', 11), hours('a', 'construction', 3),
      hours('b', 'design', 24), hours('b', null, 6), // hours without a phase are design work
    ])
    const est = estimateHours(s, adu)
    expect(est.hours.design).toBeCloseTo((30 * 2 + 36 + 30) / 4)
    expect(est.hours.plan_check).toBeCloseTo((8 * 2 + 11 + 0) / 4)
    expect(est.hours.construction).toBeCloseTo((6 * 2 + 3 + 0) / 4)
    expect(est.low).toBe(30)
    expect(est.high).toBe(50)
  })

  it('averages finished jobs when the type has no starter numbers', () => {
    const blank = { ...adu, design_hours: 0, plan_check_hours: 0, construction_hours: 0 }
    const est = estimateHours(store([job('a'), job('b')], [hours('a', 'design', 10), hours('b', 'design', 20)]), blank)
    expect(est.hours.design).toBe(15)
    expect(est.hasStarter).toBe(false)
  })

  it('ignores bidding, client changes, running timers, other types and the job being estimated', () => {
    const s = store([job('a'), job('other', { job_type_id: 'deck' }), job('self')], [
      hours('a', 'design', 10), hours('a', 'bidding', 5), hours('a', 'client_changes', 7),
      hours('a', 'design', null, { started_at: '2026-02-01T08:00:00Z' }),
      hours('other', 'design', 99), hours('self', 'design', 99),
    ])
    const list = finishedJobs(s, 'adu', 'self')
    expect(list.map(f => f.job.id)).toEqual(['a'])
    expect(list[0].total).toBe(10)
    expect(list[0].allHours).toBe(22)
  })

  it('reports what finished jobs earned per hour from deposits and invoices', () => {
    const inv: Invoice = { id: 'i', job_id: 'a', number: '1', amount: 3000, issued_date: '2026-03-01', paid_date: null, notes: '', created_at: '2026-03-01T00:00:00Z' }
    const est = estimateHours(store([job('a')], [hours('a', 'design', 20), hours('a', 'bidding', 4)], [inv]), adu)
    expect(est.earnedPerHour).toBe(125)
  })

  it('rounds fees up to the next $50 and splits them into whole dollars that add up', () => {
    expect(roundFee(6601)).toBe(6650)
    expect(roundFee(6600)).toBe(6600)
    expect(roundFee(0)).toBe(0)
    const split = splitFee(1000, { design: 1, plan_check: 1, construction: 1 })
    expect(split.design + split.plan_check + split.construction).toBe(1000)
    expect(splitFee(500, { design: 4, plan_check: 0, construction: 0 })).toEqual({ design: 500, plan_check: 0, construction: 0 })
  })
})
