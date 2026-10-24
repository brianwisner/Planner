/* eslint-disable react-refresh/only-export-components */
// The data store: loads every table once, keeps it updated in real time via
// Supabase, and exposes simple insert / update / remove helpers.
// Every page reads from useData() and never talks to the database directly.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Client, Comment, Deposit, Invoice, Job, JobItem, JobType, PastJob, Phase, PlanCheckComment, PlanCheckRound, Quote, Profile, ScheduleEntry, Settings, SitePhoto, SiteVisit, Task, TimeEntry } from './types'
import type { InvoiceWorkLink } from './billingActions'

export interface Tables {
  settings: Settings
  profiles: Profile
  clients: Client
  job_types: JobType
  past_jobs: PastJob
  jobs: Job
  quotes: Quote
  phases: Phase
  tasks: Task
  invoices: Invoice
  deposits: Deposit
  job_items: JobItem
  schedule_entries: ScheduleEntry
  time_entries: TimeEntry
  comments: Comment
  site_visits: SiteVisit
  site_photos: SitePhoto
  plan_check_rounds: PlanCheckRound
  plan_check_comments: PlanCheckComment
}
export type TableName = keyof Tables

const TABLE_NAMES: TableName[] = ['settings', 'profiles', 'clients', 'job_types', 'past_jobs', 'jobs', 'quotes', 'phases', 'tasks', 'invoices', 'deposits', 'job_items', 'schedule_entries', 'time_entries', 'comments', 'site_visits', 'site_photos', 'plan_check_rounds', 'plan_check_comments']

type Data = { [K in TableName]: Tables[K][] }

const emptyData: Data = {
  settings: [], profiles: [], clients: [], job_types: [], past_jobs: [], jobs: [], quotes: [], phases: [], tasks: [], invoices: [], deposits: [], job_items: [], schedule_entries: [], time_entries: [], comments: [],
  site_visits: [], site_photos: [], plan_check_rounds: [], plan_check_comments: [],
}

export interface ToastAction { label: string; run: () => void | Promise<unknown> }
export interface Toast { id: number; msg: string; kind: 'ok' | 'error'; action?: ToastAction }

export interface Store {
  session: Session | null
  me: Profile | null
  settings: Settings
  profiles: Profile[]
  clients: Client[]
  jobTypes: JobType[]
  pastJobs: PastJob[]
  jobs: Job[]
  quotes: Quote[]
  phases: Phase[]
  tasks: Task[]
  invoices: Invoice[]
  deposits: Deposit[]
  items: JobItem[]
  schedule: ScheduleEntry[]
  timeEntries: TimeEntry[]
  comments: Comment[]
  siteVisits: SiteVisit[]
  sitePhotos: SitePhoto[]
  planRounds: PlanCheckRound[]
  planComments: PlanCheckComment[]
  loading: boolean
  error: string | null
  online: boolean
  refresh: (table?: TableName) => Promise<void>
  insert: <K extends TableName>(table: K, row: Partial<Tables[K]>) => Promise<Tables[K] | null>
  /** Several rows in one request (all or nothing). */
  insertMany: <K extends TableName>(table: K, rows: Partial<Tables[K]>[]) => Promise<Tables[K][] | null>
  update: <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>) => Promise<boolean>
  /** Save only if the supplied previous values still match the database row. */
  conditionalUpdate: <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>, expected: Partial<Tables[K]>) => Promise<boolean>
  remove: (table: TableName, id: string | number) => Promise<boolean>
  recordInvoice: (invoice: Omit<Invoice, 'id' | 'created_at'>, links: InvoiceWorkLink[]) => Promise<Invoice | null>
  /** Fresh rows straight from the database, e.g. the phases a new job just got. */
  fetchWhere: <K extends TableName>(table: K, column: string, value: string) => Promise<Tables[K][]>
  signOut: () => Promise<void>
  toast: (msg: string, kind?: 'ok' | 'error', action?: ToastAction) => void
  dismissToast: (id: number) => void
  toasts: Toast[]
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
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const dismissToast = useCallback((id: number) => setToasts(t => t.filter(x => x.id !== id)), [])
  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok', action?: ToastAction) => {
    const id = ++toastId.current
    // Only the latest Undo is offered, so it's always clear what it will undo.
    setToasts(t => [...t.filter(x => !(action && x.action)).slice(-3), { id, msg, kind, action }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 7000 : kind === 'error' ? 6000 : 2600)
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
      .channel('planner-v2-live')
      .on('postgres_changes', { event: '*', schema: 'public' }, payload => {
        const table = payload.table as TableName
        if (!TABLE_NAMES.includes(table)) return
        window.clearTimeout(timers[table])
        timers[table] = window.setTimeout(() => { void fetchTable(table).catch(() => {}) }, 150)
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
      void supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [session, refresh, fetchTable])

  const insert = useCallback(async <K extends TableName>(table: K, row: Partial<Tables[K]>) => {
    const { data: created, error: err } = await supabase.from(table).insert(row as never).select('*').single()
    if (err) { toast(`Could not save: ${err.message}`, 'error'); return null }
    setData(d => ({ ...d, [table]: [...d[table].filter(r => (r as { id: unknown }).id !== (created as { id: unknown }).id), created] }))
    // phases are created by a database trigger when a job is inserted
    if (table === 'jobs') await fetchTable('phases').catch(() => {})
    return created as Tables[K]
  }, [toast, fetchTable])

  const insertMany = useCallback(async <K extends TableName>(table: K, rows: Partial<Tables[K]>[]) => {
    if (!rows.length) return []
    const { data: created, error: err } = await supabase.from(table).insert(rows as never).select('*')
    if (err) { toast(`Could not save: ${err.message}`, 'error'); return null }
    const added = (created ?? []) as Tables[K][]
    const ids = new Set(added.map(r => (r as { id: unknown }).id))
    setData(d => ({ ...d, [table]: [...d[table].filter(r => !ids.has((r as { id: unknown }).id)), ...added] }))
    return added
  }, [toast])

  const update = useCallback(async <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>) => {
    // Optimistic: apply locally first so the UI feels instant.
    setData(d => ({ ...d, [table]: d[table].map(r => (r as { id: string | number }).id === id ? { ...r, ...patch } : r) }))
    const { error: err } = await supabase.from(table).update(patch as never).eq('id', id).select('id').single()
    if (err) { toast(`Could not save: ${err.message}`, 'error'); void fetchTable(table).catch(() => {}); return false }
    return true
  }, [toast, fetchTable])

  const conditionalUpdate = useCallback(async <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>, expected: Partial<Tables[K]>) => {
    const previous = Object.entries(expected)
    if (!previous.length || previous.some(([, value]) => value === undefined)) {
      toast('Could not check the previous values. Refresh and try again.', 'error')
      return false
    }
    try {
      let query = supabase.from(table).update(patch as never).eq('id', id)
      for (const [column, value] of previous) query = value === null ? query.is(column, null) : query.eq(column, value)
      const { data: rows, error: err } = await query.select('*')
      if (err) { toast(`Could not save: ${err.message}`, 'error'); return false }
      const saved = rows?.[0] as Tables[K] | undefined
      if (!saved || (saved as { id: string | number }).id !== id) {
        await fetchTable(table).catch(() => {})
        toast('The saved record changed. Review the latest version and try again.', 'error')
        return false
      }
      // Wait for the guarded write to succeed before showing the new value.
      setData(d => ({ ...d, [table]: d[table].map(r => (r as { id: string | number }).id === id ? saved : r) }))
      return true
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`, 'error')
      return false
    }
  }, [toast, fetchTable])

  const remove = useCallback(async (table: TableName, id: string | number) => {
    setData(d => ({ ...d, [table]: d[table].filter(r => (r as { id: string | number }).id !== id) }))
    const { error: err } = await supabase.from(table).delete().eq('id', id)
    if (err) { toast(`Could not delete: ${err.message}`, 'error'); void fetchTable(table).catch(() => {}); return false }
    await refresh() // cascades (phases, tasks, time) may have gone with it
    return true
  }, [toast, fetchTable, refresh])

  const recordInvoice = useCallback(async (invoice: Omit<Invoice, 'id' | 'created_at'>, links: InvoiceWorkLink[]) => {
    const { data: created, error: err } = await supabase.rpc('record_invoice', {
      p_job_id: invoice.job_id, p_number: invoice.number, p_amount: invoice.amount,
      p_issued_date: invoice.issued_date, p_paid_date: invoice.paid_date, p_notes: invoice.notes, p_links: links,
    }).single()
    if (err) { toast(`Could not save invoice: ${err.message}`, 'error'); return null }
    await refresh()
    return created as Invoice
  }, [toast, refresh])

  const fetchWhere = useCallback(async <K extends TableName>(table: K, column: string, value: string) => {
    const { data: rows, error: err } = await supabase.from(table).select('*').eq(column, value)
    if (err) return []
    const fresh = (rows ?? []) as Tables[K][]
    const ids = new Set(fresh.map(r => (r as { id: unknown }).id))
    setData(d => ({ ...d, [table]: [...d[table].filter(r => !ids.has((r as { id: unknown }).id)), ...fresh] }))
    return fresh
  }, [])

  const signOut = useCallback(async () => { await supabase.auth.signOut() }, [])

  const value = useMemo<Store>(() => {
    const me = data.profiles.find(p => p.id === session?.user.id) ?? null
    const settings: Settings = data.settings[0] ?? { id: 1, company_name: 'Wisner Engineering', business_email: '', default_rate: 150, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' }
    return {
      session, me, settings,
      profiles: [...data.profiles].sort((a, b) => a.full_name.localeCompare(b.full_name)),
      clients: [...data.clients].sort((a, b) => a.name.localeCompare(b.name)),
      jobTypes: [...data.job_types].sort((a, b) => a.name.localeCompare(b.name)),
      pastJobs: [...data.past_jobs].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.name.localeCompare(b.name)),
      quotes: [...data.quotes].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      jobs: [...data.jobs].sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at)),
      phases: [...data.phases].sort((a, b) => a.sort_order - b.sort_order),
      tasks: [...data.tasks].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
      invoices: [...data.invoices].sort((a, b) => a.issued_date.localeCompare(b.issued_date)),
      deposits: [...data.deposits].sort((a, b) => a.received_date.localeCompare(b.received_date) || a.created_at.localeCompare(b.created_at)),
      items: [...data.job_items].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at)),
      schedule: [...data.schedule_entries].sort((a, b) => a.date.localeCompare(b.date)),
      timeEntries: [...data.time_entries].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
      comments: [...data.comments].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      siteVisits: [...data.site_visits].sort((a, b) => b.visit_date.localeCompare(a.visit_date) || b.created_at.localeCompare(a.created_at)),
      sitePhotos: [...data.site_photos].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
      planRounds: [...data.plan_check_rounds].sort((a, b) => a.round - b.round || a.created_at.localeCompare(b.created_at)),
      planComments: [...data.plan_check_comments].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)),
      loading, error, online, refresh, insert, insertMany, update, conditionalUpdate, remove, recordInvoice, fetchWhere, signOut, toast, dismissToast, toasts,
    }
  }, [data, session, loading, error, online, refresh, insert, insertMany, update, conditionalUpdate, remove, recordInvoice, fetchWhere, signOut, toast, dismissToast, toasts])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
