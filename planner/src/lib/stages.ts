// A job's "stage" is where it sits in the pipeline, worked out from its phase
// statuses. Moving a job to a stage updates those phase statuses for you, so
// there is one simple control (drag the card, or pick a stage) instead of
// editing each phase by hand.
import type { Job, Phase, PhaseKind, PhaseStatus } from './types'
import { isWorkflowPhase } from './phases'

export type Stage = 'bidding' | 'ready' | 'design' | 'plan_check' | 'construction'

export const STAGES: Stage[] = ['bidding', 'ready', 'design', 'plan_check', 'construction']

export const STAGE_LABEL: Record<Stage, string> = {
  bidding: 'Bidding',
  ready: 'Ready to start',
  design: 'Design',
  plan_check: 'Plan check',
  construction: 'Construction',
}

export const STAGE_HINT: Record<Stage, string> = {
  bidding: 'Pricing the work or waiting on a signed proposal',
  ready: 'Proposal accepted — waiting in your queue',
  design: 'Calcs and drawings',
  plan_check: 'Submitted — county comments and responses',
  construction: 'Permit issued — RFIs, site visits, changes',
}

/** The phase kinds that make up the main path, in order. */
const MAIN: PhaseKind[] = ['bidding', 'design', 'plan_check', 'construction']

const ACTIVE: PhaseStatus[] = ['in_progress', 'waiting']

export interface JobStage {
  stage: Stage
  /** The phase the stage is based on (null when the job has no phases). */
  phase: Phase | null
  /** The phase is started, waiting on someone, or not started yet. */
  state: 'working' | 'waiting' | 'not_started' | 'done'
  /** Client-requested changes are side work that can run during any stage. */
  clientChanges: Phase | null
  /** Every main phase is complete. */
  allDone: boolean
}

export function mainPhases(phases: Phase[], jobId: string): Phase[] {
  return phases
    .filter(p => p.job_id === jobId && isWorkflowPhase(p) && MAIN.includes(p.kind))
    .sort((a, b) => MAIN.indexOf(a.kind) - MAIN.indexOf(b.kind) || a.sort_order - b.sort_order)
}

export function jobStage(phases: Phase[], jobId: string): JobStage {
  const main = mainPhases(phases, jobId)
  const side = phases.find(p => p.job_id === jobId && p.kind === 'client_changes' && ACTIVE.includes(p.status)) ?? null
  const active = main.filter(p => ACTIVE.includes(p.status))
  const allDone = main.length > 0 && main.every(p => p.status === 'complete')
  if (active.length) {
    const phase = active[active.length - 1]
    return { stage: phase.kind as Stage, phase, state: phase.status === 'waiting' ? 'waiting' : 'working', clientChanges: side, allDone }
  }
  const next = main.find(p => p.status !== 'complete')
  if (!next) {
    const last = main[main.length - 1] ?? null
    return { stage: last ? last.kind as Stage : 'bidding', phase: last, state: last ? 'done' : 'not_started', clientChanges: side, allDone }
  }
  if (next.kind === 'bidding') return { stage: 'bidding', phase: next, state: 'not_started', clientChanges: side, allDone }
  if (next.kind === 'design') return { stage: 'ready', phase: next, state: 'not_started', clientChanges: side, allDone }
  return { stage: next.kind as Stage, phase: next, state: 'not_started', clientChanges: side, allDone }
}

export interface PhaseChange { id: string; from: PhaseStatus; to: PhaseStatus }

/**
 * The phase status changes that put a job in a stage:
 * earlier main phases become complete, the stage's phase is started, and
 * later phases that were started go back to not started.
 */
export function stageChanges(phases: Phase[], jobId: string, target: Stage): PhaseChange[] {
  const main = mainPhases(phases, jobId)
  const targetKind: PhaseKind = target === 'ready' ? 'design' : target
  const idx = main.findIndex(p => p.kind === targetKind)
  if (idx < 0) return []
  const changes: PhaseChange[] = []
  const set = (p: Phase, to: PhaseStatus) => { if (p.status !== to) changes.push({ id: p.id, from: p.status, to }) }
  main.forEach((p, i) => {
    if (i < idx) set(p, 'complete')
    else if (i === idx) {
      if (target === 'ready') set(p, 'not_started')
      else if (p.status !== 'waiting') set(p, 'in_progress')
    } else if (ACTIVE.includes(p.status) || (target === 'ready' && p.status === 'complete')) set(p, 'not_started')
  })
  return changes
}

/** Jobs that belong on the pipeline board. */
export function isOpenJob(job: Pick<Job, 'status'>): boolean {
  return job.status === 'active' || job.status === 'on_hold'
}
