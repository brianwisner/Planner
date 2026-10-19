import { describe, expect, it } from 'vitest'
import type { Store } from './store'
import type { PlanningStore, PlanningScheduleMove } from './planningTypes'
import { dayCapacity, defaultDailyHours, projectSchedule, scheduleMoveErrors, validPlanningDate } from './planningCapacity'
const entry = { id: 'plan', job_id: 'job', phase_id: 'design', user_id: 'owner', date: '2026-10-19', hours: 4, note: 'Keep saved note', created_at: '2026-10-18T12:00:00Z' }
const store = () => ({ me: { id: 'owner', weekly_hours: 40 }, settings: { weekly_capacity: 40 }, jobs: [{ id: 'job', status: 'active' }, { id: 'closed', status: 'complete' }, { id: 'held', status: 'on_hold' }], phases: [{ id: 'design', job_id: 'job', kind: 'design' }, { id: 'history', job_id: 'job', kind: 'queued' }], schedule: [entry] }) as Store
const planning = { availability: [], blocks: [] } as Pick<PlanningStore, 'availability' | 'blocks'>
const move = (patch: Partial<PlanningScheduleMove> = {}): PlanningScheduleMove => ({ id: 'plan', expected_job_id: 'job', expected_phase_id: 'design', expected_date: '2026-10-19', expected_hours: 4, date: '2026-10-20', hours: 3, ...patch })
describe('daily availability and staged schedule moves', () => {
  it('uses real local dates, rejects impossible days and leaves weekends free by default', () => {
    expect(validPlanningDate('2026-02-30')).toBe(false)
    expect(validPlanningDate('2028-02-29')).toBe(true)
    expect(validPlanningDate('2026-1-02')).toBe(false)
    expect(defaultDailyHours(store(), '2026-10-19')).toBe(8)
    expect(defaultDailyHours(store(), '2026-10-18')).toBe(0)
  })
  it('honors explicit zero and weekend overrides instead of falling back to weekly settings', () => {
    const state = { ...planning, availability: [{ date: '2026-10-19', base_hours: 0 }, { date: '2026-10-18', base_hours: 4 }] } as Pick<PlanningStore, 'availability' | 'blocks'>
    expect(dayCapacity(store(), state, '2026-10-19').availableHours).toBe(0)
    expect(dayCapacity(store(), state, '2026-10-18').availableHours).toBe(4)
  })
  it('deducts blocks once, clamps availability at zero and counts all active historical-owner and phase commitments', () => {
    const source = store(); source.schedule = [entry, { ...entry, id: 'legacy', user_id: 'legacy', phase_id: 'history', hours: 3 }, { ...entry, id: 'held', job_id: 'held', hours: 20 }, { ...entry, id: 'closed', job_id: 'closed', hours: 20 }]
    const state = { ...planning, blocks: [{ date: '2026-10-19', hours: 9 }] } as Pick<PlanningStore, 'availability' | 'blocks'>
    expect(dayCapacity(source, state, '2026-10-19')).toMatchObject({ baseHours: 8, blockedHours: 9, availableHours: 0, plannedHours: 7, overHours: 7, freeHours: -7 })
  })
  it('previews a move without mutating the saved record or its ownership, phase and note', () => {
    const source = store(), result = projectSchedule(source.schedule, [move()])
    expect(result[0]).toMatchObject({ date: '2026-10-20', hours: 3, phase_id: 'design', user_id: 'owner', note: 'Keep saved note' })
    expect(source.schedule[0]).toEqual(entry)
    expect(dayCapacity(source, planning, '2026-10-19', result).plannedHours).toBe(0)
    expect(dayCapacity(source, planning, '2026-10-20', result).plannedHours).toBe(3)
    expect(scheduleMoveErrors(source, [move()])).toEqual([])
  })
  it.each([{ expected_hours: 5 }, { expected_date: '2026-10-18' }, { expected_job_id: 'other' }, { expected_phase_id: null }])('rejects a stale saved-plan snapshot %j', patch => {
    expect(scheduleMoveErrors(store(), [move(patch)])).toContain('A saved plan changed while this preview was open. Discard the preview and review the latest plans.')
  })
  it.each([{ hours: -1 }, { hours: 0 }, { hours: 25 }, { hours: NaN }, { date: '2026-02-30' }])('rejects invalid target %j', patch => {
    expect(scheduleMoveErrors(store(), [move(patch)]).join(' ')).toContain('valid date and hours')
  })
  it('keeps inactive, foreign-owned and retired-phase records outside new moves', () => {
    const foreign = store(); foreign.schedule = [{ ...entry, user_id: 'legacy' }]
    expect(scheduleMoveErrors(foreign, [move()]).join(' ')).toContain('Only your saved plans')
    const retired = store(); retired.schedule = [{ ...entry, phase_id: 'history' }]
    expect(scheduleMoveErrors(retired, [move({ expected_phase_id: 'history' })]).join(' ')).toContain('Planning history stays')
    const closed = store(); closed.jobs[0].status = 'complete'
    expect(scheduleMoveErrors(closed, [move()]).join(' ')).toContain('active jobs')
  })
  it('rejects collisions for both named and General phases, including duplicate legacy slots', () => {
    for (const phase_id of ['design', null]) {
      const source = store(); source.schedule = [{ ...entry, phase_id }, { ...entry, id: 'occupied', phase_id, date: '2026-10-20' }]
      expect(scheduleMoveErrors(source, [move({ expected_phase_id: phase_id })]).join(' ')).toContain('already have a saved plan')
    }
  })
  it('permits an atomic date swap between selected records without merging either record', () => {
    const source = store(); source.schedule = [entry, { ...entry, id: 'second', date: '2026-10-20' }]
    const swaps = [move(), move({ id: 'second', expected_date: '2026-10-20', date: '2026-10-19', hours: 4 })]
    expect(scheduleMoveErrors(source, swaps)).toEqual([])
    expect(projectSchedule(source.schedule, swaps).map(row => row.id)).toEqual(['plan', 'second'])
  })
})
