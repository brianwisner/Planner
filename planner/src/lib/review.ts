import { format } from 'date-fns'
import type { DailyReview, PlanningEvent, ReviewPriority } from './planningTypes'
import type { Store } from './store'
import { fmtHours, fmtMoney } from './utils'

export function priorReview(reviews: DailyReview[], date: string, completedOnly = false) {
  return reviews.filter(review => review.review_date < date && (!completedOnly || Boolean(review.completed_at))).sort((a, b) => b.review_date.localeCompare(a.review_date))[0]
}
/** Each carried outcome keeps its original source through later review days. */
export function carryPriorities(current: ReviewPriority[], previous: ReviewPriority[], uuid: () => string = () => crypto.randomUUID()): ReviewPriority[] {
  const result = [...current], sources = new Set(current.map(priority => priority.source_id ?? priority.id))
  for (const priority of previous) {
    const source = priority.source_id ?? priority.id
    if (priority.done || !priority.title.trim() || sources.has(source)) continue
    result.push({ ...priority, id: uuid(), done: false, source_id: source }); sources.add(source)
  }
  return result
}

export interface ReviewActivity { id: string; at: string; title: string; link: string; jobId: string | null; source: 'event' | 'recorded'; dateOnly?: boolean }
type ActivityStore = Pick<Store, 'jobs' | 'tasks' | 'timeEntries' | 'invoices' | 'deposits' | 'comments'>
const FIELD_LABELS: Record<string, string> = {
  due_date: 'due date', start_date: 'start date', scheduled_at: 'visit time', estimate_hours: 'estimated hours',
  paid_date: 'payment date', deposit_applied: 'deposit credit', billable: 'billing mode', invoice_id: 'invoice link',
  assignee_id: 'recorded owner', user_id: 'recorded owner', job_id: 'linked job', phase_id: 'phase', job_number: 'job number',
  status_update: 'progress note', next_deliverable: 'next deliverable', remaining_hours: 'remaining estimate',
  internal_target_date: 'internal target', client_commitment_date: 'client commitment', next_follow_up_date: 'next follow-up',
  promised_date: 'promised date', invoice_due_date: 'invoice due date', contact_log: 'contact history', base_hours: 'daily availability',
  recorded_date: 'recorded date', waiting_on: 'waiting on', billing_treatment: 'billing intent',
}
function eventTitle(event: PlanningEvent) {
  if (event.action !== 'update') return event.summary
  const fields = [...new Set(event.changed_fields.filter(field => field !== 'revision' && field !== 'updated_at').map(field => FIELD_LABELS[field] ?? field.replace(/_/g, ' ')))]
  return event.summary + (fields.length ? ` · Changed: ${fields.slice(0, 4).join(', ')}${fields.length > 4 ? `, +${fields.length - 4} more` : ''}` : '')
}
function stampKey(value: string): string | null {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? ''
  return `${date.toISOString().slice(0, 19)}.${fraction.padEnd(6, '0')}`
}
export function reviewActivity(store: ActivityStore, events: PlanningEvent[], since: string, until: string): ReviewActivity[] {
  const lower = stampKey(since), upper = stampKey(until)
  if (!lower || !upper || lower > upper) return []
  const inWindow = (at: string) => { const key = stampKey(at); return Boolean(key && key > lower && key <= upper) }
  const tracked = new Set<string>(), result: ReviewActivity[] = []
  const linkFor = (type: string, id: string, jobId: string | null) => type === 'tasks' && jobId ? `/jobs/${jobId}?task=${id}` : type === 'time_entries' ? `/time?entry=${id}` : type === 'invoices' || type === 'deposits' ? jobId ? `/billing?job=${jobId}` : '/billing' : type === 'schedule_entries' || type === 'daily_availability' || type === 'availability_blocks' ? '/availability' : type === 'follow_ups' ? '/follow-ups' : jobId ? `/jobs/${jobId}` : '/jobs'
  for (const event of events) {
    if (!inWindow(event.occurred_at) || event.entity_type === 'daily_reviews') continue
    tracked.add(`${event.entity_type}:${event.entity_id}`)
    result.push({ id: `event:${event.id}`, at: event.occurred_at, title: eventTitle(event), link: linkFor(event.entity_type, event.entity_id, event.job_id), jobId: event.job_id, source: 'event' })
  }
  const add = (type: string, id: string, at: string | null, title: string, jobId: string | null, suffix = '') => {
    if (!at || !inWindow(at) || tracked.has(`${type}:${id}`)) return
    result.push({ id: `recorded:${type}:${id}${suffix}`, at, title, link: linkFor(type, id, jobId), jobId, source: 'recorded' })
  }
  for (const task of store.tasks) {
    if (task.completed_at && inWindow(task.completed_at)) add('tasks', task.id, task.completed_at, `Task completed: ${task.title}`, task.job_id, ':done')
    else add('tasks', task.id, task.created_at, `Task added: ${task.title}`, task.job_id)
  }
  for (const entry of store.timeEntries) if (entry.hours != null) add('time_entries', entry.id, entry.created_at, `${fmtHours(entry.hours)} recorded for ${format(new Date(`${entry.date}T12:00:00`), 'MMM d')}${entry.billable === false ? ' · nonbillable' : ''}`, entry.job_id)
  for (const invoice of store.invoices) {
    add('invoices', invoice.id, invoice.created_at, `Invoice recorded: ${invoice.number || 'Unnumbered'} · ${fmtMoney(invoice.amount)}`, invoice.job_id)
    // Older invoices have a payment date but no timestamp for the status change.
    // Include boundary days explicitly as date-only history, never as exact events.
    if (invoice.paid_date && invoice.paid_date >= format(new Date(since), 'yyyy-MM-dd') && invoice.paid_date <= format(new Date(until), 'yyyy-MM-dd') && !tracked.has(`invoices:${invoice.id}`)) result.push({ id: `recorded:invoices:${invoice.id}:paid`, at: invoice.paid_date, title: `Invoice payment date: ${invoice.number || 'Unnumbered'} · ${fmtMoney(invoice.amount)}`, link: `/billing?job=${invoice.job_id}`, jobId: invoice.job_id, source: 'recorded', dateOnly: true })
  }
  for (const deposit of store.deposits) add('deposits', deposit.id, deposit.created_at, `Deposit recorded: ${fmtMoney(deposit.amount)}`, deposit.job_id)
  for (const comment of store.comments) add('comments', comment.id, comment.created_at, 'Job note added', comment.job_id)
  for (const job of store.jobs) add('jobs', job.id, job.created_at, `Job added: ${job.name}`, job.id)
  return result.sort((a, b) => (stampKey(b.at) ?? '').localeCompare(stampKey(a.at) ?? '') || a.id.localeCompare(b.id))
}
