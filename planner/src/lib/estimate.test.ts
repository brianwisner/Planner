import { describe, expect, it } from 'vitest'
import { closeoutReasons, estimateHours, excludedJobs, fallbackHours, finishedJobs, pastEvidence, overruns, perUnit, priceEstimate, proposalText, roundFee, splitFee, unitScale } from './estimate'
import type { Invoice, Job, JobType, Phase, PhaseKind, Quote, TimeEntry } from './types'

type EstimateStore = Parameters<typeof estimateHours>[0]

const adu: JobType = { id: 'adu', name: 'ADU', design_hours: 30, plan_check_hours: 8, construction_hours: 6, site_visits: 0, size_unit: 'sq ft', keywords: '', notes: '', created_at: '2026-01-01T00:00:00Z' }

function job(id: string, patch: Partial<Job> = {}): Job {
  return {
    id, client_id: 'client', job_number: id, name: id, description: '', address: '', status: 'complete', priority: 0,
    fee: null, job_type_id: 'adu', size: null, use_in_estimates: true, estimate_note: '', closeout_reason: '',
    queued_date: null, start_date: null, due_date: null, created_at: '2026-01-01T00:00:00Z', ...patch,
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

function invoice(jobId: string, amount: number): Invoice {
  return { id: `i-${jobId}`, job_id: jobId, number: '1', amount, issued_date: '2026-03-01', paid_date: null, notes: '', created_at: '2026-03-01T00:00:00Z' }
}

function quote(jobId: string, d: number, pc: number, c: number, at = '2026-01-05T00:00:00Z'): Quote {
  return {
    id: `q-${jobId}-${at}`, job_id: jobId, job_type_id: 'adu', rate: 150, design_hours: d, plan_check_hours: pc, construction_hours: c,
    site_visits: 0, visit_hours: 0, allowance_hours: 0, rush_percent: 0, size: null, suggested_fee: 0, fee: 0, fee_note: '', created_at: at,
  }
}

function store(jobs: Job[], timeEntries: TimeEntry[], invoices: Invoice[] = [], quotes: Quote[] = []): EstimateStore {
  return {
    jobs, phases: jobs.flatMap(j => phases(j.id)), timeEntries, invoices, deposits: [], items: [], profiles: [], quotes, jobTypes: [adu],
    settings: { id: 1, company_name: '', business_email: '', default_rate: 150, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' },
  }
}

describe('typical hours', () => {
  it('uses the starter numbers (with the usual site visits in Construction) until a job of the type is finished', () => {
    const est = estimateHours(store([job('open', { status: 'active' })], [hours('open', 'design', 80)]), { ...adu, construction_hours: 2, site_visits: 2 })
    expect(est.hours).toEqual({ design: 30, plan_check: 8, construction: 2 + 2 * 3 })
    expect(est.finished).toHaveLength(0)
    expect(est.low).toBeNull()
  })

  it('counts the starter numbers as two jobs and each finished job as one', () => {
    const s = store([job('a'), job('b')], [
      hours('a', 'design', 36), hours('a', 'plan_check', 11), hours('a', 'construction', 3),
      hours('b', 'design', 24), hours('b', null, 6), // hours without a phase count as design, and are flagged
    ])
    const est = estimateHours(s, adu)
    expect(est.hours.design).toBeCloseTo((30 * 2 + 36 + 30) / 4)
    expect(est.hours.plan_check).toBeCloseTo((8 * 2 + 11) / 4)
    expect([est.low, est.high]).toEqual([30, 50])
    expect(est.unphased).toBe(6)
  })

  it('averages finished jobs when the type has no starter numbers, and shows the middle job from three', () => {
    const blank = { ...adu, design_hours: 0, plan_check_hours: 0, construction_hours: 0 }
    const est = estimateHours(store([job('a'), job('b'), job('c')], [hours('a', 'design', 10), hours('b', 'design', 20), hours('c', 'design', 90)]), blank)
    expect(est.hours.design).toBe(40)
    expect(est.median).toBe(20)
  })

  it('leaves out jobs marked "not for estimates", other types, running timers and the job being estimated', () => {
    const s = store([job('a'), job('skip', { use_in_estimates: false, estimate_note: 'stopped early' }), job('other', { job_type_id: 'deck' }), job('self')], [
      hours('a', 'design', 10), hours('a', 'bidding', 5), hours('a', 'client_changes', 7),
      hours('a', 'design', null, { started_at: '2026-02-01T08:00:00Z' }),
      hours('skip', 'design', 99), hours('other', 'design', 99), hours('self', 'design', 99),
    ])
    const list = finishedJobs(s, 'adu', 'self')
    expect(list.map(f => f.job.id)).toEqual(['a'])
    expect(list[0]).toMatchObject({ total: 10, allHours: 22, bidding: 5, clientChanges: 7 })
    expect(excludedJobs(s, 'adu').map(j => j.id)).toEqual(['skip'])
  })

  it('compares earnings with the rates saved on the hours, not today\'s rate', () => {
    const s = store([job('a')], [hours('a', 'design', 20, { rate: 120 }), hours('a', 'bidding', 4, { rate: 120 })], [invoice('a', 2400)])
    const est = estimateHours(s, adu)
    expect(est.earnedPerHour).toBe(100)
    expect(est.rateThen).toBe(120)
  })

  it('totals fees and hours across jobs instead of averaging each job\'s rate', () => {
    const s = store([job('small'), job('big')], [hours('small', 'design', 2), hours('big', 'design', 98)], [invoice('small', 1000), invoice('big', 9800)])
    expect(estimateHours(s, adu).earnedPerHour).toBeCloseTo(108)
  })
})

describe('pricing', () => {
  const base = { hours: { design: 30, plan_check: 8, construction: 6 }, visits: 0, usualVisits: 0, visitHours: 3, allowance: 0, rushPercent: 0, rate: 150, minimumFee: 0 }

  it('adds visits beyond the usual ones to construction and spreads the allowance across phases', () => {
    const p = priceEstimate({ ...base, visits: 3, usualVisits: 1, allowance: 5 })
    expect(p.total).toBe(55)
    expect(p.phases.construction).toBeCloseTo(12 + 5 * 12 / 50)
    expect(p.suggested).toBe(8250)
    expect(priceEstimate({ ...base, visits: 0, usualVisits: 1 }).phases.construction).toBe(3)
  })

  it('adds the rush premium and rounds up to the next $50', () => {
    expect(priceEstimate({ ...base, rushPercent: 25 }).suggested).toBe(8250)
    expect(roundFee(6601)).toBe(6650)
    expect(roundFee(6600)).toBe(6600)
  })

  it('never suggests less than the minimum fee', () => {
    const p = priceEstimate({ ...base, hours: { design: 2, plan_check: 0, construction: 0 }, minimumFee: 1200 })
    expect(p).toMatchObject({ suggested: 1200, minimumApplied: true, raw: 300 })
    expect(priceEstimate({ ...base, minimumFee: 1200 }).minimumApplied).toBe(false)
  })

  it('splits fees into whole dollars that add up', () => {
    const split = splitFee(1000, { design: 1, plan_check: 1, construction: 1 })
    expect(split.design + split.plan_check + split.construction).toBe(1000)
    expect(splitFee(500, { design: 4, plan_check: 0, construction: 0 })).toEqual({ design: 500, plan_check: 0, construction: 0 })
  })
})

describe('learning from finished jobs', () => {
  it('flags a phase that ran over its latest quote on most jobs', () => {
    const jobs = ['a', 'b', 'c'].map(id => job(id))
    const s = store(jobs, [
      hours('a', 'construction', 10), hours('b', 'construction', 9), hours('c', 'construction', 6), ...jobs.map(j => hours(j.id, 'design', 30)),
    ], [], [quote('a', 30, 8, 2, '2026-01-01T00:00:00Z'), quote('a', 30, 8, 6, '2026-01-09T00:00:00Z'), quote('b', 30, 8, 6), quote('c', 30, 8, 6)])
    expect(overruns(finishedJobs(s, 'adu'))).toEqual([{ phase: 'construction', over: 2, of: 3, avgOver: 3.5 }])
  })

  it('counts closeout reasons and works out hours per unit of size', () => {
    const s = store([job('a', { size: 600, closeout_reason: 'Existing conditions' }), job('b', { size: 400, closeout_reason: 'Existing conditions' }), job('c')],
      [hours('a', 'design', 30), hours('b', 'design', 20), hours('c', 'design', 5)], [invoice('a', 6000), invoice('b', 4000)])
    const f = finishedJobs(s, 'adu')
    expect(closeoutReasons(f)).toEqual([['Existing conditions', 2]])
    expect(perUnit(f)).toEqual({ hours: 0.05, fee: 10, jobs: 2 })
    expect(unitScale(0.05)).toBe(100)
    expect(unitScale(3)).toBe(1)
  })
})

describe('proposal text', () => {
  const input = {
    job: { name: 'Smith ADU', address: '1 Main St', description: 'New ADU over garage.' }, client: 'Smith Family', fee: 7000,
    split: { design: 5000, plan_check: 1200, construction: 800 }, showBreakdown: true, visits: 2, retainerPercent: 0, today: new Date(2026, 9, 21),
  }

  it('fills the standard wording and drops lines with nothing to show', () => {
    const text = proposalText('', input)
    expect(text).toContain('Structural engineering proposal: Smith ADU')
    expect(text).toContain('Construction support: 2 site visits and answers to contractor questions')
    expect(text).toContain('Design (calculations and drawings): $5,000')
    expect(text).toContain('Total professional fee: $7,000')
    expect(text).not.toContain('Retainer')
    expect(text).toContain('valid until Fri, Nov 20, 2026')
  })

  it('adds the retainer, hides the breakdown on request and keeps unknown fields as typed', () => {
    const text = proposalText('Fee {fee}\n{breakdown}\nRetainer {retainer}\nCall me {soon}', { ...input, showBreakdown: false, retainerPercent: 25 })
    expect(text).toBe('Fee $7,000\nRetainer $1,750\nCall me {soon}')
  })
})

describe('past records and best guesses', () => {
  it('summarizes what was charged before the planner, leaving out excluded records', () => {
    const rec = (fee: number | null, use = true) => ({ job_type_id: 'adu', fee, use_in_estimates: use }) as import('./types').PastJob
    const ev = pastEvidence({ pastJobs: [rec(3000), rec(5000), rec(4000), rec(9000, false), rec(null)] }, 'adu')
    expect(ev).toMatchObject({ low: 3000, high: 5000, middle: 4000 })
    expect(ev?.jobs).toHaveLength(3)
    expect(pastEvidence({ pastJobs: [] }, 'adu')).toBeNull()
  })

  it('falls back to the average of the other types when a type has no hours', () => {
    const blank = { ...adu, id: 'blank', design_hours: 0, plan_check_hours: 0, construction_hours: 0 }
    const deck = { ...adu, id: 'deck', design_hours: 10, plan_check_hours: 2, construction_hours: 0, site_visits: 1 }
    const fb = fallbackHours({ ...store([], []), jobTypes: [adu, deck, blank] }, 'blank')
    expect(fb).toEqual({ types: 2, hours: { design: 20, plan_check: 5, construction: (6 + 3) / 2 } })
  })
})
