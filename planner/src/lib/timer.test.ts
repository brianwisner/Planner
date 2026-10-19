import { describe, expect, it, vi } from 'vitest'
import { needsReview, startTimer } from './timer'
import type { TimeEntry } from './types'

const me = { id: 'me' }
const running = (startedHoursAgo: number) => ({ id: 'r', job_id: 'j', user_id: 'me', started_at: new Date(Date.now() - startedHoursAgo * 3600000).toISOString(), hours: null }) as TimeEntry

describe('startTimer', () => {
  it('reuses a start that is still saving, so a double-click makes one timer', async () => {
    let resolve!: (v: unknown) => void
    const insert = vi.fn(() => new Promise(r => { resolve = r }))
    const store = { timeEntries: [], phases: [], me, insert, update: vi.fn(), toast: vi.fn() } as never
    const a = startTimer(store, { job_id: 'j' })
    const b = startTimer(store, { job_id: 'j' })
    resolve({ id: 'new' })
    await Promise.all([a, b])
    expect(insert).toHaveBeenCalledTimes(1)
  })
  it('stops the running timer before starting another', async () => {
    const update = vi.fn().mockResolvedValue(true)
    const insert = vi.fn().mockResolvedValue({ id: 'new' })
    await startTimer({ timeEntries: [running(1)], phases: [], me, insert, update, toast: vi.fn() } as never, { job_id: 'k' })
    expect(update).toHaveBeenCalledWith('time_entries', 'r', expect.objectContaining({ started_at: null }))
    expect(insert).toHaveBeenCalled()
  })
  it('refuses to start while a forgotten timer (over 12 hours) is running', async () => {
    const insert = vi.fn(), toast = vi.fn()
    expect(await startTimer({ timeEntries: [running(20)], phases: [], me, insert, update: vi.fn(), toast } as never, { job_id: 'k' })).toBeNull()
    expect(insert).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('over 12 hours'), 'error')
  })
})

describe('needsReview', () => {
  it('flags timers that ran all night', () => {
    expect(needsReview(running(2))).toBe(false)
    expect(needsReview(running(13))).toBe(true)
  })
})
