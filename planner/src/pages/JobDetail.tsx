// A job workspace: next steps and phases, with time/charges and notes close by.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { phaseLabel } from '../lib/phases'
import { useData } from '../lib/store'
import type { Job, JobItem, Task, TimeEntry } from '../lib/types'
import { JOB_STATUS_LABEL, PHASE_STATUS_LABEL, TASK_STATUS_LABEL } from '../lib/types'
import { jobHours, timerHours } from '../lib/calc'
import { jobDetailData, jobTaskDate } from '../lib/jobDetail'
import { fmtDate, fmtDateTime, fmtHourlyRate, fmtHours, fmtMoney, fmtSigned, todayISO } from '../lib/utils'
import { Avatar, DueBadge, Empty, Icon, JobStatusSelect, Progress } from '../components/ui'
import { DepositModal, ItemModal, JobModal, TaskModal, TimeModal } from '../components/editors'
import { FeesSummary, WorkStatusBar } from '../components/MoneyCharts'
import { JobWork } from '../components/JobWork'
import { JobPlanning } from '../components/JobPlanning'
import { StatusBadge } from './Billing'

type Section = 'work' | 'hours' | 'notes'

export function JobDetail() {
  const { id = '' } = useParams()
  // Drafts and open forms belong to one job, even when navigating between jobs.
  return <JobWorkspace key={id} id={id} />
}

function JobWorkspace({ id }: { id: string }) {
  const store = useData()
  const nav = useNavigate()
  const { hash } = useLocation()
  const { me, update, insert, remove, toast } = store
  const [params, setParams] = useSearchParams()
  const section: Section = params.get('tab') === 'hours' ? 'hours' : params.get('tab') === 'notes' ? 'notes' : 'work'
  const [now, setNow] = useState(() => new Date())
  const model = useMemo(() => jobDetailData(store, id, now), [store, id, now])
  const hasJob = Boolean(model)
  const hourMap = useMemo(() => new Map(jobHours(store, id).map(row => [row.entry.id, row])), [store, id])
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [taskModal, setTaskModal] = useState<{ task?: Task; phaseId?: string | null } | null>(null)
  const [timeModal, setTimeModal] = useState<{ entry?: TimeEntry; phaseId?: string | null; taskId?: string | null } | null>(null)
  const [deposit, setDeposit] = useState(false)
  const [itemModal, setItemModal] = useState<{ item?: JobItem } | null>(null)
  const [timerBillable, setTimerBillable] = useState(true)
  const timerLock = useRef(false)
  const [timerBusy, setTimerBusy] = useState(false)
  const [timerError, setTimerError] = useState('')
  const [comment, setComment] = useState('')
  const postLock = useRef(false)
  const [posting, setPosting] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [hoursFilter, setHoursFilter] = useState('all')
  const [hoursSearch, setHoursSearch] = useState('')
  const consumedTask = useRef<string | null>(null)
  const consumedPlanningAnchor = useRef(false)

  useEffect(() => {
    if (hash !== '#job-planning') { consumedPlanningAnchor.current = false; return }
    if (!hasJob || consumedPlanningAnchor.current) return
    if (section !== 'work') { setParams(current => { const next = new URLSearchParams(current); next.delete('tab'); return next }, { replace: true }); return }
    consumedPlanningAnchor.current = true
    document.getElementById('job-planning')?.scrollIntoView?.({ block: 'start' })
  }, [hash, section, hasJob, setParams])

  useEffect(() => {
    const refreshClock = () => setNow(new Date())
    const interval = window.setInterval(refreshClock, 60_000)
    window.addEventListener('focus', refreshClock)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refreshClock) }
  }, [])

  useEffect(() => {
    const taskId = params.get('task')
    if (!taskId) { consumedTask.current = null; return }
    if (store.loading || consumedTask.current === taskId) return
    consumedTask.current = taskId
    const task = store.tasks.find(candidate => candidate.id === taskId && candidate.job_id === id)
    if (task) setTaskModal({ task })
    else toast('That task is not available on this job.', 'error')
    setParams(current => { const next = new URLSearchParams(current); next.delete('task'); return next }, { replace: true })
  }, [params, store.tasks, store.loading, id, setParams, toast])

  function setSection(nextSection: Section) {
    setParams(current => {
      const next = new URLSearchParams(current)
      if (nextSection === 'work') next.delete('tab')
      else next.set('tab', nextSection)
      return next
    })
  }

  async function startTimer(phaseId: string | null, taskId: string | null = null) {
    if (!me || !model?.operational || timerLock.current) return
    timerLock.current = true; setTimerBusy(true); setTimerError('')
    let stopped = false
    try {
      const existingTimers = store.timeEntries.filter(entry => entry.user_id === me.id && entry.started_at && entry.hours == null)
      if (existingTimers.length > 1) {
        setTimerError('More than one timer is running. Stop the existing timers from Time or their job pages before starting another.'); return
      }
      const other = existingTimers[0]
      if (other) {
        if (other.job_id === id && other.phase_id === phaseId && other.task_id === taskId && (other.billable !== false) === timerBillable) return
        if (!await update('time_entries', other.id, { hours: timerHours(other), started_at: null })) {
          setTimerError('Could not stop the current timer. Check it before starting another.'); return
        }
        stopped = true
      }
      const created = await insert('time_entries', { job_id: id, phase_id: phaseId, task_id: taskId, user_id: me.id,
        billable: timerBillable, date: todayISO(), started_at: new Date().toISOString(), hours: null })
      if (!created) setTimerError(stopped ? 'The previous timer stopped, but the new timer did not start. Please try again.' : 'The timer did not start. Please try again.')
    } catch {
      setTimerError('Could not confirm the timer change. Refresh and check the timer before retrying.')
    } finally { timerLock.current = false; setTimerBusy(false) }
  }
  async function stopTimer() {
    if (!model || timerLock.current) return
    const running = model.myRunningEntries[0]
    if (!running) return
    timerLock.current = true; setTimerBusy(true); setTimerError('')
    try {
      if (!await update('time_entries', running.id, { hours: timerHours(running), started_at: null })) setTimerError('Could not stop the timer. Check it before retrying.')
    } catch { setTimerError('Could not confirm the timer change. Refresh and check the timer before retrying.') }
    finally { timerLock.current = false; setTimerBusy(false) }
  }
  async function addComment() {
    const body = comment.trim()
    if (!body || !me || postLock.current) return
    postLock.current = true; setPosting(true); setNoteError('')
    try {
      if (await insert('comments', { job_id: id, user_id: me.id, body })) setComment('')
      else setNoteError('Your note was not saved. Your draft is still here.')
    } catch { setNoteError('Could not confirm the save. Your draft is still here; check the notes before retrying.') }
    finally { postLock.current = false; setPosting(false) }
  }

  const jobEditor = editingJob && <JobModal job={editingJob} onClose={() => setEditingJob(null)} onDeleted={() => nav('/jobs', { replace: true })} />
  // An optimistic removal can hide the job before deletion is confirmed.
  // Keep the editor snapshot mounted until its confirmed callback or Cancel.
  if (!model) return <><div className="card"><Empty>Job not found. <Link to="/jobs">Back to jobs</Link></Empty></div>{jobEditor}</>
  const { overview, client, operational } = model
  const { job, billing, workPhase } = overview
  const running = model.myRunningEntries[0]
  const otherTimer = store.timeEntries.find(entry => entry.user_id === me?.id && entry.started_at && entry.hours == null && entry.job_id !== id)
  const nextTask = model.nextActionableTask
  const nextDate = model.deadlines[0]
  const phaseName = (phaseId: string | null) => { const phase = model.phases.find(phase => phase.id === phaseId); return phase ? phaseLabel(phase) : 'General' }
  const logHours = (phaseId: string | null = workPhase?.id ?? null, taskId: string | null = null) => setTimeModal({ phaseId, taskId })
  const addTask = (phaseId: string | null = workPhase?.id ?? null) => setTaskModal({ phaseId })
  const entries = model.recentEntries.filter(entry => {
    if (hoursFilter === 'billable' && entry.billable === false || hoursFilter === 'nonbillable' && entry.billable !== false ||
      hoursFilter === 'running' && !(entry.started_at && entry.hours == null)) return false
    return [entry.notes, phaseName(entry.phase_id)].join(' ').toLowerCase().includes(hoursSearch.trim().toLowerCase())
  })
  const timelineLink = `/jobs?view=gantt&status=${job.status}&client=${encodeURIComponent(job.client_id)}&q=${encodeURIComponent(job.job_number || job.name)}`

  return (
    <><div className="job-detail">
      <div className="page-header job-detail-header">
        <div className="job-detail-title">
          <div className="job-breadcrumb small muted"><Link to="/jobs">Jobs</Link><span>›</span>{client ? <Link to={`/clients/${client.id}`}>{client.name}</Link> : <span>Client not listed</span>}</div>
          <h1 className="job-heading"><span>{job.job_number && <span className="muted">{job.job_number} · </span>}{job.name}</span><JobStatusSelect value={job.status} label={`Status for ${job.name}`} onChange={status => update('jobs', job.id, { status })} /></h1>
          {job.address && <div className="small muted job-address"><Icon name="pin" size={14} />{job.address}</div>}
        </div>
        <div className="job-header-actions">
          <button className="btn primary" onClick={() => logHours()}><Icon name="time" size={15} /> Log hours</button>
          <button className="btn" onClick={() => addTask()}><Icon name="plus" size={15} /> Add task</button>
          <details className="job-more-actions" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary className="btn"><Icon name="more" size={16} /> More actions</summary><div className="job-more-menu" onClick={event => { const menu = event.currentTarget.closest('details'); menu?.removeAttribute('open'); menu?.querySelector('summary')?.focus() }}>
            <button onClick={() => setEditingJob(job)}><Icon name="edit" size={15} /> Edit job</button>
            <button onClick={() => setItemModal({})}><Icon name="plus" size={15} /> Add charge</button>
            <button onClick={() => setDeposit(true)}><Icon name="billing" size={15} /> Record deposit</button>
            <Link to={`/billing?job=${id}`}><Icon name="billing" size={15} /> Open billing</Link>
          </div></details>
        </div>
      </div>

      {!operational && <div className="job-status-notice"><b>{JOB_STATUS_LABEL[job.status]} job.</b> History, notes, and billing remain available. Pending work is not included in active deadline alerts or capacity.</div>}
      <div className="job-timer-bar">
        {running ? <><span className="timer-pill"><span className="dot" /> Timer running{running.billable === false ? ' · nonbillable' : ''}</span><span className="small muted">{phaseName(running.phase_id)} · started {fmtDateTime(running.started_at)}</span><button className="btn" onClick={stopTimer} disabled={timerBusy}><Icon name="stop" size={14} />{timerBusy ? 'Saving timer…' : 'Stop timer'}</button></> : operational ? <>
          <select className="timer-mode" aria-label="Timer billing mode" value={timerBillable ? 'billable' : 'nonbillable'} onChange={event => setTimerBillable(event.target.value === 'billable')} disabled={timerBusy}><option value="billable">Billable timer</option><option value="nonbillable">Nonbillable timer</option></select>
          <button className="btn" onClick={() => startTimer(workPhase?.id ?? null)} disabled={timerBusy}><Icon name="play" size={14} />{timerBusy ? 'Starting timer…' : 'Start timer'}</button>
          <span className="small muted">{otherTimer ? <>Starting here stops your timer on <Link to={`/jobs/${otherTimer.job_id}`}>{store.jobs.find(candidate => candidate.id === otherTimer.job_id)?.name ?? 'another job'}</Link>.</> : <>For {workPhase?.name ?? 'general work'} on this job.</>}</span>
        </> : <span className="small muted">Start new timers after returning this job to Active or On hold.</span>}
      </div>
      {timerError && <p className="job-inline-error" role="alert">{timerError}</p>}

      <div className="stats job-detail-stats">
        <div className="stat"><div className="label">Hours worked</div><div className="value">{fmtHours(overview.actualHours)}<span className="job-stat-denominator"> / {fmtHours(overview.estimatedHours)}</span></div><Progress value={overview.actualHours} max={overview.estimatedHours} /><div className="sub">{fmtHours(billing.nonBillableHours)} nonbillable{overview.runningCount > 0 ? ` · ${overview.runningCount} running` : ' · all time'}</div></div>
        <div className="stat"><div className="label">Next deadline</div><div className="value job-stat-text">{nextDate ? fmtDate(nextDate.date) : 'No pending date'}</div><div className="sub">{nextDate ? <><DueBadge date={nextDate.date} /><span className="job-stat-caption">{nextDate.title}</span></> : operational ? 'Add dates to a task, phase, or job.' : 'Historical dates are in Project details.'}</div></div>
        <Link className="stat job-linked-stat" to={`/billing?job=${id}`}><div className="label">Ready to bill <span aria-hidden="true">→</span></div><div className="value">{fmtMoney(billing.unbilledAmount)}</div><div className="sub">{fmtMoney(billing.outstanding)} awaiting payment</div></Link>
        <button className="stat job-linked-stat" onClick={() => setSection('hours')}><div className="label">Effective hourly rate <span aria-hidden="true">→</span></div><div className="value">{fmtHourlyRate(billing.effectiveHourlyRate)}</div><div className="sub">Recorded fees / all completed hours</div></button>
      </div>

      <nav className="job-section-tabs" aria-label="Job sections">
        {([['work', 'Work', model.readyTasks.length + model.waitingTasks.length], ['hours', 'Hours & charges', model.recentEntries.length + model.items.length], ['notes', 'Notes', model.comments.length]] as const).map(([value, label, count]) => <button key={value} aria-label={label} aria-pressed={section === value} className={section === value ? 'active' : ''} onClick={() => setSection(value)}>{label}<span className="job-tab-count" aria-hidden="true">{count}</span></button>)}
      </nav>

      <div className="job-detail-grid">
        <div className="job-detail-main">
          {section === 'work' && <>
            <section className="card job-next-step" aria-labelledby="job-next-step-title">
              <div className="job-section-heading"><h2 id="job-next-step-title">{operational ? 'Next step' : 'Work history'}</h2>{workPhase && <span className={`badge ${workPhase.status}`}>{PHASE_STATUS_LABEL[workPhase.status]} · {workPhase.name}</span>}</div>
              {nextTask ? <><button className="job-next-task" onClick={() => setTaskModal({ task: nextTask })}>{nextTask.title}<Icon name="chevronR" size={18} /></button><div className="job-next-context"><span className={`badge ${nextTask.status}`}>{TASK_STATUS_LABEL[nextTask.status]}</span><span>{phaseName(nextTask.phase_id)}</span>{nextTask.is_site_visit && <span className="badge site">Site visit</span>}{jobTaskDate(nextTask) && <DueBadge date={jobTaskDate(nextTask)} />}</div></> : <p className="small muted">{!operational ? 'Review the phases and tasks below. You can update historical records at any time.' : model.waitingTasks.length ? 'The remaining tasks are waiting. Review what is needed to move them forward.' : 'No ready tasks. Add the next step when you know what needs doing.'}</p>}
              <div className="job-work-signals"><span>{model.readyTasks.length} ready · {model.waitingTasks.length} waiting · {model.doneTasks.length} done</span>{operational && overview.overEstimatePhases.length > 0 && <span className="badge soon">{overview.overEstimatePhases.length} phase{overview.overEstimatePhases.length === 1 ? '' : 's'} over estimate</span>}{operational && model.waitingPhaseCount > 0 && <span className="badge soon">{model.waitingPhaseCount} waiting phase{model.waitingPhaseCount === 1 ? '' : 's'}</span>}</div>
            </section>
            <JobPlanning jobId={id} />
            <JobWork job={job} phases={model.phases} tasks={model.tasks} timeEntries={model.recentEntries} currentPhaseId={workPhase?.id} operational={operational} timerBillable={timerBillable} timerBusy={timerBusy} onAddTask={addTask} onEditTask={task => setTaskModal({ task })} onLog={logHours} onStart={startTimer} />
          </>}

          {section === 'hours' && <>
            <FeesSummary b={billing} />
            <section className="card job-hours-section" aria-labelledby="job-hours-title">
              <div className="job-section-heading"><h2 id="job-hours-title">Hours on this job</h2><button className="btn" onClick={() => logHours()}><Icon name="plus" size={14} /> Log hours</button></div>
              <p className="small muted">{fmtHours(billing.loggedHours)} completed · {fmtHours(billing.billableHours)} billable · {fmtHours(billing.nonBillableHours)} nonbillable. Running timers join the financial totals when stopped.</p>
              <div className="job-history-filters"><input type="search" aria-label="Search hours" placeholder="Search notes or phase…" value={hoursSearch} onChange={event => setHoursSearch(event.target.value)} /><select aria-label="Hours to show" value={hoursFilter} onChange={event => setHoursFilter(event.target.value)}><option value="all">All hours</option><option value="billable">Billable</option><option value="nonbillable">Nonbillable</option><option value="running">Running timers</option></select></div>
              {entries.length ? <div className="table-wrap"><table className="job-history-table"><thead><tr><th>Date / phase</th><th className="num">Hours</th><th>Billing</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><Link to={`/time?entry=${entry.id}&job=${id}`}>{fmtDate(entry.date, 'long')}</Link><div className="small">{phaseName(entry.phase_id)}</div>{entry.notes && <div className="tiny muted job-entry-notes">{entry.notes}</div>}</td><td className="num nowrap">{entry.started_at && entry.hours == null ? <span className="timer-pill"><span className="dot" />running</span> : fmtHours(entry.hours)}</td><td>{hourMap.get(entry.id) && <StatusBadge h={hourMap.get(entry.id)!} />}{entry.hours == null && <span className={`badge ${entry.billable === false ? 'h-nonbillable' : 'todo'}`}>{entry.billable === false ? 'Nonbillable' : 'Billable'}</span>}</td><td><button className="btn ghost job-row-edit" aria-label={`Edit hours on ${entry.date}${entry.notes ? `: ${entry.notes}` : ''}`} onClick={() => setTimeModal({ entry })}><Icon name="edit" size={15} /><span className="hide-mobile">Edit</span></button></td></tr>)}</tbody></table></div> : <p className="job-empty-message">{model.recentEntries.length ? 'No hours match these filters.' : 'No hours logged yet. Log completed time or start a timer from this job.'}</p>}
              <div className="job-history-footer"><span className="small muted">{entries.length} of {model.recentEntries.length} entries · newest first</span><Link to={`/time?job=${id}`}>Open timesheet →</Link></div>
            </section>
            <section className="card" aria-labelledby="job-charges-title"><div className="job-section-heading"><h2 id="job-charges-title">Charges</h2><button className="btn" onClick={() => setItemModal({})}><Icon name="plus" size={14} /> Add charge</button></div>
              {model.items.length ? <div className="table-wrap"><table className="job-history-table"><thead><tr><th>Date / charge</th><th className="num">Amount</th><th>Billing</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{model.items.map(row => <tr key={row.item.id}><td><button className="job-text-button" onClick={() => setItemModal({ item: row.item })}>{row.item.description || row.item.category}</button><div className="tiny muted">{fmtDate(row.item.date)} · {row.item.category}{row.item.quantity !== 1 ? ` · ${row.item.quantity} × ${fmtMoney(row.item.unit_price)}` : ''}</div></td><td className="num nowrap">{fmtMoney(row.amount)}</td><td><StatusBadge h={row} /></td><td><button className="btn ghost job-row-edit" aria-label={`Edit charge: ${row.item.description || row.item.category}`} onClick={() => setItemModal({ item: row.item })}><Icon name="edit" size={15} /><span className="hide-mobile">Edit</span></button></td></tr>)}</tbody></table></div> : <p className="job-empty-message">Add expenses, mileage, printing, permit fees, or flat fees you bill on this job.</p>}
            </section>
          </>}

          {section === 'notes' && <section className="card job-notes-section" aria-labelledby="job-notes-title"><h2 id="job-notes-title">Notes &amp; comments</h2><p className="small muted">Decisions, client updates, and details you want to keep with this job. Newest notes appear first.</p>
            <label htmlFor="job-note">Add a note</label><textarea id="job-note" placeholder="What should you remember about this job?" value={comment} disabled={posting} onChange={event => setComment(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void addComment() } }} />
            <div className="job-note-actions"><span className="tiny muted">Ctrl / ⌘ + Enter to post</span><button className="btn primary" onClick={addComment} disabled={!comment.trim() || !me || posting}>{posting ? 'Posting…' : 'Post note'}</button></div>{noteError && <p className="job-inline-error" role="alert">{noteError}</p>}
            {model.comments.length === 0 && <p className="job-empty-message">No notes yet.</p>}{model.comments.map(note => <article className="comment" key={note.id}><Avatar userId={note.user_id} size="sm" /><div className="body"><div className="who">{store.profiles.find(profile => profile.id === note.user_id)?.full_name ?? 'Saved note'} · {fmtDateTime(note.created_at)}</div><p className="job-note-body">{note.body}</p>{note.user_id === me?.id && <button className="job-text-button job-delete-note" onClick={() => { if (confirm('Delete this note?')) void remove('comments', note.id) }}>Delete note</button>}</div></article>)}
          </section>}
        </div>

        <aside className="job-detail-aside" aria-label="Job context">
          <section className="card"><div className="job-section-heading"><h2>Billing at a glance</h2><Link to={`/billing?job=${id}`}>Details →</Link></div><dl className="job-detail-facts"><div><dt>Job balance</dt><dd className={billing.balance < 0 ? 'money-neg' : 'money-pos'}>{fmtSigned(billing.balance)}</dd></div><div><dt>Deposits received</dt><dd>{fmtMoney(billing.deposits)}</dd></div><div><dt>Invoiced</dt><dd>{fmtMoney(billing.invoiced)}</dd></div><div><dt>Awaiting payment</dt><dd>{fmtMoney(billing.outstanding)}</dd></div></dl><p className="tiny muted">Balance = deposits + invoices − all work and charges.</p><WorkStatusBar b={billing} compact /><Link className="job-aside-link" to={`/billing?job=${id}`}>Review hours, charges &amp; payments →</Link></section>
          {section === 'work' && operational && <section className="card"><h2>Upcoming dates</h2>{model.deadlines.length ? <ul className="job-context-list">{model.deadlines.slice(0, 5).map(date => <li key={date.id}><div>{date.kind === 'task' || date.kind === 'site_visit' ? <Link to={date.link}>{date.title}</Link> : <span>{date.title}</span>}<div className="tiny muted">{date.time ? fmtDateTime(date.time) : fmtDate(date.date, 'long')}</div></div><DueBadge date={date.date} /></li>)}</ul> : <p className="small muted">No pending dates for this job.</p>}{model.deadlines.length > 5 && <p className="tiny muted">Showing the next 5 dates, including overdue work.</p>}</section>}
          {section === 'work' && <section className="card"><h2>{operational ? 'Planned work' : 'Saved plans'}</h2><p className="small muted">{fmtHours(model.upcomingPlannedHours)} saved from today forward{model.historyUpcomingPlannedHours > 0 ? ` · ${fmtHours(model.historyUpcomingPlannedHours)} from planning history` : ''}{!operational ? ' · outside active capacity' : ''}.</p>{model.upcomingPlans.length ? <ul className="job-context-list">{model.upcomingPlans.slice(0, 4).map(({ entry, phaseName: name, isOwner }) => <li key={entry.id}><div><b>{fmtDate(entry.date)}</b><div className="tiny muted">{name}{!isOwner ? ' · additional saved plan' : ''}</div></div><span className="nowrap">{fmtHours(entry.hours)}</span></li>)}</ul> : <p className="small muted">No upcoming hours planned.</p>}<Link className="job-aside-link" to={timelineLink}>Open timeline →</Link></section>}
          <section className="card job-project-details"><div className="job-section-heading"><h2>Project details</h2><button className="btn ghost" aria-label="Edit project details" onClick={() => setEditingJob(job)}><Icon name="edit" size={15} /></button></div>{job.description && <p className="small job-description">{job.description}</p>}<dl className="job-detail-facts"><div><dt>Job number</dt><dd>{job.job_number || 'Not set'}</dd></div><div><dt>Priority</dt><dd>{job.priority}</dd></div><div><dt>Start date</dt><dd>{job.start_date ? fmtDate(job.start_date, 'long') : 'Not set'}</dd></div><div><dt>Job due date</dt><dd>{job.due_date ? fmtDate(job.due_date, 'long') : 'Not set'}</dd></div>{job.fee != null && <div><dt>Agreed fee</dt><dd>{fmtMoney(job.fee)}</dd></div>}</dl>{client && <div className="job-client-contact"><Link className="bold" to={`/clients/${client.id}`}>{client.name}</Link>{client.contact_name && <div className="small">{client.contact_name}</div>}{client.phone && <a href={`tel:${client.phone}`}>{client.phone}</a>}{client.email && <a href={`mailto:${client.email}`}>{client.email}</a>}</div>}</section>
        </aside>
      </div>

      {deposit && <DepositModal jobId={id} onClose={() => setDeposit(false)} />}
      {itemModal && <ItemModal item={itemModal.item} jobId={id} onClose={() => setItemModal(null)} />}
      {taskModal && <TaskModal task={taskModal.task} defaults={{ job_id: id, phase_id: taskModal.phaseId ?? null }} onClose={() => setTaskModal(null)} />}
      {timeModal && <TimeModal entry={timeModal.entry} defaults={{ job_id: id, phase_id: timeModal.phaseId ?? null, task_id: timeModal.taskId ?? null }} onClose={() => setTimeModal(null)} />}
    </div>{jobEditor}</>
  )
}
