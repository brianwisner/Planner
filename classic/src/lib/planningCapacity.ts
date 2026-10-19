import { format, isValid, parseISO } from 'date-fns'
import type { Store } from './store'
import type { PlanningScheduleMove, PlanningStore } from './planningTypes'
import type { ScheduleEntry } from './types'
import { isWorkflowPhase } from './phases'

type CapacityStore = Pick<Store, 'settings' | 'me' | 'jobs' | 'schedule'>
type CapacityPlanning = Pick<PlanningStore, 'availability' | 'blocks'>
export function validPlanningDate(value: string) {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false
  const date = parseISO(value)
  return isValid(date) && format(date, 'yyyy-MM-dd') === value
}
const hours = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
export function defaultDailyHours(store: Pick<Store, 'me' | 'settings'>, date: string) {
  if (!validPlanningDate(date)) return 0
  const day = parseISO(date).getDay()
  return day === 0 || day === 6 ? 0 : Math.min(24, hours(store.me?.weekly_hours ?? store.settings.weekly_capacity ?? 40) / 5)
}
/** Whole-day availability; planned hours and actual worked hours are never added together. */
export function dayCapacity(store: CapacityStore, planning: CapacityPlanning, date: string, schedule = store.schedule) {
  const override = planning.availability.find(row => row.date === date)
  const baseHours = override ? hours(override.base_hours) : defaultDailyHours(store, date)
  const blocks = planning.blocks.filter(row => row.date === date)
  const blockedHours = blocks.reduce((total, row) => total + hours(row.hours), 0)
  const availableHours = Math.max(0, baseHours - blockedHours)
  const active = new Set(store.jobs.filter(job => job.status === 'active').map(job => job.id))
  const plans = schedule.filter(row => row.date === date && active.has(row.job_id))
  const plannedHours = plans.reduce((total, row) => total + hours(row.hours), 0)
  return { override, blocks, plans, baseHours, blockedHours, availableHours, plannedHours, freeHours: availableHours - plannedHours, overHours: Math.max(0, plannedHours - availableHours) }
}
export function projectSchedule(schedule: ScheduleEntry[], moves: PlanningScheduleMove[]): ScheduleEntry[] {
  const byId = new Map(moves.map(move => [move.id, move]))
  return schedule.map(row => { const move = byId.get(row.id); return move ? { ...row, date: move.date, hours: move.hours } : row })
}
export function scheduleMoveErrors(store: Pick<Store, 'schedule' | 'jobs' | 'phases' | 'me'>, moves: PlanningScheduleMove[]): string[] {
  const errors: string[] = [], seen = new Set<string>()
  for (const move of moves) {
    const row = store.schedule.find(row => row.id === move.id)
    if (seen.has(move.id)) errors.push('A saved plan is included more than once.')
    seen.add(move.id)
    if (!row || row.date !== move.expected_date || Number(row.hours) !== Number(move.expected_hours) || row.job_id !== move.expected_job_id || row.phase_id !== move.expected_phase_id) { errors.push('A saved plan changed while this preview was open. Discard the preview and review the latest plans.'); continue }
    if (row.user_id !== store.me?.id || store.jobs.find(job => job.id === row.job_id)?.status !== 'active') errors.push('Only your saved plans on active jobs can be moved here.')
    const phase = store.phases.find(phase => phase.id === row.phase_id)
    if (row.phase_id && (!phase || phase.job_id !== row.job_id || !isWorkflowPhase(phase))) errors.push('Planning history stays on its saved dates. Use the timeline to edit existing hours.')
    if (!validPlanningDate(move.date) || !Number.isFinite(move.hours) || move.hours <= 0 || move.hours > 24) errors.push('Choose a valid date and hours greater than zero and no more than 24.')
  }
  const projected = projectSchedule(store.schedule, moves)
  for (const move of moves) {
    const row = projected.find(row => row.id === move.id)
    if (row && projected.some(other => other.id !== row.id && other.job_id === row.job_id && other.phase_id === row.phase_id && other.user_id === row.user_id && other.date === row.date)) errors.push('That job and phase already have a saved plan on the target date. Edit the existing plan on the timeline instead of combining records here.')
  }
  return [...new Set(errors)]
}
