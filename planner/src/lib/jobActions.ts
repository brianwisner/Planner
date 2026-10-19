// Job-level actions shared by the board, job page and menus. Each returns
// whether it saved, and offers Undo through the toast.
import type { Store } from './store'
import type { Job, JobStatus, Phase } from './types'
import { JOB_STATUS_LABEL } from './types'
import { STAGE_LABEL, stageChanges, type PhaseChange, type Stage } from './stages'

type ActionStore = Pick<Store, 'phases' | 'jobs' | 'update' | 'toast'>

async function applyChanges(store: Pick<Store, 'update'>, changes: { id: string; to: Phase['status'] }[]): Promise<boolean> {
  const results = await Promise.all(changes.map(c => store.update('phases', c.id, { status: c.to })))
  return results.every(Boolean)
}

export async function moveJobToStage(store: ActionStore, job: Job, stage: Stage, opts: { silent?: boolean } = {}): Promise<boolean> {
  const changes: PhaseChange[] = stageChanges(store.phases, job.id, stage)
  if (!changes.length) return true
  const ok = await applyChanges(store, changes)
  if (ok && !opts.silent) {
    store.toast(`${job.name} → ${STAGE_LABEL[stage]}`, 'ok', {
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

/** Save a queue order as priorities 1..n. Only changed rows are written. */
export async function reorderJobs(store: Pick<Store, 'update'>, ordered: Job[]): Promise<boolean> {
  const changed = ordered.map((job, i) => ({ job, priority: i + 1 })).filter(x => x.job.priority !== x.priority)
  const results = await Promise.all(changed.map(x => store.update('jobs', x.job.id, { priority: x.priority })))
  return results.every(Boolean)
}
