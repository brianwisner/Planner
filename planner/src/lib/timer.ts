// Start/stop the work timer. Only one timer runs at a time: starting a new one
// stops (and saves) the one already running. A second click while a start is
// still saving reuses that start instead of creating another timer.
import type { Store } from './store'
import type { TimeEntry } from './types'
import { timerHours, workPhase } from './calc'
import { todayISO } from './utils'

type TimerStore = Pick<Store, 'timeEntries' | 'phases' | 'me' | 'insert' | 'update' | 'toast'>

/** A timer left running longer than this is checked by hand instead of saved. */
export const LONG_TIMER_HOURS = 12

export function runningTimers(store: Pick<Store, 'timeEntries' | 'me'>): TimeEntry[] {
  return store.timeEntries.filter(e => e.started_at && e.hours == null && (!store.me || e.user_id === store.me.id))
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''))
}

export function runningTimer(store: Pick<Store, 'timeEntries' | 'me'>): TimeEntry | undefined {
  return runningTimers(store)[0]
}

export function elapsedHours(entry: Pick<TimeEntry, 'started_at'>, now = Date.now()): number {
  return entry.started_at ? Math.max(0, (now - new Date(entry.started_at).getTime()) / 3600000) : 0
}

/** True when a timer was probably forgotten and its hours should be checked first. */
export function needsReview(entry: Pick<TimeEntry, 'started_at'>, now = Date.now()): boolean {
  return elapsedHours(entry, now) > LONG_TIMER_HOURS
}

const stopping = new Set<string>()

export async function stopTimer(store: TimerStore, entry: TimeEntry): Promise<boolean> {
  if (stopping.has(entry.id)) return false
  stopping.add(entry.id)
  try {
    const hours = timerHours(entry)
    const ok = await store.update('time_entries', entry.id, { hours, started_at: null })
    if (ok) store.toast(`Saved ${hours} h`)
    return ok
  } finally { stopping.delete(entry.id) }
}

let starting: Promise<TimeEntry | null> | null = null

export function startTimer(store: TimerStore, opts: { job_id: string; phase_id?: string | null; task_id?: string | null; billable?: boolean; notes?: string }): Promise<TimeEntry | null> {
  if (starting) return starting
  starting = doStart(store, opts).finally(() => { starting = null })
  return starting
}

export function isStartingTimer(): boolean {
  return starting != null
}

async function doStart(store: TimerStore, opts: { job_id: string; phase_id?: string | null; task_id?: string | null; billable?: boolean; notes?: string }): Promise<TimeEntry | null> {
  if (!store.me) { store.toast('Sign in again to start a timer.', 'error'); return null }
  const others = store.timeEntries.filter(e => e.user_id === store.me!.id && e.started_at && e.hours == null)
  const forgotten = others.find(e => needsReview(e))
  if (forgotten) {
    store.toast(`A timer has been running for over ${LONG_TIMER_HOURS} hours. Check its hours on the Time page before starting another.`, 'error')
    return null
  }
  for (const other of others) {
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
