// Fee estimator: typical hours for a job type, from the owner's starter numbers
// blended with the real hours on finished jobs of that type; pricing with site
// visits, an allowance and rush premium; saved quotes vs. actual hours; and
// the proposal text.
import type { Store } from './store'
import type { Job, JobType, PastJob, PhaseKind, Quote } from './types'
import { jobBilling } from './calc'
import { fmtDate, fmtMoney, sum } from './utils'

/** The phases a fee covers. Bidding is overhead; client changes are billed separately. */
export const FEE_PHASES = ['design', 'plan_check', 'construction'] as const
export type FeePhase = typeof FEE_PHASES[number]

export const FEE_PHASE_LABEL: Record<FeePhase, string> = {
  design: 'Design',
  plan_check: 'Plan check',
  construction: 'Construction',
}

export type PhaseHours = Record<FeePhase, number>
const noHours = (): PhaseHours => ({ design: 0, plan_check: 0, construction: 0 })

/** Starter numbers count as this many finished jobs, so one odd job can't swing the estimate. */
export const STARTER_WEIGHT = 2

/**
 * The type's starter hours. Real construction hours include the site visits made,
 * so the usual visits are counted into starter Construction to compare like with like.
 */
export function starterHours(t: JobType, visitHours = 0): PhaseHours {
  return {
    design: Number(t.design_hours) || 0, plan_check: Number(t.plan_check_hours) || 0,
    construction: (Number(t.construction_hours) || 0) + (Number(t.site_visits) || 0) * Math.max(0, visitHours),
  }
}

export const totalHours = (h: PhaseHours) => sum(FEE_PHASES.map(k => h[k]))

/** Where a logged hour counts: hours with no phase are design work (and flagged); other phases aren't part of the fee. */
function feePhase(kind: PhaseKind | undefined): FeePhase | null {
  if (!kind) return 'design'
  return (FEE_PHASES as readonly string[]).includes(kind) ? kind as FeePhase : null
}

type EstimateStore = Pick<Store, 'jobs' | 'jobTypes' | 'phases' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings' | 'quotes'>

/** The quote saved most recently for a job: the baseline its hours are compared with. */
export function latestQuote(store: Pick<Store, 'quotes'>, jobId: string): Quote | undefined {
  let latest: Quote | undefined
  for (const q of store.quotes) if (q.job_id === jobId && (!latest || q.created_at >= latest.created_at)) latest = q
  return latest
}

export function quotedHours(q: Quote): PhaseHours {
  return { design: Number(q.design_hours) || 0, plan_check: Number(q.plan_check_hours) || 0, construction: Number(q.construction_hours) || 0 }
}

export interface JobActuals {
  hours: PhaseHours          // fee-phase hours, with unphased hours counted as design
  total: number
  unphased: number           // hours logged with no phase (included in design)
  clientChanges: number
  bidding: number
}

/** Completed hours on a job by fee phase. Running timers don't count. */
export function jobActuals(store: Pick<Store, 'phases' | 'timeEntries'>, jobId: string): JobActuals {
  const kindOf = new Map(store.phases.filter(p => p.job_id === jobId).map(p => [p.id, p.kind]))
  const out: JobActuals = { hours: noHours(), total: 0, unphased: 0, clientChanges: 0, bidding: 0 }
  for (const e of store.timeEntries) {
    if (e.job_id !== jobId || e.hours == null) continue
    const kind = e.phase_id ? kindOf.get(e.phase_id) : undefined
    if (!kind) out.unphased += e.hours
    if (kind === 'client_changes') out.clientChanges += e.hours
    if (kind === 'bidding' || kind === 'queued') out.bidding += e.hours
    const k = feePhase(kind)
    if (k) out.hours[k] += e.hours
  }
  out.total = totalHours(out.hours)
  return out
}

export interface FinishedJob extends JobActuals {
  job: Job
  revenue: number            // deposits + invoices (fee revenue)
  allHours: number           // every completed hour, including bidding and client changes
  valueAtRates: number       // all hours at the rates saved on them when logged
  quote?: Quote
}

const isClosed = (j: Job) => j.status === 'complete' || j.status === 'archived'

/** Complete or archived jobs of this type, kept in estimates, with fee-phase hours logged. */
export function finishedJobs(store: EstimateStore, typeId: string, exceptJobId?: string): FinishedJob[] {
  return store.jobs
    .filter(j => j.job_type_id === typeId && j.id !== exceptJobId && isClosed(j) && j.use_in_estimates !== false)
    .map(job => {
      const b = jobBilling(store, job)
      return { job, ...jobActuals(store, job.id), revenue: b.feeRevenue, allHours: b.loggedHours, valueAtRates: b.hoursValue, quote: latestQuote(store, job.id) }
    })
    .filter(f => f.total > 0)
    .sort((a, b) => (b.job.due_date ?? b.job.created_at).localeCompare(a.job.due_date ?? a.job.created_at))
}

/** Finished jobs of this type that were left out of estimates. */
export function excludedJobs(store: Pick<Store, 'jobs'>, typeId: string): Job[] {
  return store.jobs.filter(j => j.job_type_id === typeId && isClosed(j) && j.use_in_estimates === false)
}

export interface Estimate {
  hours: PhaseHours          // typical hours per phase
  total: number
  starter: PhaseHours
  hasStarter: boolean
  finished: FinishedJob[]
  low: number | null         // smallest finished job (hours), when there are 2+
  high: number | null
  median: number | null      // the middle finished job, when there are 3+
  earnedPerHour: number | null // fees ÷ all hours on finished jobs
  rateThen: number | null      // what those hours were worth per hour at the rates saved on them
  unphased: number           // hours with no phase on finished jobs (counted as design)
}

function median(values: number[]): number | null {
  if (values.length < 3) return null
  const v = [...values].sort((a, b) => a - b), m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * Typical hours: the starter numbers count as STARTER_WEIGHT jobs, and each
 * finished job counts as one, so the estimate moves toward real hours as jobs finish.
 * With no starter numbers, it's simply the average of the finished jobs.
 */
export function estimateHours(store: EstimateStore, type: JobType, exceptJobId?: string): Estimate {
  const starter = starterHours(type, Number(store.settings.site_visit_hours) || 0)
  const hasStarter = totalHours(starter) > 0
  const finished = finishedJobs(store, type.id, exceptJobId)
  const weight = hasStarter ? STARTER_WEIGHT : 0
  const count = weight + finished.length
  const hours = noHours()
  if (count > 0) for (const k of FEE_PHASES) hours[k] = (starter[k] * weight + sum(finished.map(f => f.hours[k]))) / count
  const totals = finished.map(f => f.total)
  // Totals across jobs (not an average of each job's rate), so a 2-hour job can't outweigh a 100-hour one.
  const paid = finished.filter(f => f.revenue > 0)
  const revenue = sum(paid.map(f => f.revenue)), worked = sum(paid.map(f => f.allHours)), value = sum(paid.map(f => f.valueAtRates))
  return {
    hours, total: totalHours(hours), starter, hasStarter, finished,
    low: totals.length >= 2 ? Math.min(...totals) : null,
    high: totals.length >= 2 ? Math.max(...totals) : null,
    median: median(totals),
    earnedPerHour: revenue > 0 && worked > 0 ? revenue / worked : null,
    rateThen: value > 0 && worked > 0 ? value / worked : null,
    unphased: sum(finished.map(f => f.unphased)),
  }
}

/** Past jobs (from before the planner) of this type with a fee: what you charged before. */
export interface PastEvidence { jobs: PastJob[]; low: number; high: number; middle: number }

export function pastEvidence(store: Pick<Store, 'pastJobs'>, typeId: string): PastEvidence | null {
  const jobs = store.pastJobs.filter(p => p.job_type_id === typeId && p.use_in_estimates !== false && (p.fee ?? 0) > 0)
  if (!jobs.length) return null
  const fees = jobs.map(p => p.fee!).sort((a, b) => a - b)
  const m = Math.floor(fees.length / 2)
  return { jobs, low: fees[0], high: fees[fees.length - 1], middle: fees.length % 2 ? fees[m] : (fees[m - 1] + fees[m]) / 2 }
}

/**
 * A best guess for a type with no hours of its own: the average typical hours
 * of your other job types that have some.
 */
export function fallbackHours(store: EstimateStore, exceptTypeId: string): { hours: PhaseHours; types: number } | null {
  const visit = Number(store.settings.site_visit_hours) || 0
  const others = store.jobTypes.filter(t => t.id !== exceptTypeId).map(t => starterHours(t, visit)).filter(h => totalHours(h) > 0)
  if (!others.length) return null
  const hours = noHours()
  for (const k of FEE_PHASES) hours[k] = sum(others.map(h => h[k])) / others.length
  return { hours, types: others.length }
}

/* ---------------- Pricing ---------------- */

export interface PriceInputs {
  hours: PhaseHours          // the hours the owner settled on for each phase (construction includes the usual visits)
  visits: number             // site visits planned for this job
  usualVisits: number        // visits already counted in typical construction hours
  visitHours: number         // per visit, including travel and follow-up
  allowance: number          // hours for unknowns, spread across phases
  rushPercent: number
  rate: number
  minimumFee: number
}

export interface Priced {
  phases: PhaseHours         // final hours per phase, including visits and allowance
  total: number
  raw: number                // before rounding and the minimum
  suggested: number
  minimumApplied: boolean
}

export function priceEstimate(i: PriceInputs): Priced {
  // More or fewer visits than usual adjust Construction; the usual ones are already in it.
  const extra = (Math.max(0, i.visits) - Math.max(0, i.usualVisits)) * Math.max(0, i.visitHours)
  const phases = { ...i.hours, construction: Math.max(0, i.hours.construction + extra) }
  const before = totalHours(phases)
  const allowance = Math.max(0, i.allowance)
  if (allowance > 0) {
    if (before > 0) for (const k of FEE_PHASES) phases[k] += allowance * phases[k] / before
    else phases.design += allowance
  }
  const total = totalHours(phases)
  const raw = total * Math.max(0, i.rate) * (1 + Math.max(0, i.rushPercent) / 100)
  const rounded = roundFee(raw)
  const minimumApplied = i.minimumFee > rounded && total > 0
  return { phases, total, raw, suggested: minimumApplied ? roundFee(i.minimumFee) : rounded, minimumApplied }
}

/** Fees are quoted in round numbers: the next $50 up. */
export function roundFee(amount: number): number {
  return amount > 0 ? Math.ceil(amount / 50 - 1e-9) * 50 : 0
}

/** Split a fee across phases in proportion to their hours, in whole dollars that add up to the fee. */
export function splitFee(fee: number, hours: PhaseHours): Record<FeePhase, number> {
  const total = totalHours(hours)
  const out = noHours()
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

/* ---------------- Learning from finished jobs ---------------- */

export interface Overrun { phase: FeePhase; over: number; of: number; avgOver: number }

/** Phases that ran over their quote on at least half of the finished jobs that have one (and at least twice). */
export function overruns(finished: FinishedJob[]): Overrun[] {
  const quoted = finished.filter(f => f.quote)
  const out: Overrun[] = []
  for (const k of FEE_PHASES) {
    const diffs = quoted.map(f => f.hours[k] - quotedHours(f.quote!)[k])
    const over = diffs.filter(d => d >= 1)
    if (over.length >= 2 && over.length * 2 >= quoted.length) out.push({ phase: k, over: over.length, of: quoted.length, avgOver: sum(over) / over.length })
  }
  return out
}

/** How often each closeout reason was given on finished jobs, most common first. */
export function closeoutReasons(finished: FinishedJob[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const f of finished) if (f.job.closeout_reason) counts.set(f.job.closeout_reason, (counts.get(f.job.closeout_reason) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

export interface PerUnit { hours: number; fee: number | null; jobs: number }

/** Hours (and fee) per unit of size across finished jobs that recorded a size. */
export function perUnit(finished: FinishedJob[]): PerUnit | null {
  const sized = finished.filter(f => (f.job.size ?? 0) > 0)
  if (!sized.length) return null
  const size = sum(sized.map(f => f.job.size))
  const paid = sized.filter(f => f.revenue > 0)
  const paidSize = sum(paid.map(f => f.job.size))
  return { hours: sum(sized.map(f => f.total)) / size, fee: paidSize > 0 ? sum(paid.map(f => f.revenue)) / paidSize : null, jobs: sized.length }
}

/** Per-unit numbers are tiny for square feet: show them per 10, 100 or 1,000 units so they read as whole numbers. */
export function unitScale(perUnitValue: number): number {
  let scale = 1
  while (perUnitValue * scale < 1 && scale < 10000) scale *= 10
  return scale
}

/* ---------------- Proposal text ---------------- */

export const DEFAULT_PROPOSAL_TEMPLATE = `Structural engineering proposal: {job}
Client: {client}
Site: {address}
Date: {date}

Scope
{scope}

Included
- Structural calculations and drawings for the permit
- Responses to the building department's plan-check comments on the structural design
- {construction_support}

Not included (available as additional services, priced before work begins)
- Changes to the agreed design or scope after drawings are issued
- Site visits beyond those listed above
- Geotechnical, survey, special inspection and other consultants' work
- Temporary shoring design

Fee
{breakdown}
Total professional fee: {fee}
Retainer due at signing: {retainer}, credited toward the total fee
Expenses such as printing and permit fees are billed at cost.

This proposal is valid until {valid_until}.`

export const PROPOSAL_FIELDS: [string, string][] = [
  ['{job}', 'Job name'], ['{client}', 'Client'], ['{address}', 'Site address'], ['{date}', "Today's date"], ['{valid_until}', '30 days from today'],
  ['{scope}', "The job's scope / description"], ['{construction_support}', 'Site visits and contractor questions'], ['{breakdown}', 'Fee by phase (if shown)'],
  ['{fee}', 'Total fee'], ['{retainer}', 'Retainer amount'], ['{design_fee}', 'Design fee'], ['{plan_check_fee}', 'Plan check fee'], ['{construction_fee}', 'Construction fee'],
]

const PROPOSAL_PHASE_LABEL: Record<FeePhase, string> = { design: 'Design (calculations and drawings)', plan_check: 'Plan-check responses', construction: 'Construction support' }

export interface ProposalInputs {
  job?: Pick<Job, 'name' | 'address' | 'description'>
  client?: string
  fee: number
  split: Record<FeePhase, number>
  showBreakdown: boolean
  visits: number
  retainerPercent: number
  today: Date
}

/** Fill the template. A line whose fields are all blank (e.g. no retainer) is left out. */
export function proposalText(template: string, p: ProposalInputs): string {
  const valid = new Date(p.today); valid.setDate(valid.getDate() + 30)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const visits = Math.round(p.visits)
  const retainer = p.retainerPercent > 0 ? roundFee(p.fee * p.retainerPercent / 100) : 0
  const values: Record<string, string> = {
    job: p.job?.name ?? '', client: p.client ?? '', address: p.job?.address ?? '', scope: p.job?.description?.trim() ?? '',
    date: fmtDate(iso(p.today), 'long'), valid_until: fmtDate(iso(valid), 'long'),
    construction_support: visits > 0 ? `Construction support: ${visits} site visit${visits === 1 ? '' : 's'} and answers to contractor questions` : 'Construction support: answers to contractor questions',
    breakdown: p.showBreakdown ? FEE_PHASES.filter(k => p.split[k] > 0).map(k => `${PROPOSAL_PHASE_LABEL[k]}: ${fmtMoney(p.split[k])}`).join('\n') : '',
    fee: fmtMoney(p.fee), retainer: retainer > 0 ? fmtMoney(retainer) : '',
    design_fee: p.split.design > 0 ? fmtMoney(p.split.design) : '', plan_check_fee: p.split.plan_check > 0 ? fmtMoney(p.split.plan_check) : '', construction_fee: p.split.construction > 0 ? fmtMoney(p.split.construction) : '',
  }
  const lines: string[] = []
  for (const line of (template.trim() || DEFAULT_PROPOSAL_TEMPLATE).split('\n')) {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(k => k in values)
    if (keys.length && keys.every(k => !values[k])) continue
    lines.push(line.replace(/\{(\w+)\}/g, (all, k: string) => k in values ? values[k] : all))
  }
  // Leftover blank lines where a section emptied out collapse to one.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
