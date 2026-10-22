// A client's priorities are separate from the overall Jobs queue.
import { supabase } from './supabase'
import type { Store } from './store'
import type { Job } from './types'

type OrderedJob = Pick<Job, 'id' | 'priority' | 'client_priority' | 'created_at'>

/** Older rows without a client priority retain their overall queue order. */
export function compareClientJobs(a: OrderedJob, b: OrderedJob): number {
  return (a.client_priority ?? a.priority) - (b.client_priority ?? b.priority)
    || a.priority - b.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

/** Active and on-hold jobs form the editable priority list. */
export function openClientJobs(jobs: readonly Job[], clientId: string): Job[] {
  return jobs.filter(j => j.client_id === clientId && (j.status === 'active' || j.status === 'on_hold')).sort(compareClientJobs)
}

/** Save one complete open-job order, rejecting a stale list instead of overwriting it. */
export async function reorderClientJobs(
  store: Pick<Store, 'refresh' | 'toast'>,
  clientId: string,
  expected: readonly Job[],
  ordered: readonly Job[],
): Promise<boolean> {
  const expectedIds = expected.map(j => j.id)
  const orderedIds = ordered.map(j => j.id)
  const invalid = expected.some(j => j.client_id !== clientId || !['active', 'on_hold'].includes(j.status))
    || ordered.some(j => j.client_id !== clientId)
    || new Set(expectedIds).size !== expectedIds.length
    || orderedIds.length !== expectedIds.length || new Set(orderedIds).size !== orderedIds.length
    || orderedIds.some(id => !expectedIds.includes(id))
  if (invalid) { store.toast('The job list changed. Refresh it and try again.', 'error'); return false }
  if (orderedIds.every((id, i) => id === expectedIds[i])) return true
  try {
    const { error } = await supabase.rpc('reorder_client_jobs', {
      p_client_id: clientId, p_expected_ids: expectedIds, p_ordered_ids: orderedIds,
    })
    await store.refresh('jobs')
    if (error) {
      store.toast(error.code === '40001' ? 'The job list changed. Try your move again.' : `Could not save job priorities: ${error.message}`, 'error')
      return false
    }
    return true
  } catch {
    store.toast('Could not save job priorities. Check your connection and try again.', 'error')
    return false
  }
}
