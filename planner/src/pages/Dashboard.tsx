// Dashboard: team workload, how far out everyone is booked, overdue and
// due-soon items, and what's running right now.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import { jobBilling, teamWorkload } from '../lib/calc'
import { calendarItems } from '../lib/calendar'
import { PHASE_KIND_SHORT } from '../lib/types'
import { daysUntil, fmtDate, fmtHours, fmtMoney, fmtSigned, todayISO } from '../lib/utils'
import { Avatar, Checkbox, DueBadge, Empty, Icon, Person } from '../components/ui'
import { TaskModal, toggleTaskDone } from '../components/editors'
import { useReminders } from '../lib/reminders'

export function Dashboard() {
  const store = useData()
  const { jobs, phases, tasks, me, clients } = store
  const [editing, setEditing] = useState<string | null>(null)
  const [onlyMine, setOnlyMine] = useState(false)
  useReminders()

  const workload = useMemo(() => teamWorkload(store), [store])
  const toBill = useMemo(() => jobs.filter(j => j.status !== 'archived').map(j => jobBilling(store, j)).filter(b => b.unbilledAmount > 0.5).sort((a, b) => b.unbilledAmount - a.unbilledAmount), [store, jobs])
  const items = useMemo(() => calendarItems(store), [store])
  const today = todayISO()
  const open = items.filter(i => !i.done && (!onlyMine || i.assigneeId === me?.id || i.assigneeId == null))
  const overdue = open.filter(i => i.date < today)
  const week = open.filter(i => i.date >= today && (daysUntil(i.date) ?? 99) <= 7)
  const activeJobs = jobs.filter(j => j.status === 'active')
  const furthest = workload.reduce<Date | null>((a, w) => (!a || (w.bookedUntil && w.bookedUntil > a)) ? w.bookedUntil ?? a : a, null)
  const myTasks = tasks.filter(t => t.status !== 'done' && t.assignee_id === me?.id).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')).slice(0, 8)

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <span className="muted small">{fmtDate(today, 'long')}</span>
        <div className="actions">
          <button className={`chip ${onlyMine ? 'on' : ''}`} onClick={() => setOnlyMine(!onlyMine)}>Only my items</button>
        </div>
      </div>

      <div className="stats mb">
        <div className="stat"><div className="label">Active jobs</div><div className="value">{activeJobs.length}</div><div className="sub">{jobs.filter(j => j.status === 'on_hold').length} on hold</div></div>
        <div className="stat"><div className="label">Overdue</div><div className={`value ${overdue.length ? 'danger-text' : ''}`}>{overdue.length}</div><div className="sub">phases, tasks, visits</div></div>
        <div className="stat"><div className="label">Due this week</div><div className="value">{week.length}</div><div className="sub">next 7 days</div></div>
        <div className="stat"><div className="label">Booked out to</div><div className="value">{furthest ? fmtDate(furthest.toISOString()) : '–'}</div><div className="sub">at current estimates</div></div>
      </div>

      <div className="grid cols-2">
        <div>
          <div className="card">
            <h2>Team workload</h2>
            <p className="small muted">Remaining hours = estimates on open phases minus hours already logged. "Booked until" assumes each person's weekly capacity (set in Settings).</p>
            {workload.length === 0 && <Empty>No team members yet.</Empty>}
            <ul className="list">
              {workload.map(w => (
                <li key={w.user.id}>
                  <Avatar userId={w.user.id} />
                  <div className="title">
                    <div className="bold">{w.user.full_name}</div>
                    <div className="meta">{w.openPhases.length} open phase{w.openPhases.length === 1 ? '' : 's'} · {fmtHours(w.thisWeekLogged)} logged this week</div>
                  </div>
                  <div className="right">
                    <div className="bold">{fmtHours(w.remainingHours)} left</div>
                    <div className="tiny muted">{w.bookedUntil ? `booked until ${fmtDate(w.bookedUntil.toISOString())} (${w.weeksOut.toFixed(1)} wk)` : 'available'}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>Needs billing <Link className="small" to="/billing" style={{ marginLeft: 'auto', fontWeight: 400 }}>Billing →</Link></h2>
            {toBill.length === 0 && <Empty>All work is paid for or billed.</Empty>}
            <ul className="list">
              {toBill.slice(0, 6).map(b => (
                <li key={b.job.id}>
                  <div className="title"><Link to={`/billing?job=${b.job.id}`}>{b.job.name}</Link><div className="meta">{[b.unbilledHours > 0.01 ? `${fmtHours(b.unbilledHours)} not billed` : '', b.unbilledItems > 0.5 ? `${fmtMoney(b.unbilledItems)} in charges` : '', b.deposits > 0 ? 'deposit used up' : ''].filter(Boolean).join(' · ')}</div></div>
                  <div className="right"><div className="bold danger-text">{fmtMoney(b.unbilledAmount)}</div><div className="tiny muted">balance {fmtSigned(b.balance)}</div></div>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>My open tasks <Link className="small" to="/jobs?view=board" style={{ marginLeft: 'auto', fontWeight: 400 }}>Board →</Link></h2>
            {myTasks.length === 0 && <Empty>Nothing assigned to you. Press <kbd>n</kbd> to add a task.</Empty>}
            <ul className="list">
              {myTasks.map(t => (
                <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
                  <Checkbox on={t.status === 'done'} onToggle={() => void toggleTaskDone(store, t)} />
                  <div className="title">
                    <a href="#" onClick={e => { e.preventDefault(); setEditing(t.id) }}>{t.is_site_visit && <Icon name="pin" size={12} />} {t.title}</a>
                    <div className="meta">{jobs.find(j => j.id === t.job_id)?.name}</div>
                  </div>
                  <DueBadge date={t.due_date} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          <div className="card">
            <h2 className="danger-text">Overdue</h2>
            {overdue.length === 0 && <Empty>Nothing overdue. Nice.</Empty>}
            <ul className="list">
              {overdue.slice(0, 15).map(i => (
                <li key={i.id}>
                  <div className="title"><Link to={i.link}>{i.title}</Link><div className="meta">{i.jobName}</div></div>
                  <Person userId={i.assigneeId} hideName />
                  <DueBadge date={i.date} />
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h2>Due in the next 7 days</h2>
            {week.length === 0 && <Empty>Nothing due this week.</Empty>}
            <ul className="list">
              {week.slice(0, 20).map(i => (
                <li key={i.id}>
                  <span className={`badge ${i.kind === 'site_visit' ? 'site' : i.kind === 'phase' ? 'waiting' : 'ok'}`}>{i.kind === 'site_visit' ? 'Visit' : i.kind === 'phase' ? 'Phase' : i.kind === 'job' ? 'Job' : 'Task'}</span>
                  <div className="title"><Link to={i.link}>{i.title}</Link><div className="meta">{i.jobName}</div></div>
                  <Person userId={i.assigneeId} hideName />
                  <DueBadge date={i.date} />
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h2>Job queue <Link className="small" to="/jobs" style={{ marginLeft: 'auto', fontWeight: 400 }}>All jobs →</Link></h2>
            <ul className="list">
              {activeJobs.slice(0, 6).map(j => {
                const cp = phases.find(p => p.job_id === j.id && p.status !== 'complete')
                return (
                  <li key={j.id}>
                    <span className="muted tiny" style={{ width: 18 }}>{j.priority}</span>
                    <div className="title"><Link to={`/jobs/${j.id}`}>{j.name}</Link><div className="meta">{clients.find(c => c.id === j.client_id)?.name}{cp && ` · ${PHASE_KIND_SHORT[cp.kind]}`}</div></div>
                    <Person userId={cp?.assignee_id} hideName />
                    <DueBadge date={cp?.due_date ?? j.due_date} />
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
      {editing && <TaskModal task={tasks.find(t => t.id === editing)} onClose={() => setEditing(null)} />}
    </div>
  )
}
