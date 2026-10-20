// Fee estimator: typical hours for a job type, from the owner's starter numbers
// blended with the real hours on finished jobs of that type.
import type { Store } from './store'
import type { Job, JobType, PhaseKind } from './types'
import { jobBilling } from './calc'
import { sum } from './utils'

/** The phases a fee covers. Bidding is overhead; client changes are billed separately. */
export const FEE_PHASES = ['design', 'plan_check', 'construction'] as const
export type FeePhase = typeof FEE_PHASES[number]

export const FEE_PHASE_LABEL: Record<FeePhase, string> = {
  design: 'Design',
  plan_check: 'Plan check',
  construction: 'Construction',
}

export type PhaseHours = Record<FeePhase, number>

/** Starter numbers count as this many finished jobs, so one odd job can't swing the estimate. */
export const STARTER_WEIGHT = 2

export function starterHours(t: JobType): PhaseHours {
  return { design: Number(t.design_hours) || 0, plan_check: Number(t.plan_check_hours) || 0, construction: Number(t.construction_hours) || 0 }
}

export const totalHours = (h: PhaseHours) => sum(FEE_PHASES.map(k => h[k]))

/** Where a logged hour counts: hours with no phase are design work; other phases aren't part of the fee. */
function feePhase(kind: PhaseKind | undefined): FeePhase | null {
  if (!kind) return 'design'
  return (FEE_PHASES as readonly string[]).includes(kind) ? kind as FeePhase : null
}

export interface FinishedJob {
  job: Job
  hours: PhaseHours
  total: number
  revenue: number            // deposits + invoices (fee revenue), for "earned per hour"
  allHours: number           // every completed hour, including bidding and client changes
}

type EstimateStore = Pick<Store, 'jobs' | 'phases' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings'>

/** Complete or archived jobs of this type with fee-phase hours logged. Running timers don't count. */
export function finishedJobs(store: EstimateStore, typeId: string, exceptJobId?: string): FinishedJob[] {
  const kindOf = new Map(store.phases.map(p => [p.id, p.kind]))
  return store.jobs
    .filter(j => j.job_type_id === typeId && j.id !== exceptJobId && (j.status === 'complete' || j.status === 'archived'))
    .map(job => {
      const hours: PhaseHours = { design: 0, plan_check: 0, construction: 0 }
      for (const e of store.timeEntries) {
        if (e.job_id !== job.id || e.hours == null) continue
        const k = feePhase(e.phase_id ? kindOf.get(e.phase_id) : undefined)
        if (k) hours[k] += e.hours
      }
      const b = jobBilling(store, job)
      return { job, hours, total: totalHours(hours), revenue: b.feeRevenue, allHours: b.loggedHours }
    })
    .filter(f => f.total > 0)
    .sort((a, b) => (b.job.due_date ?? b.job.created_at).localeCompare(a.job.due_date ?? a.job.created_at))
}

export interface Estimate {
  hours: PhaseHours          // typical hours per phase
  total: number
  starter: PhaseHours
  hasStarter: boolean
  finished: FinishedJob[]
  low: number | null         // smallest finished job (hours), when there are 2+
  high: number | null
  earnedPerHour: number | null // what finished jobs of this type actually earned per hour
}

/**
 * Typical hours: the starter numbers count as STARTER_WEIGHT jobs, and each
 * finished job counts as one, so the estimate moves toward real hours as jobs finish.
 * With no starter numbers, it's simply the average of the finished jobs.
 */
export function estimateHours(store: EstimateStore, type: JobType, exceptJobId?: string): Estimate {
  const starter = starterHours(type)
  const hasStarter = totalHours(starter) > 0
  const finished = finishedJobs(store, type.id, exceptJobId)
  const weight = hasStarter ? STARTER_WEIGHT : 0
  const count = weight + finished.length
  const hours = { design: 0, plan_check: 0, construction: 0 } as PhaseHours
  if (count > 0) for (const k of FEE_PHASES) hours[k] = (starter[k] * weight + sum(finished.map(f => f.hours[k]))) / count
  const totals = finished.map(f => f.total)
  const revenue = sum(finished.map(f => f.revenue)), worked = sum(finished.map(f => f.allHours))
  return {
    hours, total: totalHours(hours), starter, hasStarter, finished,
    low: totals.length >= 2 ? Math.min(...totals) : null,
    high: totals.length >= 2 ? Math.max(...totals) : null,
    earnedPerHour: revenue > 0 && worked > 0 ? revenue / worked : null,
  }
}

/** Fees are quoted in round numbers: the next $50 up. */
export function roundFee(amount: number): number {
  return amount > 0 ? Math.ceil(amount / 50 - 1e-9) * 50 : 0
}

/** Split a fee across phases in proportion to their hours, in whole dollars that add up to the fee. */
export function splitFee(fee: number, hours: PhaseHours): Record<FeePhase, number> {
  const total = totalHours(hours)
  const out = { design: 0, plan_check: 0, construction: 0 } as Record<FeePhase, number>
  if (total <= 0 || fee <= 0) { out.design = Math.max(0, Math.round(fee)); return out }
  let left = Math.round(fee)
  const live = FEE_PHASES.filter(k => hours[k] > 0)
  live.forEach((k, i) => {
    out[k] = i === live.length - 1 ? left : Math.round(fee * hours[k] / total)
    left -= out[k]
  })
  return out
}

/** Phase estimates saved to a job are in half hours. */
export const halfHours = (h: number) => Math.round(h * 2) / 2
