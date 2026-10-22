import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compareClientJobs, openClientJobs, reorderClientJobs } from './clientJobs'
import type { Job } from './types'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: { rpc } }))
const job = (id: string, priority: number, patch: Partial<Job> = {}): Job => ({
  id, priority, client_id: 'client', status: 'active', created_at: '2026-01-01T00:00:00Z', ...patch,
} as Job)
const store = () => ({ refresh: vi.fn().mockResolvedValue(undefined), toast: vi.fn() })
beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }) })

describe('client job order', () => {
  it('uses client priorities independently of the overall queue, with legacy fallback', () => {
    const first = job('first', 90, { client_priority: 1 })
    const second = job('second', 2, { client_priority: 2 })
    expect([second, first].sort(compareClientJobs).map(j => j.id)).toEqual(['first', 'second'])
    expect([job('legacy-later', 7), job('legacy-first', 3, { client_priority: null })].sort(compareClientJobs).map(j => j.id))
      .toEqual(['legacy-first', 'legacy-later'])
    expect(compareClientJobs(job('a', 1), job('b', 1))).toBeLessThan(0)
  })

  it('includes only this client’s active and on-hold jobs without mutating input', () => {
    const jobs = [job('hold', 2, { status: 'on_hold' }), job('done', 1, { status: 'complete' }), job('open', 1),
      job('other', 0, { client_id: 'other' }), job('cancelled', 3, { status: 'cancelled' }), job('archived', 4, { status: 'archived' })]
    expect(openClientJobs(jobs, 'client').map(j => j.id)).toEqual(['open', 'hold'])
    expect(jobs[0].id).toBe('hold')
  })

  it('sends the expected and requested order to one atomic RPC and refreshes jobs', async () => {
    const data = store(), a = job('a', 1), b = job('b', 2)
    expect(await reorderClientJobs(data, 'client', [a, b], [b, a])).toBe(true)
    expect(rpc).toHaveBeenCalledWith('reorder_client_jobs', { p_client_id: 'client', p_expected_ids: ['a', 'b'], p_ordered_ids: ['b', 'a'] })
    expect(data.refresh).toHaveBeenCalledWith('jobs')
    expect([a.priority, b.priority]).toEqual([1, 2])
  })

  it('does not write a no-op or accept missing, repeated or foreign jobs', async () => {
    const data = store(), a = job('a', 1), b = job('b', 2), foreign = job('foreign', 3, { client_id: 'other' })
    expect(await reorderClientJobs(data, 'client', [a, b], [a, b])).toBe(true)
    for (const ordered of [[a], [a, a], [b, foreign]]) {
      expect(await reorderClientJobs(data, 'client', [a, b], ordered)).toBe(false)
    }
    expect(await reorderClientJobs(data, 'client', [a, a], [a, a])).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refreshes and reports conflicts instead of claiming that a stale order saved', async () => {
    const data = store(), a = job('a', 1), b = job('b', 2)
    rpc.mockResolvedValue({ error: { code: '40001', message: 'stale' } })
    expect(await reorderClientJobs(data, 'client', [a, b], [b, a])).toBe(false)
    expect(data.refresh).toHaveBeenCalledWith('jobs')
    expect(data.toast).toHaveBeenCalledWith('The job list changed. Try your move again.', 'error')
  })

  it('reports server and network failures', async () => {
    const data = store(), a = job('a', 1), b = job('b', 2)
    rpc.mockResolvedValueOnce({ error: { message: 'Access denied' } })
    expect(await reorderClientJobs(data, 'client', [a, b], [b, a])).toBe(false)
    expect(data.toast).toHaveBeenCalledWith('Could not save job priorities: Access denied', 'error')
    rpc.mockRejectedValueOnce(new Error('offline'))
    expect(await reorderClientJobs(data, 'client', [a, b], [b, a])).toBe(false)
    expect(data.toast).toHaveBeenLastCalledWith('Could not save job priorities. Check your connection and try again.', 'error')
  })
})
