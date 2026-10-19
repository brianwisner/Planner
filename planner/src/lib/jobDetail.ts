import { format } from 'date-fns'
import { calendarItems } from './calendar'
import { jobCharges } from './calc'
import { jobRows } from './jobs'
import type { Store } from './store'
import type { Task, TimeEntry } from './types'
import { sum } from './utils'
import { isWorkflowPhase, phaseLabel } from './phases'

type JobDetailStore = Pick<Store, 'jobs' | 'clients' | 'phases' | 'tasks' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings' | 'schedule' | 'comments' | 'me'>

// Normalize UTC offsets without dropping PostgreSQL's fractional microseconds.
function timestampKey(iso: string): string {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(iso)
  if (!match) return iso
  return new Date(match[1] + match[3]).toISOString().slice(0, 19) + '.' + (match[2] ?? '').padEnd(6, '0')
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const createdOrder = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  compare(timestampKey(a.created_at), timestampKey(b.created_at)) || a.id.localeCompare(b.id)
const recentOrder = (a: { date: string; created_at: string; id: string }, b: { date: string; created_at: string; id: string }) =>
  b.date.localeCompare(a.date) || createdOrder(b, a)

export function jobTaskDate(task: Task): string | null {
  return task.scheduled_at ? format(new Date(task.scheduled_at), 'yyyy-MM-dd') : task.due_date
}

function readyOrder(a: Task, b: Task): number {
  return Number(b.status === 'doing') - Number(a.status === 'doing') ||
    (jobTaskDate(a) ?? '9999-12-31').localeCompare(jobTaskDate(b) ?? '9999-12-31') ||
    compare(timestampKey(a.scheduled_at ?? ''), timestampKey(b.scheduled_at ?? '')) ||
    a.sort_order - b.sort_order || a.id.localeCompare(b.id)
}

function workedHours(entry: TimeEntry, nowMs: number): number {
  if (entry.hours != null) return entry.hours
  const elapsed = entry.started_at ? (nowMs - new Date(entry.started_at).getTime()) / 3600000 : 0
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0
}

/** Job history stays visible; only active/on-hold work creates operational alerts. */
export function jobDetailData(store: JobDetailStore, jobId: string, now = new Date()) {
  const job = store.jobs.find(candidate => candidate.id === jobId)
  if (!job) return null
  const overview = jobRows({ ...store, jobs: [job] }, now)[0]
  const today = format(now, 'yyyy-MM-dd')
  const operational = job.status === 'active' || job.status === 'on_hold'
  const client = store.clients.find(candidate => candidate.id === job.client_id)
  const phases = overview.phases
  const phaseMap = new Map(phases.map(phase => [phase.id, phase]))
  const jobTasks = store.tasks.filter(task => task.job_id === jobId)
  const readyTasks = jobTasks.filter(task => task.status !== 'waiting' && task.status !== 'done').sort(readyOrder)
  const waitingTasks = jobTasks.filter(task => task.status === 'waiting').sort(readyOrder)
  const doneTasks = jobTasks.filter(task => task.status === 'done').sort((a, b) =>
    compare(timestampKey(b.completed_at ?? b.created_at), timestampKey(a.completed_at ?? a.created_at)) || createdOrder(b, a))
  const tasks = [...readyTasks, ...waitingTasks, ...doneTasks]
  const recentEntries = store.timeEntries.filter(entry => entry.job_id === jobId).sort(recentOrder)
  const runningEntries = recentEntries.filter(entry => entry.hours == null && entry.started_at)
  const myRunningEntries = runningEntries.filter(entry => entry.user_id === store.me?.id)
  const items = jobCharges(store, jobId).items.sort((a, b) => recentOrder(a.item, b.item))
  const comments = store.comments.filter(comment => comment.job_id === jobId).sort((a, b) => createdOrder(b, a))
  const upcomingPlans = store.schedule.filter(entry => entry.job_id === jobId && entry.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || createdOrder(a, b))
    .map(entry => ({ entry, phase: entry.phase_id ? phaseMap.get(entry.phase_id) : undefined,
      phaseName: phaseMap.has(entry.phase_id ?? '') ? phaseLabel(phaseMap.get(entry.phase_id!)!) : 'General', isOwner: entry.user_id === store.me?.id }))
  const historyUpcomingPlans = upcomingPlans.filter(plan => plan.phase && !isWorkflowPhase(plan.phase))
  const workflowUpcomingPlans = upcomingPlans.filter(plan => !plan.phase || isWorkflowPhase(plan.phase))
  const deadlines = operational ? calendarItems({ ...store, jobs: [job] }).filter(item => !item.done)
    .sort((a, b) => a.date.localeCompare(b.date) || compare(timestampKey(a.time ?? ''), timestampKey(b.time ?? '')) || a.id.localeCompare(b.id)) : []
  const nowMs = now.getTime()
  const phaseSummaries = phases.map(phase => {
    const entries = recentEntries.filter(entry => entry.phase_id === phase.id)
    const actualHours = sum(entries.map(entry => workedHours(entry, nowMs)))
    return {
      phase, actualHours,
      completedHours: sum(entries.filter(entry => entry.hours != null).map(entry => entry.hours!)),
      remainingHours: operational && isWorkflowPhase(phase) && phase.status !== 'complete' ? Math.max(0, phase.estimate_hours - actualHours) : 0,
      overHours: isWorkflowPhase(phase) && phase.estimate_hours > 0 ? Math.max(0, actualHours - phase.estimate_hours) : 0,
      readyTasks: readyTasks.filter(task => task.phase_id === phase.id),
      waitingTasks: waitingTasks.filter(task => task.phase_id === phase.id),
      doneTasks: doneTasks.filter(task => task.phase_id === phase.id),
    }
  })
  return {
    overview, today, operational, client, phases, workflowPhases: overview.workflowPhases, historyPhases: overview.historyPhases,
    tasks, readyTasks, waitingTasks, doneTasks,
    nextActionableTask: operational ? readyTasks[0] ?? null : null,
    deadlines, overdueDeadlines: deadlines.filter(item => item.date < today),
    upcomingDeadlines: deadlines.filter(item => item.date >= today),
    recentEntries, items, comments, upcomingPlans, upcomingPlannedHours: sum(upcomingPlans.map(plan => plan.entry.hours)),
    workflowUpcomingPlans, historyUpcomingPlans,
    workflowUpcomingPlannedHours: sum(workflowUpcomingPlans.map(plan => plan.entry.hours)),
    historyUpcomingPlannedHours: sum(historyUpcomingPlans.map(plan => plan.entry.hours)),
    runningEntries, myRunningEntries, phaseSummaries,
    waitingTaskCount: waitingTasks.length, waitingPhaseCount: overview.workflowPhases.filter(phase => phase.status === 'waiting').length,
  }
}

export type JobDetailModel = NonNullable<ReturnType<typeof jobDetailData>>
