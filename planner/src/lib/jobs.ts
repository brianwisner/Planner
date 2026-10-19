import { addDays, format } from 'date-fns'
import { calendarItems, type CalItem } from './calendar'
import { jobBilling, workPhase as defaultWorkPhase, type JobBilling } from './calc'
import type { Store } from './store'
import type { Job, JobStatus, Phase, Task } from './types'
import { sum } from './utils'
import { jobPhaseGroups } from './phases'

export type JobsView = 'table' | 'sheet' | 'board' | 'gantt' | 'calendar'
export type JobsStatus = JobStatus | 'open' | 'all'
export type JobsFocus = 'all' | 'due' | 'waiting' | 'over_estimate' | 'billing'
export interface JobsQuery { view: JobsView; status: JobsStatus; client: string; q: string; focus: JobsFocus }
type JobsStore = Pick<Store, 'jobs' | 'clients' | 'phases' | 'tasks' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings'>

export interface JobOverview {
  job: Job
  clientName: string
  assigneeName: string // historical phase ownership, for exports only
  phases: Phase[] // all saved phases, including retained planning history
  workflowPhases: Phase[]
  historyPhases: Phase[]
  currentPhase: Phase | undefined
  workPhase: Phase | undefined
  actualHours: number // all completed effort plus running timers as of the supplied now
  completedHours: number
  billableHours: number // completed time only, matching Billing
  nonBillableHours: number
  runningCount: number
  estimatedHours: number
  remainingHours: number // unfinished phase estimates less actual effort, for open jobs
  currentPhaseHours: number
  nextDeadline: CalItem | null
  nextTask: Task | null
  nextTaskDate: string | null
  openTaskCount: number
  waitingTaskCount: number
  waitingPhaseCount: number
  overEstimatePhases: Phase[]
  waiting: boolean
  overEstimate: boolean
  billing: JobBilling
}

const VIEWS: JobsView[] = ['table', 'sheet', 'board', 'gantt', 'calendar']
const STATUSES: JobsStatus[] = ['open', 'active', 'on_hold', 'complete', 'cancelled', 'archived', 'all']
const FOCUSES: JobsFocus[] = ['all', 'due', 'waiting', 'over_estimate', 'billing']

/** Keep raw nonblank search text so URL-bound inputs can accept word separators. */
export function parseJobsQuery(params: URLSearchParams): JobsQuery {
  const view = params.get('view') as JobsView
  const status = params.get('status') as JobsStatus
  const focus = params.get('focus') as JobsFocus
  const q = params.get('q') ?? ''
  return {
    view: VIEWS.includes(view) ? view : 'table',
    status: STATUSES.includes(status) ? status : 'open',
    focus: FOCUSES.includes(focus) ? focus : 'all',
    client: (params.get('client') ?? '').trim(), q: q.trim() ? q : '',
  }
}

/** Patch supported filters without losing the selected view or unrelated links. */
export function writeJobsQuery(current: URLSearchParams, patch: Partial<JobsQuery>): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const key of ['view', 'status', 'client', 'q', 'focus'] as const) {
    if (patch[key] !== undefined) next.set(key, patch[key]!)
  }
  const value = parseJobsQuery(next)
  const write = (key: keyof JobsQuery, text: string, fallback = '') => text === fallback ? next.delete(key) : next.set(key, text)
  write('view', value.view, 'table')
  write('status', value.status, 'open')
  write('focus', value.focus, 'all')
  write('client', value.client)
  write('q', value.q)
  return next
}

function taskDate(task: Task): string | null {
  return task.scheduled_at ? format(new Date(task.scheduled_at), 'yyyy-MM-dd') : task.due_date
}

/** Read-only rows shared by the Jobs summary, filters, and compact job table. */
export function jobRows(store: JobsStore, now = new Date()): JobOverview[] {
  const operational = new Set(store.jobs.filter(job => job.status === 'active' || job.status === 'on_hold').map(job => job.id))
  const deadlines = calendarItems({ ...store, jobs: store.jobs.filter(job => operational.has(job.id)) }).filter(item => !item.done)
  const nowMs = now.getTime()
  return [...store.jobs].sort((a, b) => a.priority - b.priority ||
    (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) || a.id.localeCompare(b.id)).map(job => {
    const { all: phases, workflow: workflowPhases, history: historyPhases } = jobPhaseGroups(store.phases, job.id)
    const openPhases = workflowPhases.filter(phase => phase.status !== 'complete')
    const currentPhase = openPhases[0] ?? workflowPhases.at(-1)
    const entries = store.timeEntries.filter(entry => entry.job_id === job.id)
    const actualByPhase = new Map<string, number>()
    const actualHours = sum(entries.map(entry => {
      const elapsed = entry.started_at ? (nowMs - new Date(entry.started_at).getTime()) / 3600000 : 0
      const hours = entry.hours ?? (Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0)
      if (entry.phase_id) actualByPhase.set(entry.phase_id, (actualByPhase.get(entry.phase_id) ?? 0) + hours)
      return hours
    }))
    const actionTasks = operational.has(job.id) ? store.tasks.filter(task => task.job_id === job.id && task.status !== 'done')
      .sort((a, b) => (taskDate(a) ?? '9999-12-31').localeCompare(taskDate(b) ?? '9999-12-31') ||
        a.sort_order - b.sort_order || a.id.localeCompare(b.id)) : []
    const nextTask = actionTasks[0] ?? null
    const nextDeadline = deadlines.find(item => item.jobId === job.id) ?? null
    const waitingTaskCount = actionTasks.filter(task => task.status === 'waiting').length
    const waitingPhaseCount = operational.has(job.id) ? openPhases.filter(phase => phase.status === 'waiting').length : 0
    const overEstimatePhases = operational.has(job.id) ? openPhases.filter(phase => phase.estimate_hours > 0 &&
      (actualByPhase.get(phase.id) ?? 0) > phase.estimate_hours) : []
    const billing = jobBilling(store, job)
    return {
      job, clientName: store.clients.find(client => client.id === job.client_id)?.name ?? '',
      assigneeName: store.profiles.find(profile => profile.id === currentPhase?.assignee_id)?.full_name ?? '',
      phases, workflowPhases, historyPhases, currentPhase, workPhase: defaultWorkPhase(workflowPhases, job.id), actualHours,
      completedHours: billing.loggedHours, billableHours: billing.billableHours, nonBillableHours: billing.nonBillableHours,
      runningCount: entries.filter(entry => entry.hours == null && entry.started_at).length,
      estimatedHours: sum(workflowPhases.map(phase => phase.estimate_hours)),
      remainingHours: operational.has(job.id) ? sum(openPhases.map(phase => Math.max(0, phase.estimate_hours - (actualByPhase.get(phase.id) ?? 0)))) : 0,
      currentPhaseHours: currentPhase ? actualByPhase.get(currentPhase.id) ?? 0 : 0,
      nextDeadline, nextTask, nextTaskDate: nextTask ? taskDate(nextTask) : null,
      openTaskCount: actionTasks.length, waitingTaskCount, waitingPhaseCount, overEstimatePhases,
      waiting: job.status === 'on_hold' || waitingTaskCount > 0 || waitingPhaseCount > 0,
      overEstimate: overEstimatePhases.length > 0, billing,
    }
  })
}

export function filterJobRows(rows: JobOverview[], query: Pick<JobsQuery, 'status' | 'client' | 'q' | 'focus'>, now = new Date()): JobOverview[] {
  const dueEnd = format(addDays(now, 6), 'yyyy-MM-dd')
  const words = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter(row => {
    if (query.status === 'open' ? row.job.status !== 'active' && row.job.status !== 'on_hold' :
      query.status !== 'all' && row.job.status !== query.status) return false
    if (query.client && row.job.client_id !== query.client) return false
    const text = [row.job.name, row.job.job_number, row.clientName, row.job.address].join(' ').toLowerCase()
    if (!words.every(word => text.includes(word))) return false
    switch (query.focus) {
      case 'due': return row.nextDeadline != null && row.nextDeadline.date <= dueEnd
      case 'waiting': return row.waiting
      case 'over_estimate': return row.overEstimate
      case 'billing': return row.billing.unbilledAmount > 0.005 || row.billing.outstanding > 0.005
      default: return true
    }
  })
}
