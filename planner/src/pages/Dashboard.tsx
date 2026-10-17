// Dashboard: urgent deadlines, open tasks, and the owner's business workload.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import { jobBilling, soloWorkload } from '../lib/calc'
import { calendarItems } from '../lib/calendar'
import { PHASE_KIND_SHORT } from '../lib/types'
import { daysUntil, fmtDate, fmtHours, fmtMoney, fmtSigned, todayISO } from '../lib/utils'
import { Checkbox, DueBadge, Empty, Icon } from '../components/ui'
import { TaskModal, toggleTaskDone } from '../components/editors'
import { useReminders } from '../lib/reminders'

export function Dashboard() {
  const store = useData()
  const { jobs, phases, tasks, clients } = store
  const [editing, setEditing] = useState<string | null>(null)
  useReminders()

  const workload = useMemo(() => soloWorkload(store), [store])
  const toBill = useMemo(() => jobs.filter(j => j.status !== 'archived').map(j => jobBilling(store, j)).filter(b => b.unbilledAmount > 0.5).sort((a, b) => b.unbilledAmount - a.unbilledAmount), [store, jobs])
  const items = useMemo(() => calendarItems(store), [store])
  const today = todayISO()
  const open = items.filter(i => !i.done)
  const overdue = open.filter(i => i.date < today)
  const week = open.filter(i => i.date >= today && (daysUntil(i.date) ?? 99) <= 7)
  const activeJobs = jobs.filter(j => j.status === 'active')
  const cancelledJobIds = new Set(jobs.filter(j => j.status === 'cancelled').map(j => j.id))
  const openTasks = tasks.filter(t => t.status !== 'done' && !cancelledJobIds.has(t.job_id)).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))

  return (
    <div>
      <div className="page-header dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="dashboard-subtitle">{fmtDate(today, 'long')}</p>
        </div>
      </div>

      <div className="stats mb">
        <div className="stat"><div className="label">Active jobs</div><div className="value">{activeJobs.length}</div><div className="sub">{jobs.filter(j => j.status === 'on_hold').length} on hold</div></div>
        <div className="stat"><div className="label">Overdue</div><div className={`value ${overdue.length ? 'danger-text' : ''}`}>{overdue.length}</div><div className="sub">deadlines needing attention</div></div>
        <div className="stat"><div className="label">Next 7 days</div><div className="value">{week.length}</div><div className="sub">upcoming deadlines</div></div>
        <div className="stat"><div className="label">Booked out to</div><div className="value">{workload.bookedUntil ? fmtDate(workload.bookedUntil.toISOString()) : '–'}</div><div className="sub">at current estimates</div></div>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="dashboard-card-header">
            <h2 className={overdue.length ? 'danger-text' : ''}>Overdue <span className="badge">{overdue.length}</span></h2>
            <Link className="small" to="/calendar">Calendar →</Link>
          </div>
          {overdue.length === 0 && <Empty>No overdue deadlines. <Link to="/calendar">View calendar →</Link></Empty>}
          <ul className="list">
            {overdue.slice(0, 15).map(i => (
              <li key={i.id}>
                <div className="title"><Link to={i.link}>{i.title}</Link><div className="meta">{i.jobName}</div></div>
                <DueBadge date={i.date} />
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="dashboard-card-header">
            <h2>Open tasks <span className="badge">{openTasks.length}</span></h2>
            <Link className="small" to="/jobs?view=board">Open board →</Link>
          </div>
          {openTasks.length === 0 && <Empty>No open tasks. <Link to="/jobs?view=board">Open the task board →</Link></Empty>}
          <ul className="list">
            {openTasks.slice(0, 8).map(t => {
              const job = jobs.find(j => j.id === t.job_id)
              const client = clients.find(c => c.id === job?.client_id)
              return (
                <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
                  <Checkbox on={t.status === 'done'} onToggle={() => void toggleTaskDone(store, t)} />
                  <div className="title">
                    <a href="#" onClick={e => { e.preventDefault(); setEditing(t.id) }}>{t.is_site_visit && <Icon name="pin" size={12} />} {t.title}</a>
                    <div className="meta">{[client?.name, job?.name].filter(Boolean).join(' · ')}</div>
                  </div>
                  <DueBadge date={t.due_date} />
                </li>
              )
            })}
          </ul>
        </div>

        <div className="card">
          <div className="dashboard-card-header">
            <h2>Due in the next 7 days <span className="badge">{week.length}</span></h2>
            <Link className="small" to="/calendar">Calendar →</Link>
          </div>
          {week.length === 0 && <Empty>No deadlines in the next 7 days. <Link to="/calendar">View calendar →</Link></Empty>}
          <ul className="list">
            {week.slice(0, 20).map(i => (
              <li key={i.id}>
                <span className={`badge ${i.kind === 'site_visit' ? 'site' : i.kind === 'phase' ? 'waiting' : 'ok'}`}>{i.kind === 'site_visit' ? 'Visit' : i.kind === 'phase' ? 'Phase' : i.kind === 'job' ? 'Job' : 'Task'}</span>
                <div className="title"><Link to={i.link}>{i.title}</Link><div className="meta">{i.jobName}</div></div>
                <DueBadge date={i.date} />
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="dashboard-card-header">
            <h2>Job queue <span className="badge">{activeJobs.length}</span></h2>
            <Link className="small" to="/jobs">All jobs →</Link>
          </div>
          {activeJobs.length === 0 && <Empty>No active jobs. <Link to="/jobs">View jobs →</Link></Empty>}
          <ul className="list">
            {activeJobs.slice(0, 6).map(j => {
              const cp = phases.find(p => p.job_id === j.id && p.status !== 'complete')
              return (
                <li key={j.id}>
                  <span className="muted tiny" style={{ width: 18 }}>{j.priority}</span>
                  <div className="title"><Link to={`/jobs/${j.id}`}>{j.name}</Link><div className="meta">{clients.find(c => c.id === j.client_id)?.name}{cp && ` · ${PHASE_KIND_SHORT[cp.kind]}`}</div></div>
                  <DueBadge date={cp?.due_date ?? j.due_date} />
                </li>
              )
            })}
          </ul>
        </div>

        <div className="card">
          <div className="dashboard-card-header">
            <h2>My workload</h2>
            <Link className="small" to="/settings">Capacity settings →</Link>
          </div>
          <p className="dashboard-subtitle">All active work, less hours logged. Booked dates use your weekly capacity.</p>
          {workload.openPhases.length === 0 && <Empty>No open phases on active jobs. <Link to="/jobs">View jobs →</Link></Empty>}
          <ul className="list">
            <li>
              <div className="title">
                <div className="bold">{workload.openPhases.length} open phase{workload.openPhases.length === 1 ? '' : 's'}</div>
                <div className="meta">{fmtHours(workload.thisWeekLogged)} logged this week</div>
              </div>
              <div className="right">
                <div className="bold">{fmtHours(workload.remainingHours)} left</div>
                <div className="tiny muted">{workload.bookedUntil ? `booked until ${fmtDate(workload.bookedUntil.toISOString())} (${workload.weeksOut.toFixed(1)} wk)` : 'available'}</div>
              </div>
            </li>
          </ul>
        </div>

        <div className="card">
          <div className="dashboard-card-header">
            <h2>Needs billing <span className="badge">{toBill.length}</span></h2>
            <Link className="small" to="/billing">Open billing →</Link>
          </div>
          {toBill.length === 0 && <Empty>All work is paid for or billed. <Link to="/billing">View billing →</Link></Empty>}
          <ul className="list">
            {toBill.slice(0, 6).map(b => (
              <li key={b.job.id}>
                <div className="title"><Link to={`/billing?job=${b.job.id}`}>{b.job.name}</Link><div className="meta">{[b.unbilledHours > 0.01 ? `${fmtHours(b.unbilledHours)} not billed` : '', b.unbilledItems > 0.5 ? `${fmtMoney(b.unbilledItems)} in charges` : '', b.deposits > 0 ? 'deposit used up' : ''].filter(Boolean).join(' · ')}</div></div>
                <div className="right"><div className="bold danger-text">{fmtMoney(b.unbilledAmount)}</div><div className="tiny muted">balance {fmtSigned(b.balance)}</div></div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {editing && <TaskModal task={tasks.find(t => t.id === editing)} onClose={() => setEditing(null)} />}
    </div>
  )
}
