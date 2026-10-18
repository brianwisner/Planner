import { addDays, format, startOfWeek } from 'date-fns'
import { calendarItems } from './calendar'
import { isBillable, jobBilling } from './calc'
import type { Store } from './store'
import type { Job, Phase, Task } from './types'
import { sum } from './utils'

type DashboardStore = Pick<Store, 'jobs' | 'phases' | 'tasks' | 'clients' | 'timeEntries' | 'invoices' | 'deposits' | 'items' | 'profiles' | 'settings' | 'me' | 'schedule'>

export type DashboardWatch =
  | { kind: 'over_estimate'; job: Job; phase: Phase; loggedHours: number; overHours: number }
  | { kind: 'waiting_phase'; job: Job; phase: Phase }
  | { kind: 'waiting_task'; job: Job; task: Task }

/** One consistent set of scopes for the owner's dashboard; no date-range rates. */
export function dashboardData(store: DashboardStore, now = new Date()) {
  const today = format(now, 'yyyy-MM-dd')
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd = format(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd')
  const upcomingEnd = format(addDays(now, 6), 'yyyy-MM-dd')
  const jobMap = new Map(store.jobs.map(job => [job.id, job]))
  const jobOrder = (a: Job, b: Job) => a.priority - b.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  const taskDate = (task: Task) => task.scheduled_at ? format(new Date(task.scheduled_at), 'yyyy-MM-dd') : task.due_date ?? '9999-12-31'
  const taskOrder = (a: Task, b: Task) => taskDate(a).localeCompare(taskDate(b)) ||
    jobOrder(jobMap.get(a.job_id)!, jobMap.get(b.job_id)!) || a.sort_order - b.sort_order || a.id.localeCompare(b.id)
  const activeJobs = store.jobs.filter(job => job.status === 'active').sort(jobOrder)
  const onHoldJobs = store.jobs.filter(job => job.status === 'on_hold').sort(jobOrder)
  const actionJobs = [...activeJobs, ...onHoldJobs]
  const actionIds = new Set(actionJobs.map(job => job.id))
  const openTasks = store.tasks.filter(task => task.status !== 'done' && actionIds.has(task.job_id)).sort(taskOrder)
  const deadlines = calendarItems({ ...store, jobs: actionJobs }).filter(item => !item.done)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') ||
      jobOrder(jobMap.get(a.jobId)!, jobMap.get(b.jobId)!) || a.id.localeCompare(b.id))
  const queue = activeJobs.map(job => ({
    job,
    clientName: store.clients.find(client => client.id === job.client_id)?.name ?? '',
    phase: store.phases.filter(phase => phase.job_id === job.id && phase.status !== 'complete')
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))[0],
  }))

  // Worked time includes every job and historical owner. Running timers have no
  // completed hours yet and stay separate from the bounded Monday–Sunday total.
  const completed = store.timeEntries.filter(entry => entry.hours != null)
  const weekEntries = completed.filter(entry => entry.date >= weekStart && entry.date <= weekEnd)
  const week = {
    entries: weekEntries,
    hours: sum(weekEntries.map(entry => entry.hours!)),
    billableHours: sum(weekEntries.filter(isBillable).map(entry => entry.hours!)),
    nonBillableHours: sum(weekEntries.filter(entry => !isBillable(entry)).map(entry => entry.hours!)),
    plannedHours: sum(store.schedule.filter(entry => jobMap.get(entry.job_id)?.status === 'active' &&
      entry.date >= today && entry.date <= weekEnd).map(entry => entry.hours)),
    capacity: store.me?.weekly_hours || store.settings.weekly_capacity || 40,
  }
  const running = store.timeEntries.filter(entry => entry.user_id === store.me?.id && entry.hours == null && entry.started_at)
    .sort((a, b) => b.started_at!.localeCompare(a.started_at!) || a.id.localeCompare(b.id))

  // Closed and cancelled jobs still carry financial history. Archived jobs are
  // deliberately outside the business overview, matching Billing's totals.
  const billingRows = store.jobs.filter(job => job.status !== 'archived').map(job => jobBilling(store, job))
  const readyToBill = billingRows.filter(row => row.unbilledAmount > 0.005)
    .sort((a, b) => b.unbilledAmount - a.unbilledAmount || jobOrder(a.job, b.job))
  const financialIds = new Set(billingRows.map(row => row.job.id))
  const unpaidInvoices = store.invoices.filter(invoice => !invoice.paid_date && financialIds.has(invoice.job_id))
    .map(invoice => {
      const job = jobMap.get(invoice.job_id)!
      return { invoice, job, clientName: store.clients.find(client => client.id === job.client_id)?.name ?? '' }
    }).sort((a, b) => a.invoice.issued_date.localeCompare(b.invoice.issued_date) || jobOrder(a.job, b.job) || a.invoice.id.localeCompare(b.invoice.id))
  const feeRevenue = sum(billingRows.map(row => row.feeRevenue))
  const loggedHours = sum(billingRows.map(row => row.loggedHours))
  const money = {
    all: billingRows, readyToBill, unpaidInvoices,
    toBillAmount: sum(billingRows.map(row => row.unbilledAmount)),
    outstanding: sum(billingRows.map(row => row.outstanding)),
    feeRevenue, loggedHours,
    effectiveHourlyRate: loggedHours > 0 ? feeRevenue / loggedHours : null,
  }

  const loggedByPhase = new Map<string, number>()
  for (const entry of completed) if (entry.phase_id) loggedByPhase.set(entry.phase_id, (loggedByPhase.get(entry.phase_id) ?? 0) + entry.hours!)
  const overEstimate = store.phases.filter(phase => jobMap.get(phase.job_id)?.status === 'active' && phase.status !== 'complete' &&
    phase.estimate_hours > 0 && (loggedByPhase.get(phase.id) ?? 0) > phase.estimate_hours)
    .map(phase => ({ kind: 'over_estimate' as const, job: jobMap.get(phase.job_id)!, phase,
      loggedHours: loggedByPhase.get(phase.id)!, overHours: loggedByPhase.get(phase.id)! - phase.estimate_hours }))
    .sort((a, b) => b.overHours - a.overHours || jobOrder(a.job, b.job) || a.phase.sort_order - b.phase.sort_order || a.phase.id.localeCompare(b.phase.id))
  const overEstimateIds = new Set(overEstimate.map(row => row.phase.id))
  const waitingPhases = store.phases.filter(phase => phase.status === 'waiting' && actionIds.has(phase.job_id) && !overEstimateIds.has(phase.id))
    .sort((a, b) => (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31') ||
      jobOrder(jobMap.get(a.job_id)!, jobMap.get(b.job_id)!) || a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .map(phase => ({ kind: 'waiting_phase' as const, job: jobMap.get(phase.job_id)!, phase }))
  const waitingTasks = openTasks.filter(task => task.status === 'waiting')
    .map(task => ({ kind: 'waiting_task' as const, job: jobMap.get(task.job_id)!, task }))
  const watch: DashboardWatch[] = [...overEstimate, ...waitingTasks, ...waitingPhases]

  return {
    today, weekStart, weekEnd, upcomingEnd, activeJobs, onHoldJobs, queue, openTasks,
    overdue: deadlines.filter(item => item.date < today),
    dueToday: deadlines.filter(item => item.date === today),
    upcoming: deadlines.filter(item => item.date >= today && item.date <= upcomingEnd),
    week, running, money, watch,
  }
}
