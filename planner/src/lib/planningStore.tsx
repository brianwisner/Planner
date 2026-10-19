import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useData } from './store'
import type { PlanningEvent, PlanningProviderProps, PlanningScheduleMove, PlanningStore, PlanningTableName, PlanningTables } from './planningTypes'

const mutableTables: PlanningTableName[] = ['daily_reviews', 'follow_ups', 'daily_availability', 'availability_blocks', 'job_planning', 'job_decisions']
const tables = [...mutableTables, 'planning_events'] as const
type ReadTable = typeof tables[number]
type ReadTables = PlanningTables & { planning_events: PlanningEvent }
type Data = { [K in ReadTable]: ReadTables[K][] }
const empty = (): Data => ({ daily_reviews: [], follow_ups: [], daily_availability: [], availability_blocks: [], job_planning: [], job_decisions: [], planning_events: [] })
const PlanningContext = createContext<PlanningStore | null>(null)

export function usePlanning(): PlanningStore {
  const value = useContext(PlanningContext)
  if (!value) throw new Error('usePlanning must be used inside <PlanningProvider>')
  return value
}
export function useOptionalPlanning(): PlanningStore | null { return useContext(PlanningContext) }

function comparable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(comparable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${comparable(item)}`).join(',')}}`
  return JSON.stringify(value)
}
function timestampValue(value: unknown) {
  if (typeof value !== 'string') return value
  const parts = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!parts || !Number.isFinite(Date.parse(parts[1] + parts[3]))) return value
  return new Date(parts[1] + parts[3]).toISOString().slice(0, 19) + '.' + (parts[2] ?? '').padEnd(6, '0')
}
const matches = (row: Record<string, unknown>, payload: Record<string, unknown>) => Object.entries(payload).every(([key, value]) => comparable(key.endsWith('_at') ? timestampValue(row[key]) : row[key]) === comparable(key.endsWith('_at') ? timestampValue(value) : value))

export function PlanningProvider({ session, children }: PlanningProviderProps) {
  const { toast, refresh: refreshBusiness } = useData()
  const userId = session?.user.id ?? null
  const [snapshot, setSnapshot] = useState<{ userId: string | null; data: Data }>({ userId, data: empty() })
  const [loading, setLoading] = useState(Boolean(userId))
  const [error, setError] = useState<string | null>(null)
  const scope = useRef({ userId, epoch: 0 })
  const sequence = useRef<Partial<Record<ReadTable, number>>>({})
  const pending = useRef(new Set<string>())

  const fetchTable = useCallback(async (table: ReadTable) => {
    const epoch = scope.current.epoch
    const ticket = sequence.current[table] = (sequence.current[table] ?? 0) + 1
    if (!userId || scope.current.userId !== userId) return
    const rows: ReadTables[typeof table][] = []
    // PostgREST defaults to 1,000 rows. Page explicitly so older activity is kept.
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase.from(table).select('*').order('id').range(offset, offset + 999)
      if (result.error) throw new Error(`${table}: ${result.error.message}`)
      rows.push(...result.data ?? [])
      if ((result.data?.length ?? 0) < 1000) break
    }
    if (scope.current.userId !== userId || scope.current.epoch !== epoch || sequence.current[table] !== ticket) return
    setSnapshot(current => ({ userId, data: { ...(current.userId === userId ? current.data : empty()), [table]: rows } }))
  }, [userId])

  const refresh = useCallback(async () => {
    const epoch = scope.current.epoch
    if (!userId || scope.current.userId !== userId) return
    try {
      await Promise.all(tables.map(fetchTable))
      if (scope.current.epoch === epoch) setError(null)
    } catch (reason) {
      if (scope.current.epoch === epoch) setError(reason instanceof Error ? reason.message : 'Could not load planning records.')
    }
  }, [fetchTable, userId])

  useEffect(() => {
    scope.current = { userId, epoch: scope.current.epoch + 1 }
    const epoch = scope.current.epoch
    pending.current.clear()
    setError(null)
    setLoading(Boolean(userId))
    if (!userId) { setSnapshot({ userId: null, data: empty() }); return }
    void refresh().finally(() => { if (scope.current.epoch === epoch) setLoading(false) })
    let timer: number | undefined
    const queueRefresh = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { void refresh() }, 150) }
    const channel = supabase.channel(`planning-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public' }, payload => { if ((tables as readonly string[]).includes(payload.table)) queueRefresh() })
      .subscribe(status => { if (status === 'SUBSCRIBED') queueRefresh() })
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', queueRefresh)
    return () => {
      scope.current.epoch++
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('online', queueRefresh)
    }
  }, [userId, refresh])

  const save = useCallback(async <K extends PlanningTableName>(table: K, row: Partial<PlanningTables[K]> & { id: string }, expectedRevision?: number): Promise<PlanningTables[K] | null> => {
    const epoch = scope.current.epoch, key = `${userId}:${epoch}:${table}:${row.id}`
    if (!userId || scope.current.userId !== userId || !mutableTables.includes(table)) return null
    if (pending.current.has(key)) { toast('This record is still saving. Wait for confirmation before trying again.', 'error'); return null }
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) { toast('Reopen the saved record before editing it.', 'error'); return null }
    const payload = Object.fromEntries(Object.entries(row).filter(([key, value]) => value !== undefined && !['revision', 'created_at', 'updated_at', 'checkpoint_at'].includes(key)))
    pending.current.add(key)
    try {
      const result = expectedRevision === undefined
        ? await supabase.from(table).insert(payload).select('*').single()
        : await supabase.from(table).update(payload).eq('id', row.id).eq('revision', expectedRevision).select('*').single()
      let confirmed = !result.error ? result.data as PlanningTables[K] | null : null
      if (!confirmed) {
        // A network failure may follow a committed write. A stable ID, matching
        // payload and exact next revision prove the result without a second write.
        const proof = await supabase.from(table).select('*').eq('id', row.id).maybeSingle()
        if (!proof.error && proof.data && proof.data.revision === (expectedRevision ?? 0) + 1 && matches(proof.data, payload)) confirmed = proof.data as PlanningTables[K]
      }
      if (scope.current.epoch !== epoch || scope.current.userId !== userId) return null
      if (!confirmed) {
        await refresh()
        toast('This planning record changed or could not be confirmed. Your draft is kept; reopen the latest record before retrying.', 'error')
        return null
      }
      sequence.current[table] = (sequence.current[table] ?? 0) + 1
      setSnapshot(current => ({ userId, data: { ...(current.userId === userId ? current.data : empty()), [table]: [...(current.userId === userId ? current.data[table] : []).filter(existing => existing.id !== confirmed.id), confirmed] } }))
      void fetchTable('planning_events').catch(() => {})
      return confirmed
    } catch {
      if (scope.current.epoch !== epoch || scope.current.userId !== userId) return null
      // Thrown transport failures use the same proof as returned SDK errors.
      try {
        const proof = await supabase.from(table).select('*').eq('id', row.id).maybeSingle()
        if (proof.data && !proof.error && proof.data.revision === (expectedRevision ?? 0) + 1 && matches(proof.data, payload) && scope.current.epoch === epoch && scope.current.userId === userId) {
          await refresh()
          return proof.data as PlanningTables[K]
        }
      } catch { /* An unconfirmed write must keep the caller's draft. */ }
      if (scope.current.epoch !== epoch || scope.current.userId !== userId) return null
      await refresh()
      toast('Could not confirm the planning save. Your draft is kept; check the latest record before retrying.', 'error')
      return null
    } finally { pending.current.delete(key) }
  }, [userId, toast, refresh, fetchTable])

  const remove = useCallback(async (table: PlanningTableName, id: string, revision: number) => {
    const epoch = scope.current.epoch, key = `${userId}:${epoch}:${table}:${id}`
    if (!userId || scope.current.userId !== userId || !mutableTables.includes(table) || !Number.isInteger(revision) || revision < 1 || pending.current.has(key)) return false
    pending.current.add(key)
    try {
      const result = await supabase.from(table).delete().eq('id', id).eq('revision', revision).select('id')
      if (scope.current.epoch !== epoch || scope.current.userId !== userId) return false
      await refresh()
      if (result.error || result.data?.length !== 1) { toast('This record changed or was already removed. Your draft is kept; reopen the latest record.', 'error'); return false }
      return true
    } catch { if (scope.current.epoch !== epoch || scope.current.userId !== userId) return false; await refresh(); toast('Could not confirm deletion. Check the refreshed records before retrying.', 'error'); return false }
    finally { pending.current.delete(key) }
  }, [userId, toast, refresh])

  const applyMoves = useCallback(async (moves: PlanningScheduleMove[]) => {
    const epoch = scope.current.epoch, key = `${userId}:${epoch}:schedule-moves`
    if (!userId || scope.current.userId !== userId || !moves.length || pending.current.has(key)) return false
    pending.current.add(key)
    try {
      const result = await supabase.rpc('apply_planning_schedule_moves', { p_moves: moves })
      if (scope.current.epoch !== epoch || scope.current.userId !== userId) return false
      await Promise.all([refresh(), refreshBusiness('schedule_entries')])
      if (result.error) { toast('The plans were not moved. Refresh the preview and check for changed or overlapping plans.', 'error'); return false }
      return true
    } catch { if (scope.current.epoch !== epoch || scope.current.userId !== userId) return false; await Promise.all([refresh(), refreshBusiness('schedule_entries')]); toast('Could not confirm the move. Check the refreshed plans before trying again.', 'error'); return false }
    finally { pending.current.delete(key) }
  }, [userId, refresh, refreshBusiness, toast])

  const data = snapshot.userId === userId ? snapshot.data : empty()
  const value = useMemo<PlanningStore>(() => ({ reviews: data.daily_reviews, followUps: data.follow_ups, availability: data.daily_availability, blocks: data.availability_blocks, jobPlanning: data.job_planning, decisions: data.job_decisions, events: data.planning_events, loading, error, refresh, save, remove, applyMoves }), [data, loading, error, refresh, save, remove, applyMoves])
  return <PlanningContext.Provider value={value}>{children}</PlanningContext.Provider>
}
