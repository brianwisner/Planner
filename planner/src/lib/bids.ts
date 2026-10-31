// Leads and bids: who sends you work, which bids turned into jobs, and why the
// others didn't. No separate CRM: a lead is a job whose bidding hasn't started,
// a bid is won once the job moves past bidding, and a lost bid is Cancelled with
// `lost_date` and `lost_reason` saved on the job.
import { addDays, format } from 'date-fns'
import type { Store } from './store'
import type { Job, Phase } from './types'
import { jobBilling } from './calc'
import { latestQuote } from './estimate'
import { mainPhases, stageChanges, STAGE_LABEL } from './stages'
import { fmtDate, sum, todayISO } from './utils'

export type BidOutcome = 'lead' | 'bidding' | 'won' | 'lost'

/** Days until the "follow up on proposal" reminder once a proposal is sent. */
export const FOLLOW_UP_DAYS = 14
export const FOLLOW_UP_TITLE = 'Follow up on proposal'

const closedStatus = (job: Pick<Job, 'status'>) => job.status === 'cancelled' || job.status === 'archived'

export function bidOutcome(phases: Phase[], job: Job): BidOutcome {
  if (job.lost_date && closedStatus(job)) return 'lost'
  const main = mainPhases(phases, job.id)
  const bidding = main.find(p => p.kind === 'bidding')
  const moved = main.some(p => p.kind !== 'bidding' && p.status !== 'not_started')
  if (moved || bidding?.status === 'complete' || job.status === 'complete' || job.status === 'archived') return 'won'
  // Cancelled before it was won: a lost bid with no reason recorded.
  if (job.status === 'cancelled') return 'lost'
  return bidding && bidding.status !== 'not_started' ? 'bidding' : 'lead'
}

/** The fee offered: the latest saved quote, else the fee on the job. */
export function quotedFee(store: Pick<Store, 'quotes'>, job: Job): number | null {
  return latestQuote(store, job.id)?.fee ?? job.fee
}

/** Who sent the work: the referral if one is recorded, else the client itself. */
export function sourceName(store: Pick<Store, 'clients'>, job: Job): string {
  return job.source.trim() || store.clients.find(c => c.id === job.client_id)?.name || 'No client'
}

/** Referral sources typed before (newest first), then client names, for the "Referred by" box. */
export function sourceSuggestions(store: Pick<Store, 'jobs' | 'clients'>): string[] {
  const seen = new Set<string>(), out: string[] = []
  const add = (s: string) => { const t = s.trim(); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t) } }
  ;[...store.jobs].sort((a, b) => b.created_at.localeCompare(a.created_at)).forEach(j => add(j.source))
  store.clients.forEach(c => add(c.name))
  return out
}

/** The referral on this client's most recent job, to start a new job's "Referred by". */
export function lastSourceFor(store: Pick<Store, 'jobs'>, clientId: string): string {
  return [...store.jobs].filter(j => j.client_id === clientId && j.source.trim())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.source.trim() ?? ''
}

type ReportStore = Pick<Store, 'jobs' | 'clients' | 'phases' | 'quotes' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings'>

export interface SourceRow {
  key: string
  name: string
  /** Clients whose jobs came from this source (other than the source itself). */
  clients: string[]
  jobs: number
  won: number
  lost: number
  open: number
  winRate: number | null      // won ÷ (won + lost)
  workWon: number             // agreed fees of won jobs (recorded fees when no fee was set)
  rate: number | null         // earned per hour on finished jobs from this source
}

export function sourceReport(store: ReportStore): SourceRow[] {
  const rows = new Map<string, SourceRow & { earned: number; hours: number }>()
  for (const job of store.jobs) {
    const name = sourceName(store, job)
    const key = name.toLowerCase()
    const row = rows.get(key) ?? { key, name, clients: [], jobs: 0, won: 0, lost: 0, open: 0, winRate: null, workWon: 0, rate: null, earned: 0, hours: 0 }
    const client = store.clients.find(c => c.id === job.client_id)?.name
    if (client && client.toLowerCase() !== key && !row.clients.includes(client)) row.clients.push(client)
    row.jobs++
    const outcome = bidOutcome(store.phases, job)
    if (outcome === 'won') {
      row.won++
      const money = jobBilling(store, job)
      row.workWon += job.fee ?? money.feeRevenue
      if ((job.status === 'complete' || job.status === 'archived') && money.loggedHours > 0) { row.earned += money.feeRevenue; row.hours += money.loggedHours }
    } else if (outcome === 'lost') row.lost++
    else row.open++
    rows.set(key, row)
  }
  return [...rows.values()]
    .map(({ earned, hours, ...r }) => ({ ...r, winRate: r.won + r.lost ? r.won / (r.won + r.lost) : null, rate: hours > 0 ? earned / hours : null }))
    .sort((a, b) => b.workWon - a.workWon || b.jobs - a.jobs || a.name.localeCompare(b.name))
}

export interface LostBid { job: Job; reason: string; date: string | null; fee: number | null }

export interface BidSummary {
  leads: Job[]
  out: Job[]                  // priced or being priced, no answer yet
  won: number
  lost: LostBid[]             // newest first
  winRate: number | null
  avgWon: number | null       // average fee offered on bids you won
  avgLost: number | null      // …and on bids you lost
  reasons: { reason: string; count: number }[]
}

export function bidSummary(store: Pick<Store, 'jobs' | 'phases' | 'quotes'>): BidSummary {
  const leads: Job[] = [], out: Job[] = [], lost: LostBid[] = [], wonFees: number[] = [], lostFees: number[] = []
  let won = 0
  for (const job of store.jobs) {
    const outcome = bidOutcome(store.phases, job)
    const fee = quotedFee(store, job)
    if (outcome === 'lead' && job.status !== 'cancelled') leads.push(job)
    else if (outcome === 'bidding') out.push(job)
    else if (outcome === 'won') { won++; if (fee) wonFees.push(fee) }
    else if (outcome === 'lost') { lost.push({ job, reason: job.lost_reason || 'Not recorded', date: job.lost_date, fee }); if (fee) lostFees.push(fee) }
  }
  lost.sort((a, b) => (b.date ?? b.job.created_at).localeCompare(a.date ?? a.job.created_at))
  const counts = new Map<string, number>()
  lost.forEach(l => counts.set(l.reason, (counts.get(l.reason) ?? 0) + 1))
  const avg = (xs: number[]) => xs.length ? sum(xs) / xs.length : null
  return {
    leads, out, won, lost,
    winRate: won + lost.length ? won / (won + lost.length) : null,
    avgWon: avg(wonFees), avgLost: avg(lostFees),
    reasons: [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  }
}

/** Won and lost bids for one job type, with the fees of bids lost on price (for the fee estimator). */
export function typeBidRecord(store: Pick<Store, 'jobs' | 'phases' | 'quotes'>, typeId: string): { won: number; lost: number; lostOnFee: number[] } {
  let won = 0, lost = 0
  const lostOnFee: number[] = []
  for (const job of store.jobs.filter(j => j.job_type_id === typeId)) {
    const outcome = bidOutcome(store.phases, job)
    if (outcome === 'won') won++
    else if (outcome === 'lost') {
      lost++
      const fee = quotedFee(store, job)
      if (job.lost_reason === 'Fee too high' && fee) lostOnFee.push(fee)
    }
  }
  return { won, lost, lostOnFee: lostOnFee.sort((a, b) => a - b) }
}

/* ---------------- Actions (each offers Undo) ---------------- */

type ActionStore = Pick<Store, 'phases' | 'jobs' | 'update' | 'toast'>

export async function markLost(store: ActionStore, job: Job, reason: string): Promise<boolean> {
  const before = { status: job.status, lost_reason: job.lost_reason, lost_date: job.lost_date }
  const ok = await store.update('jobs', job.id, { status: 'cancelled', lost_reason: reason, lost_date: todayISO() })
  if (ok) store.toast(`${job.name} marked lost · ${reason}`, 'ok', { label: 'Undo', run: () => store.update('jobs', job.id, before) })
  return ok
}

/** "Not lost after all": reopen the bid where it was. */
export async function reopenBid(store: ActionStore, job: Job): Promise<boolean> {
  const before = { status: job.status, lost_reason: job.lost_reason, lost_date: job.lost_date }
  const ok = await store.update('jobs', job.id, { status: 'active', lost_reason: '', lost_date: null })
  if (ok) store.toast(`${job.name} is open again`, 'ok', { label: 'Undo', run: () => store.update('jobs', job.id, before) })
  return ok
}

/** Won: bidding is done and the job waits in your queue (Ready to start). */
export async function markWon(store: ActionStore, job: Job): Promise<boolean> {
  const jobBefore = { status: job.status, lost_reason: job.lost_reason, lost_date: job.lost_date }
  const reopen = job.status !== 'active' || job.lost_date
  if (reopen && !await store.update('jobs', job.id, { status: 'active', lost_reason: '', lost_date: null })) return false
  const changes = stageChanges(store.phases, job.id, 'ready')
  const results = await Promise.all(changes.map(c => store.update('phases', c.id, { status: c.to })))
  const ok = results.every(Boolean)
  if (ok) store.toast(`Won · ${job.name} → ${STAGE_LABEL.ready}`, 'ok', {
    label: 'Undo',
    run: async () => {
      await Promise.all(changes.map(c => store.update('phases', c.id, { status: c.from })))
      if (reopen) await store.update('jobs', job.id, jobBefore)
    },
  })
  return ok
}

/**
 * Proposal sent: the job sits in Bidding, waiting on the client, with a
 * reminder to follow up in two weeks (an ordinary task, so it shows on Today,
 * the calendar feed and the browser reminder).
 */
export async function markProposalSent(store: Pick<Store, 'phases' | 'tasks' | 'update' | 'insert' | 'remove' | 'toast' | 'me'>, job: Job, today = todayISO()): Promise<boolean> {
  const bidding = mainPhases(store.phases, job.id).find(p => p.kind === 'bidding')
  if (!bidding) return false
  const changes = [
    ...stageChanges(store.phases, job.id, 'bidding').filter(c => c.id !== bidding.id),
    ...(bidding.status === 'waiting' ? [] : [{ id: bidding.id, from: bidding.status, to: 'waiting' as const }]),
  ]
  const results = await Promise.all(changes.map(c => store.update('phases', c.id, { status: c.to })))
  if (!results.every(Boolean)) return false
  // Keep one reminder: an open one is moved, otherwise a new one is added.
  const due = format(addDays(new Date(`${today}T12:00:00`), FOLLOW_UP_DAYS), 'yyyy-MM-dd')
  const existing = store.tasks.find(t => t.job_id === job.id && t.status !== 'done' && t.title === FOLLOW_UP_TITLE)
  let undoTask: () => Promise<unknown>
  if (existing) {
    const prev = existing.due_date
    if (!await store.update('tasks', existing.id, { due_date: due })) return false
    undoTask = () => store.update('tasks', existing.id, { due_date: prev })
  } else {
    const created = await store.insert('tasks', {
      job_id: job.id, phase_id: bidding.id, title: FOLLOW_UP_TITLE, description: '', status: 'todo',
      due_date: due, assignee_id: store.me?.id ?? null, created_by: store.me?.id ?? null,
    })
    if (!created) return false
    undoTask = () => store.remove('tasks', created.id)
  }
  store.toast(`Proposal sent · follow-up reminder on ${fmtDate(due)}`, 'ok', {
    label: 'Undo',
    run: async () => { await undoTask(); await Promise.all(changes.map(c => store.update('phases', c.id, { status: c.from }))) },
  })
  return true
}
