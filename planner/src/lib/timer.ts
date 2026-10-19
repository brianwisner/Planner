// Start/stop the work timer. Only one timer runs at a time: starting a new one
// stops (and saves) the one already running.
import type { Store } from './store'
import type { TimeEntry } from './types'
import { timerHours, workPhase } from './calc'
import { todayISO } from './utils'

type TimerStore = Pick<Store, 'timeEntries' | 'phases' | 'me' | 'insert' | 'update' | 'toast'>

export function runningTimer(store: Pick<Store, 'timeEntries' | 'me'>): TimeEntry | undefined {
  return store.timeEntries.find(e => e.started_at && e.hours == null && (!store.me || e.user_id === store.me.id))
}

export async function stopTimer(store: TimerStore, entry: TimeEntry): Promise<boolean> {
  const hours = timerHours(entry)
  const ok = await store.update('time_entries', entry.id, { hours, started_at: null })
  if (ok) store.toast(`Saved ${hours} h`)
  return ok
}

export async function startTimer(store: TimerStore, opts: { job_id: string; phase_id?: string | null; task_id?: string | null; billable?: boolean; notes?: string }): Promise<TimeEntry | null> {
  if (!store.me) { store.toast('Sign in again to start a timer.', 'error'); return null }
  for (const other of store.timeEntries.filter(e => e.user_id === store.me!.id && e.started_at && e.hours == null)) {
    if (!await store.update('time_entries', other.id, { hours: timerHours(other), started_at: null })) return null
  }
  const phase = opts.phase_id !== undefined ? opts.phase_id : workPhase(store.phases, opts.job_id)?.id ?? null
  return store.insert('time_entries', {
    job_id: opts.job_id, phase_id: phase, task_id: opts.task_id ?? null, user_id: store.me.id,
    date: todayISO(), started_at: new Date().toISOString(), hours: null, billable: opts.billable !== false, notes: opts.notes ?? '',
  })
}

/** "1:05" style elapsed time for a running timer. */
export function elapsedLabel(startedAt: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 60000))
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
}
