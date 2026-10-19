import { describe, expect, it, vi } from 'vitest'
import { setPlannedHours } from './schedule'
import type { Phase, ScheduleEntry } from './types'

const me = { id: 'me' }
const phase = { id: 'p-design', job_id: 'j', kind: 'design', name: 'Design', sort_order: 2, status: 'in_progress' } as Phase
const entry = (over: Partial<ScheduleEntry>) => ({ id: 'e', job_id: 'j', phase_id: 'p-design', user_id: 'me', date: '2026-10-20', hours: 2, note: '', created_at: '', ...over }) as ScheduleEntry
const store = (schedule: ScheduleEntry[]) => ({
  schedule, phases: [phase], me, insert: vi.fn().mockResolvedValue({ id: 'new' }), update: vi.fn().mockResolvedValue(true), remove: vi.fn().mockResolvedValue(true),
}) as never as Parameters<typeof setPlannedHours>[0] & { insert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }

describe('setPlannedHours', () => {
  it('creates a plan on the current work phase', async () => {
    const s = store([])
    expect(await setPlannedHours(s, 'j', '2026-10-20', 3)).toBe(true)
    expect(s.insert).toHaveBeenCalledWith('schedule_entries', { job_id: 'j', phase_id: 'p-design', user_id: 'me', date: '2026-10-20', hours: 3 })
  })
  it('edits an existing plan and removes it at zero', async () => {
    const s = store([entry({})])
    await setPlannedHours(s, 'j', '2026-10-20', 4)
    expect(s.update).toHaveBeenCalledWith('schedule_entries', 'e', { hours: 4 })
    await setPlannedHours(s, 'j', '2026-10-20', 0)
    expect(s.remove).toHaveBeenCalledWith('schedule_entries', 'e')
  })
  it('asks for a phase-by-phase edit when a day has several phases', async () => {
    const s = store([entry({ id: 'a' }), entry({ id: 'b', phase_id: 'p-other' })])
    expect(await setPlannedHours(s, 'j', '2026-10-20', 5)).toBe('multi')
    expect(s.update).not.toHaveBeenCalled()
  })
  it('leaves other people’s plans alone', async () => {
    const s = store([entry({ user_id: 'someone-else' })])
    await setPlannedHours(s, 'j', '2026-10-20', 1)
    expect(s.update).not.toHaveBeenCalled()
    expect(s.insert).toHaveBeenCalled()
  })
})
