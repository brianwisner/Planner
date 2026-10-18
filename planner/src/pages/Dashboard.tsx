// The owner's daily overview: next steps, time, and billing follow-up.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import { hoursForPhase, soloWorkload } from '../lib/calc'
import { dashboardData } from '../lib/dashboard'
import type { CalItem } from '../lib/calendar'
import { PHASE_KIND_SHORT } from '../lib/types'
import { fmtDate, fmtDateTime, fmtHourlyRate, fmtHours, fmtMoney } from '../lib/utils'
import { Checkbox, DueBadge, Icon, Progress } from '../components/ui'
import { TaskModal, toggleTaskDone } from '../components/editors'
import { useReminders } from '../lib/reminders'

export function Dashboard() {
  const store = useData()
  const { jobs, tasks, clients } = store
  const [editing, setEditing] = useState<string | null>(null)
  const [taskView, setTaskView] = useState<'ready' | 'waiting'>('ready')
  const [now, setNow] = useState(() => new Date())
  useReminders()
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [])

  const data = useMemo(() => dashboardData(store, now), [store, now])
  const workload = soloWorkload(store)
  const { today, week, money } = data
  const readyTasks = data.openTasks.filter(t => t.status !== 'waiting')
  const waitingTasks = data.openTasks.filter(t => t.status === 'waiting')
  const visibleTasks = taskView === 'ready' ? readyTasks : waitingTasks
  const checks = data.watch.filter(row => row.kind !== 'waiting_task')
  const upcoming = data.upcoming.filter(item => item.date > today)
  const deadlineCount = data.overdue.length + data.upcoming.length
  const editingTask = tasks.find(t => t.id === editing)
  const clientName = (jobId: string) => clients.find(c => c.id === jobs.find(j => j.id === jobId)?.client_id)?.name ?? ''
  const jobContext = (jobId: string) => [clientName(jobId), jobs.find(j => j.id === jobId)?.name].filter(Boolean).join(' · ')
  const capacityPercent = Math.max(0, Math.min(100, week.hours / week.capacity * 100))

  function deadlineGroup(label: string, items: CalItem[]) {
    if (!items.length) return null
    return <div className="dashboard-deadline-group">
      <h3 className={label === 'Overdue' ? 'danger-text' : ''}>{label} <span>{items.length}</span></h3>
      <ul className="list">{items.slice(0, 4).map(item => <li key={item.id}>
        <span className={`dashboard-kind ${item.kind === 'site_visit' ? 'site' : ''}`} title={item.kind === 'site_visit' ? 'Site visit' : item.kind}><Icon name={item.kind === 'site_visit' ? 'pin' : item.kind === 'task' ? 'check' : 'calendar'} size={16} /></span>
        <div className="title"><Link to={item.link}>{item.title}</Link><div className="meta">{jobContext(item.jobId)}{item.time && ` · ${fmtDateTime(item.time)}`}</div></div>
        <DueBadge date={item.date} />
      </li>)}</ul>
      {items.length > 4 && <Link className="dashboard-more" to="/calendar">View all {items.length} {label.toLowerCase()} deadlines →</Link>}
    </div>
  }

  return <div className="dashboard-page">
    <div className="page-header dashboard-header">
      <div><h1>Dashboard</h1><p className="dashboard-subtitle">{fmtDate(today, 'long')}</p></div>
      <Link className="dashboard-header-link" to="/calendar"><Icon name="calendar" size={16} /> Open calendar →</Link>
    </div>

    <div className="stats dashboard-stats">
      <Link className="stat dashboard-stat dashboard-stat-money" to="/billing"><div className="label"><Icon name="billing" size={15} /> Ready to bill</div><div className="value">{fmtMoney(money.toBillAmount)}</div><div className="sub">{money.readyToBill.length} job{money.readyToBill.length === 1 ? '' : 's'} needing an invoice</div></Link>
      <Link className="stat dashboard-stat" to="/billing"><div className="label"><Icon name="time" size={15} /> Awaiting payment</div><div className="value">{fmtMoney(money.outstanding)}</div><div className="sub">{money.unpaidInvoices.length} unpaid invoice{money.unpaidInvoices.length === 1 ? '' : 's'}</div></Link>
      <Link className="stat dashboard-stat" to="/time"><div className="label"><Icon name="time" size={15} /> This week</div><div className="value">{fmtHours(week.hours)}</div><div className="sub">{fmtHours(week.billableHours)} billable · {fmtHours(week.nonBillableHours)} nonbillable</div></Link>
      <Link className="stat dashboard-stat" to="/jobs"><div className="label"><Icon name="jobs" size={15} /> Active jobs</div><div className="value">{data.activeJobs.length}</div><div className="sub">{data.onHoldJobs.length} on hold · priority order below</div></Link>
    </div>

    {data.running.length > 0 && <div className="dashboard-running"><Icon name="time" size={18} /><div><strong>{data.running.length === 1 ? 'Timer running' : `${data.running.length} timers running`}</strong><span>{jobContext(data.running[0].job_id)}{data.running[0].billable === false ? ' · Nonbillable' : ''} · not included in completed hours yet</span></div><Link to="/time">Review timer{data.running.length === 1 ? '' : 's'} →</Link></div>}

    <div className="dashboard-grid">
      <div className="dashboard-column">
        <section className="card dashboard-deadlines" aria-labelledby="dashboard-deadlines-title">
          <div className="dashboard-card-header"><h2 id="dashboard-deadlines-title">Deadlines <span className={`badge ${data.overdue.length ? 'overdue' : ''}`}>{deadlineCount}</span></h2><span className="tiny muted">Today–{fmtDate(data.upcomingEnd)}</span></div>
          {data.overdue.length === 0 && <p className="dashboard-clear"><Icon name="check" size={15} /> No overdue deadlines</p>}
          {deadlineGroup('Overdue', data.overdue)}
          {deadlineGroup('Today', data.dueToday)}
          {deadlineGroup('Coming up', upcoming)}
          {data.upcoming.length === 0 && <p className="dashboard-empty">Nothing due in the next 7 days. <Link to="/calendar">View calendar →</Link></p>}
        </section>

        <section className="card" aria-labelledby="dashboard-tasks-title">
          <div className="dashboard-card-header"><h2 id="dashboard-tasks-title">Tasks <span className="badge">{data.openTasks.length}</span></h2><Link className="small" to="/jobs?view=board">Task board →</Link></div>
          <div className="dashboard-task-tabs" aria-label="Task list"><button type="button" aria-pressed={taskView === 'ready'} onClick={() => setTaskView('ready')}>Ready ({readyTasks.length})</button><button type="button" aria-pressed={taskView === 'waiting'} onClick={() => setTaskView('waiting')}>Waiting ({waitingTasks.length})</button></div>
          {visibleTasks.length === 0 && <p className="dashboard-empty">{taskView === 'waiting' ? 'No tasks marked waiting.' : 'No ready tasks. Check Waiting or add a task from the top bar.'}</p>}
          <ul className="list dashboard-task-list">{visibleTasks.slice(0, 6).map(task => {
            const job = jobs.find(j => j.id === task.job_id)
            return <li key={task.id}>
              <Checkbox on={false} label={`Complete ${task.title}`} onToggle={() => void toggleTaskDone(store, task)} />
              <div className="title"><button type="button" className="dashboard-task-link" aria-label={`Edit task: ${task.title}`} onClick={() => setEditing(task.id)}>{task.is_site_visit && <Icon name="pin" size={13} />}{task.title}</button><div className="meta"><Link to={`/jobs/${task.job_id}`}>{jobContext(task.job_id)}</Link></div>
                {(task.status === 'doing' || job?.status === 'on_hold' || task.scheduled_at) && <div className="dashboard-task-detail">{task.status === 'doing' && <span className="badge doing">In progress</span>}{job?.status === 'on_hold' && <span className="badge on_hold">Job on hold</span>}{task.scheduled_at && <span>{fmtDateTime(task.scheduled_at)}</span>}</div>}
              </div><DueBadge date={task.scheduled_at ? fmtLocalDate(task.scheduled_at) : task.due_date} />
            </li>
          })}</ul>
          {visibleTasks.length > 6 && <Link className="dashboard-more" to="/jobs?view=board">Showing 6 of {visibleTasks.length} · View all tasks →</Link>}
        </section>

        <section className="card" aria-labelledby="dashboard-queue-title">
          <div className="dashboard-card-header"><h2 id="dashboard-queue-title">Job queue <span className="badge">{data.activeJobs.length}</span></h2><Link className="small" to="/jobs">All jobs →</Link></div>
          <p className="dashboard-subtitle">Active jobs in your priority order.</p>
          {data.queue.length === 0 && <p className="dashboard-empty">No active jobs. <Link to="/jobs">View jobs →</Link></p>}
          <ol className="list dashboard-queue">{data.queue.slice(0, 5).map(({ job, phase, clientName: client }, index) => {
            const logged = phase ? hoursForPhase(store.timeEntries, phase.id) : 0
            return <li key={job.id}><span className="dashboard-rank" aria-label={`Queue position ${index + 1}`}>{index + 1}</span><div className="title"><Link to={`/jobs/${job.id}`}>{job.name}</Link><div className="meta">{client}{phase && ` · ${PHASE_KIND_SHORT[phase.kind]}`}</div>{phase && phase.estimate_hours > 0 && <div className="dashboard-queue-progress"><Progress value={logged} max={phase.estimate_hours} /><span>{fmtHours(logged)} / {fmtHours(phase.estimate_hours)}</span></div>}</div><DueBadge date={phase?.due_date ?? job.due_date} /></li>
          })}</ol>
          {data.queue.length > 5 && <Link className="dashboard-more" to="/jobs">View all {data.queue.length} active jobs →</Link>}
        </section>
      </div>

      <div className="dashboard-column">
        <section className="card" aria-labelledby="dashboard-week-title">
          <div className="dashboard-card-header"><h2 id="dashboard-week-title">This week & capacity</h2><Link className="small" to="/time">Timesheet →</Link></div>
          <div className="dashboard-week-total"><strong>{fmtHours(week.hours)}</strong><span>completed · {fmtDate(data.weekStart)}–{fmtDate(data.weekEnd)}</span></div>
          <div className={`dashboard-capacity-bar ${week.hours > week.capacity ? 'over' : ''}`} role="meter" aria-label="Completed hours against weekly capacity" aria-valuemin={0} aria-valuemax={week.capacity} aria-valuenow={Math.min(week.hours, week.capacity)} aria-valuetext={`${fmtHours(week.hours)} completed of ${fmtHours(week.capacity)} weekly capacity`}><span style={{ width: `${capacityPercent}%` }} /></div>
          <div className="dashboard-week-split"><span><i />{fmtHours(week.billableHours)} billable</span><span><i />{fmtHours(week.nonBillableHours)} nonbillable</span></div>
          <dl className="dashboard-facts"><div><dt>Weekly capacity</dt><dd>{fmtHours(week.capacity)}</dd></div><div><dt>Planned today onward</dt><dd>{fmtHours(week.plannedHours)}</dd></div><div><dt>Estimated work left</dt><dd>{fmtHours(workload.remainingHours)}</dd></div><div><dt>Booked through</dt><dd>{workload.bookedUntil ? fmtDate(workload.bookedUntil.toISOString()) : 'Available'}</dd></div></dl>
          <p className="dashboard-note">Planned hours are separate from worked time. The booked-through estimate uses remaining phase hours at your weekly capacity.</p>
          <div className="dashboard-card-links"><Link to="/jobs?view=gantt">Plan hours →</Link><Link to="/settings">Capacity settings →</Link></div>
        </section>

        <section className="card" aria-labelledby="dashboard-billing-title">
          <div className="dashboard-card-header"><h2 id="dashboard-billing-title">Billing follow-up</h2><Link className="small" to="/billing">Open billing →</Link></div>
          <h3 className="dashboard-section-label">Ready to bill <span>{money.readyToBill.length} jobs</span></h3>
          {money.readyToBill.length === 0 && <p className="dashboard-empty">No uncovered billable work.</p>}
          <ul className="list">{money.readyToBill.slice(0, 4).map(row => <li key={row.job.id}><div className="title"><Link to={`/billing?job=${row.job.id}`}>{row.job.name}</Link><div className="meta">{clientName(row.job.id)}</div><div className="meta">{[row.unbilledHours > 0.01 ? `${fmtHours(row.unbilledHours)} not billed` : '', row.unbilledItems > 0.005 ? `${fmtMoney(row.unbilledItems)} charges` : ''].filter(Boolean).join(' · ')}</div></div><Link className="dashboard-money-link" to={`/billing?job=${row.job.id}`} aria-label={`Bill ${fmtMoney(row.unbilledAmount)} for ${row.job.name}`}>{fmtMoney(row.unbilledAmount)} <Icon name="chevronR" size={14} /></Link></li>)}</ul>
          {money.readyToBill.length > 4 && <Link className="dashboard-more" to="/billing">View all {money.readyToBill.length} jobs needing billing →</Link>}
          {money.unpaidInvoices.length > 0 && <div className="dashboard-invoices"><h3 className="dashboard-section-label">Awaiting payment <span>Oldest first</span></h3><ul className="list">{money.unpaidInvoices.slice(0, 3).map(({ invoice, job, clientName: client }) => <li key={invoice.id}><div className="title"><Link to={`/billing?job=${job.id}`}>{invoice.number || 'Unnumbered invoice'} · {job.name}</Link><div className="meta">{client} · issued {fmtDate(invoice.issued_date)}</div></div><span className="bold nowrap">{fmtMoney(invoice.amount)}</span></li>)}</ul>{money.unpaidInvoices.length > 3 && <Link className="dashboard-more" to="/billing">View remaining unpaid invoices →</Link>}</div>}
          <div className="dashboard-return"><div><span>Fees per worked hour</span><strong>{fmtHourlyRate(money.effectiveHourlyRate)}</strong></div><p>{fmtMoney(money.feeRevenue)} recorded fees · {fmtHours(money.loggedHours)} completed</p><details><summary>How this is calculated</summary><p>Lifetime across unarchived jobs: deposits and invoices counted once, less funded separate charges, divided by all completed hours including nonbillable time. Includes unused deposits; before overhead and tax.</p></details></div>
        </section>

        <section className="card" aria-labelledby="dashboard-checks-title">
          <div className="dashboard-card-header"><h2 id="dashboard-checks-title">Job checks <span className="badge">{checks.length}</span></h2><Link className="small" to="/reports">Reports →</Link></div>
          {checks.length === 0 && <p className="dashboard-clear"><Icon name="check" size={15} /> No estimate overruns or waiting phases.</p>}
          <ul className="list">{checks.slice(0, 4).map(row => <li key={`${row.kind}-${row.phase.id}`}><span className={`dashboard-kind ${row.kind === 'over_estimate' ? 'warning' : ''}`}><Icon name={row.kind === 'over_estimate' ? 'reports' : 'time'} size={16} /></span><div className="title"><Link to={`/jobs/${row.job.id}`}>{row.job.name}</Link><div className="meta">{clientName(row.job.id)} · {row.phase.name}</div><div className={row.kind === 'over_estimate' ? 'small warn-text' : 'small muted'}>{row.kind === 'over_estimate' ? `${fmtHours(row.overHours)} over estimate · ${fmtHours(row.loggedHours)} / ${fmtHours(row.phase.estimate_hours)}` : 'Waiting — follow up when ready'}</div></div></li>)}</ul>
          {checks.length > 4 && <Link className="dashboard-more" to="/jobs">More job checks · View jobs →</Link>}
        </section>
      </div>
    </div>
    {editingTask && <TaskModal task={editingTask} onClose={() => setEditing(null)} />}
  </div>
}

function fmtLocalDate(iso: string) {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
