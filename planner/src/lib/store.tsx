/* eslint-disable react-refresh/only-export-components */
// The data store: loads every table once, keeps it updated in real time via
// Supabase, and exposes simple insert / update / remove helpers.
// Every page reads from useData() and never talks to the database directly.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Client, Comment, Invoice, Job, Phase, Profile, Settings, Task, TimeEntry } from './types'

export interface Tables {
  settings: Settings
  profiles: Profile
  clients: Client
  jobs: Job
  phases: Phase
  tasks: Task
  invoices: Invoice
  time_entries: TimeEntry
  comments: Comment
}
export type TableName = keyof Tables

const TABLE_NAMES: TableName[] = ['settings', 'profiles', 'clients', 'jobs', 'phases', 'tasks', 'invoices', 'time_entries', 'comments']

type Data = { [K in TableName]: Tables[K][] }

const emptyData: Data = {
  settings: [], profiles: [], clients: [], jobs: [], phases: [], tasks: [], invoices: [], time_entries: [], comments: [],
}

export interface Store {
  session: Session | null
  me: Profile | null
  settings: Settings
  profiles: Profile[]
  clients: Client[]
  jobs: Job[]
  phases: Phase[]
  tasks: Task[]
  invoices: Invoice[]
  timeEntries: TimeEntry[]
  comments: Comment[]
  loading: boolean
  error: string | null
  online: boolean
  refresh: (table?: TableName) => Promise<void>
  insert: <K extends TableName>(table: K, row: Partial<Tables[K]>) => Promise<Tables[K] | null>
  update: <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>) => Promise<void>
  remove: (table: TableName, id: string | number) => Promise<void>
  signOut: () => Promise<void>
  toast: (msg: string, kind?: 'ok' | 'error') => void
  toasts: { id: number; msg: string; kind: 'ok' | 'error' }[]
}

const StoreContext = createContext<Store | null>(null)

export function useData(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useData must be used inside <DataProvider>')
  return s
}

export function DataProvider({ session, children }: { session: Session | null; children: ReactNode }) {
  const [data, setData] = useState<Data>(emptyData)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [toasts, setToasts] = useState<Store['toasts']>([])
  const toastId = useRef(0)

  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++toastId.current
    setToasts(t => [...t, { id, msg, kind }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 6000 : 2500)
  }, [])

  const fetchTable = useCallback(async (table: TableName) => {
    const { data: rows, error: err } = await supabase.from(table).select('*')
    if (err) throw new Error(`${table}: ${err.message}`)
    setData(d => ({ ...d, [table]: rows ?? [] }))
  }, [])

  const refresh = useCallback(async (table?: TableName) => {
    try {
      if (table) await fetchTable(table)
      else await Promise.all(TABLE_NAMES.map(fetchTable))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [fetchTable])

  // Initial load + live updates
  useEffect(() => {
    if (!session) { setData(emptyData); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    refresh().finally(() => { if (!cancelled) setLoading(false) })

    // Debounced per-table refetch so a burst of changes becomes one query.
    const timers: Partial<Record<TableName, number>> = {}
    const channel = supabase
      .channel('planner-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
        const table = payload.table as TableName
        if (!TABLE_NAMES.includes(table)) return
        window.clearTimeout(timers[table])
        timers[table] = window.setTimeout(() => { void fetchTable(table) }, 150)
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setOnline(true)
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setOnline(false)
      })

    // Refetch everything when the tab comes back into focus (phones suspend tabs).
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    const onOnline = () => { setOnline(true); void refresh() }
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [session, refresh, fetchTable])

  const insert = useCallback(async <K extends TableName>(table: K, row: Partial<Tables[K]>) => {
    const { data: created, error: err } = await supabase.from(table).insert(row as never).select('*').single()
    if (err) { toast(`Could not save: ${err.message}`, 'error'); return null }
    setData(d => ({ ...d, [table]: [...d[table], created] }))
    // phases are created by a database trigger when a job is inserted
    if (table === 'jobs') setTimeout(() => void fetchTable('phases'), 300)
    return created as Tables[K]
  }, [toast, fetchTable])

  const update = useCallback(async <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>) => {
    // Optimistic: apply locally first so the UI feels instant.
    setData(d => ({ ...d, [table]: d[table].map(r => (r as { id: string | number }).id === id ? { ...r, ...patch } : r) }))
    const { error: err } = await supabase.from(table).update(patch as never).eq('id', id)
    if (err) { toast(`Could not save: ${err.message}`, 'error'); void fetchTable(table) }
  }, [toast, fetchTable])

  const remove = useCallback(async (table: TableName, id: string | number) => {
    setData(d => ({ ...d, [table]: d[table].filter(r => (r as { id: string | number }).id !== id) }))
    const { error: err } = await supabase.from(table).delete().eq('id', id)
    if (err) { toast(`Could not delete: ${err.message}`, 'error'); void fetchTable(table) }
    else void refresh() // cascades (phases, tasks, time) may have gone with it
  }, [toast, fetchTable, refresh])

  const signOut = useCallback(async () => { await supabase.auth.signOut() }, [])

  const value = useMemo<Store>(() => {
    const me = data.profiles.find(p => p.id === session?.user.id) ?? null
    const settings: Settings = data.settings[0] ?? { id: 1, company_name: 'Wisner Engineering', default_rate: 150, weekly_capacity: 40 }
    return {
      session, me, settings,
      profiles: [...data.profiles].sort((a, b) => a.full_name.localeCompare(b.full_name)),
      clients: [...data.clients].sort((a, b) => a.name.localeCompare(b.name)),
      jobs: [...data.jobs].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
      phases: [...data.phases].sort((a, b) => a.sort_order - b.sort_order),
      tasks: [...data.tasks].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
      invoices: [...data.invoices].sort((a, b) => a.issued_date.localeCompare(b.issued_date)),
      timeEntries: [...data.time_entries].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
      comments: [...data.comments].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      loading, error, online, refresh, insert, update, remove, signOut, toast, toasts,
    }
  }, [data, session, loading, error, online, refresh, insert, update, remove, signOut, toast, toasts])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
