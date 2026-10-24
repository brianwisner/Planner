// Job-level actions shared by the board, job page and menus. Each returns
// whether it saved, and offers Undo through the toast.
import type { Store } from './store'
import type { Job, JobStatus, Phase } from './types'
import { JOB_STATUS_LABEL } from './types'
import { STAGES, STAGE_LABEL, stageChanges, type PhaseChange, type Stage } from './stages'

type ActionStore = Pick<Store, 'phases' | 'jobs' | 'update' | 'toast'> & Partial<Pick<Store, 'planRounds' | 'planComments'>>

/** Unticked comments in the job's latest round of plan check comments. */
function openPlanComments(store: ActionStore, jobId: string): number {
  const rounds = (store.planRounds ?? []).filter(r => r.job_id === jobId).sort((a, b) => b.round - a.round)
  return rounds.length ? (store.planComments ?? []).filter(c => c.round_id === rounds[0].id && !c.done).length : 0
}

async function applyChanges(store: Pick<Store, 'update'>, changes: { id: string; to: Phase['status'] }[]): Promise<boolean> {
  const results = await Promise.all(changes.map(c => store.update('phases', c.id, { status: c.to })))
  return results.every(Boolean)
}

export async function moveJobToStage(store: ActionStore, job: Job, stage: Stage, opts: { silent?: boolean } = {}): Promise<boolean> {
  const changes: PhaseChange[] = stageChanges(store.phases, job.id, stage)
  if (!changes.length) return true
  const ok = await applyChanges(store, changes)
  if (ok && !opts.silent) {
    // Moving past plan check with comments still open is allowed, but say so.
    const open = STAGES.indexOf(stage) > STAGES.indexOf('plan_check') ? openPlanComments(store, job.id) : 0
    const note = open ? ` · ${open} plan check comment${open === 1 ? ' is' : 's are'} still open` : ''
    store.toast(`${job.name} → ${STAGE_LABEL[stage]}${note}`, 'ok', {
      label: 'Undo',
      run: () => applyChanges(store, changes.map(c => ({ id: c.id, to: c.from }))),
    })
  }
  return ok
}

export async function setJobStatus(store: ActionStore, job: Job, status: JobStatus): Promise<boolean> {
  if (job.status === status) return true
  const before = job.status
  const ok = await store.update('jobs', job.id, { status })
  if (ok) store.toast(`${job.name} is now ${JOB_STATUS_LABEL[status].toLowerCase()}`, 'ok', {
    label: 'Undo', run: () => store.update('jobs', job.id, { status: before }),
  })
  return ok
}

/**
 * The full queue after reordering some of it. Jobs that were not visible keep
 * their places; the visible ones fill their own slots in the new order.
 */
export function mergeOrder(queue: Job[], visibleInNewOrder: Job[]): Job[] {
  const visible = new Set(visibleInNewOrder.map(j => j.id))
  const next = [...visibleInNewOrder]
  return queue.map(job => visible.has(job.id) ? next.shift()! : job)
}

/**
 * Priority numbers for a queue order: 1, 2, 3… skipping numbers that closed
 * jobs still hold, so a job reopened later never shares a number.
 */
export function priorityNumbers(count: number, reserved: number[] = []): number[] {
  const taken = new Set(reserved)
  const out: number[] = []
  for (let n = 1; out.length < count; n++) if (!taken.has(n)) out.push(n)
  return out
}

/** Save a queue order. Only rows whose number changes are written. */
export async function reorderJobs(store: Pick<Store, 'update'>, ordered: Job[], reserved: number[] = []): Promise<boolean> {
  const numbers = priorityNumbers(ordered.length, reserved)
  const changed = ordered.map((job, i) => ({ job, priority: numbers[i] })).filter(x => x.job.priority !== x.priority)
  const results = await Promise.all(changed.map(x => store.update('jobs', x.job.id, { priority: x.priority })))
  return results.every(Boolean)
}
