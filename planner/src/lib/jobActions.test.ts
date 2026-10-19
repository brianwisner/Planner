import { describe, expect, it, vi } from 'vitest'
import { mergeOrder, reorderJobs } from './jobActions'
import type { Job } from './types'

const job = (id: string, priority: number) => ({ id, priority }) as Job

describe('mergeOrder', () => {
  it('reorders the visible jobs inside their own slots', () => {
    const queue = [job('a', 1), job('b', 2), job('c', 3), job('d', 4)]
    // only b and d were visible (filtered list); the user put d first
    expect(mergeOrder(queue, [queue[3], queue[1]]).map(j => j.id)).toEqual(['a', 'd', 'c', 'b'])
  })
  it('keeps the queue when nothing moved', () => {
    const queue = [job('a', 1), job('b', 2)]
    expect(mergeOrder(queue, queue).map(j => j.id)).toEqual(['a', 'b'])
  })
})

describe('reorderJobs', () => {
  it('writes only priorities that changed', async () => {
    const update = vi.fn().mockResolvedValue(true)
    await reorderJobs({ update } as never, [job('a', 1), job('c', 3), job('b', 2)])
    expect(update.mock.calls).toEqual([['jobs', 'c', { priority: 2 }], ['jobs', 'b', { priority: 3 }]])
  })
})
