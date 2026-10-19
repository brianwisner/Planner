// Planned hours (schedule_entries): hours you intend to spend on a job on a day.
// One row per (job, phase, person, day). Typing a number edits that row; 0 or
// blank removes it. Plans other people made in the past are left alone.
import type { Store } from './store'
import type { ScheduleEntry } from './types'
import { workPhase } from './calc'

type PlanStore = Pick<Store, 'schedule' | 'phases' | 'me' | 'insert' | 'update' | 'remove'>

export function ownPlans(store: Pick<Store, 'schedule' | 'me'>, jobId: string, date: string): ScheduleEntry[] {
  return store.schedule.filter(s => s.job_id === jobId && s.date === date && s.user_id === store.me?.id)
}

/** 'multi' means the day already has plans on more than one phase: edit them one by one. */
export async function setPlannedHours(store: PlanStore, jobId: string, date: string, hours: number, phaseId?: string | null): Promise<boolean | 'multi'> {
  if (!store.me) return false
  const rows = ownPlans(store, jobId, date).filter(r => phaseId === undefined || r.phase_id === phaseId)
  if (rows.length > 1) return 'multi'
  const row = rows[0]
  if (row) {
    if (hours <= 0) return store.remove('schedule_entries', row.id)
    if (row.hours === hours) return true
    return store.update('schedule_entries', row.id, { hours })
  }
  if (hours <= 0) return true
  const phase = phaseId !== undefined ? phaseId : workPhase(store.phases, jobId)?.id ?? null
  return Boolean(await store.insert('schedule_entries', { job_id: jobId, phase_id: phase, user_id: store.me.id, date, hours }))
}
