// Plan check: the building department's comments on a job, your responses,
// and the response letter. Pasted comment letters are split into separate
// comments here so each one can be answered and ticked off.
import type { Store } from './store'
import type { PlanCheckComment, PlanCheckRound } from './types'
import { jobStage, STAGES, type Stage } from './stages'
import { moveJobToStage } from './jobActions'
import { todayISO } from './utils'

export interface ParsedComment { number: string; comment: string }

// The start of a numbered comment: "1. Provide…", "2) …", "S-3: …",
// "Comment 4 – …", "#5 …", "12a. …", "S-1 Provide…".
const LEAD = String.raw`^\s*(?:(?:[Cc]omment|COMMENT|[Ii]tem|ITEM|[Nn]o\.?)\s*)?#?\s*`
const NUMBER = String.raw`((?:[A-Z]{1,3}\s?[-.]?\s?)?\d{1,3}(?:\.\d{1,2})?[a-z]?)`
const NUMBERED = new RegExp(`${LEAD}${NUMBER}\\s*(?:[.):\\]–—-]\\s+|\\s+(?=[A-Z(]))(\\S.*)$`)
// A line holding only the number ("3." here, the text on the next line).
const NUMBER_ONLY = new RegExp(`${LEAD}${NUMBER}\\s*[.):\\]]\\s*$`)
const BULLET = /^\s*[•●▪◦*–—-]\s+(\S.*)$/

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
const cleanNumber = (s: string) => s.replace(/\s+/g, '')

/**
 * Split a pasted comment letter into separate comments.
 * Numbered items start a new comment, and the lines under them (wrapped text,
 * lettered sub-items, bullets) stay with it. Lines before the first number
 * (the letter's heading, a greeting) are left out. Without numbers, bullets
 * start comments; without either, each paragraph (or each line, when there
 * are no blank lines) is one comment.
 */
export function parseComments(text: string): ParsedComment[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const numbered = lines.some(l => NUMBERED.test(l) || NUMBER_ONLY.test(l))
  const bulleted = !numbered && lines.some(l => BULLET.test(l))

  if (numbered || bulleted) {
    const out: ParsedComment[] = []
    let current: { number: string; parts: string[] } | null = null
    let pendingNumber: string | null = null
    const flush = () => { const comment = current ? tidy(current.parts.join(' ')) : ''; if (current && comment) out.push({ number: current.number, comment }) }
    for (const line of lines) {
      if (numbered) {
        const only = NUMBER_ONLY.exec(line)
        if (only) { flush(); current = null; pendingNumber = cleanNumber(only[1]); continue }
        const m = NUMBERED.exec(line)
        if (m) { flush(); current = { number: cleanNumber(m[1]), parts: [m[2]] }; pendingNumber = null; continue }
        if (pendingNumber != null && line.trim()) { current = { number: pendingNumber, parts: [line] }; pendingNumber = null; continue }
      } else {
        const m = BULLET.exec(line)
        if (m) { flush(); current = { number: '', parts: [m[1]] }; continue }
      }
      current?.parts.push(line)
    }
    flush()
    return out
  }

  const blocks = /\n\s*\n/.test(text.trim()) ? text.split(/\n\s*\n/) : lines
  return blocks.map(tidy).filter(Boolean).map(comment => ({ number: '', comment }))
}

/** The number shown for a comment: the reviewer's own, else its position. */
export function commentLabel(c: Pick<PlanCheckComment, 'number'>, index: number): string {
  return c.number.trim() || String(index + 1)
}

type PlanStore = Pick<Store, 'planRounds' | 'planComments'>

export function jobRounds(store: PlanStore, jobId: string): PlanCheckRound[] {
  return store.planRounds.filter(r => r.job_id === jobId).sort((a, b) => a.round - b.round)
}

export function roundComments(store: Pick<Store, 'planComments'>, roundId: string): PlanCheckComment[] {
  return store.planComments.filter(c => c.round_id === roundId)
}

export interface PlanCheckStatus {
  round: PlanCheckRound
  total: number
  open: number
  /** Every comment is done but the responses haven't been sent. */
  ready: boolean
}

/** Where the job's latest round of comments stands, or null if it has none. */
export function planCheckStatus(store: Partial<PlanStore>, jobId: string): PlanCheckStatus | null {
  if (!store.planRounds || !store.planComments) return null
  const rounds = jobRounds(store as PlanStore, jobId)
  const round = rounds[rounds.length - 1]
  if (!round) return null
  const comments = roundComments(store as PlanStore, round.id)
  const open = comments.filter(c => !c.done).length
  return { round, total: comments.length, open, ready: comments.length > 0 && open === 0 && !round.sent_date }
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
export const roundWord = (n: number) => ORDINAL[n - 1] ?? `round ${n}`

type ActionStore = Pick<Store, 'jobs' | 'phases' | 'update' | 'toast' | 'planRounds' | 'planComments'>

/**
 * New comments mean the job is in plan check: a job still in an earlier stage
 * moves there (with Undo), and a plan check that was waiting on the city is
 * back in progress.
 */
export async function startPlanCheckWork(store: ActionStore, jobId: string): Promise<void> {
  const job = store.jobs.find(j => j.id === jobId)
  if (!job || job.status !== 'active') return
  const { stage, phase } = jobStage(store.phases, jobId)
  if (STAGES.indexOf(stage) < STAGES.indexOf('plan_check' as Stage)) await moveJobToStage(store, job, 'plan_check')
  else if (stage === 'plan_check' && phase && phase.status !== 'in_progress') await store.update('phases', phase.id, { status: 'in_progress' })
}

/** Record that the responses went back; the plan check now waits on the city. */
export async function markRoundSent(store: ActionStore, round: PlanCheckRound, date = todayISO()): Promise<boolean> {
  const ok = await store.update('plan_check_rounds', round.id, { sent_date: date })
  if (!ok) return false
  const { stage, phase } = jobStage(store.phases, round.job_id)
  const waiting = stage === 'plan_check' && phase && phase.status === 'in_progress'
  if (waiting) await store.update('phases', phase.id, { status: 'waiting' })
  store.toast(waiting ? 'Responses sent. Plan check is now waiting on the reviewer.' : 'Responses marked as sent', 'ok', {
    label: 'Undo',
    run: async () => {
      await store.update('plan_check_rounds', round.id, { sent_date: round.sent_date })
      if (waiting) await store.update('phases', phase.id, { status: 'in_progress' })
    },
  })
  return true
}
