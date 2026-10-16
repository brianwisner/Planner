// One job: its phases (estimate, due date, status, assignee), the tasks in
// each phase, hours logged, billing summary and the comment thread.
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { entryHours, hoursForPhase, jobBilling, jobHours, timerHours } from '../lib/calc'
import { StatusBadge } from './Billing'
import type { Phase, Task } from '../lib/types'
import { fmtDate, fmtDateTime, fmtHours, fmtMoney, fmtSigned, sum } from '../lib/utils'
import { Avatar, Checkbox, DueBadge, Empty, Icon, JobStatusBadge, Person, PersonSelect, PhaseStatusSelect, Progress } from '../components/ui'
import { DepositModal, JobModal, TaskModal, TimeModal, toggleTaskDone } from '../components/editors'

export function JobDetail() {
  const { id } = useParams()
  const store = useData()
  const { jobs, clients, phases, tasks, timeEntries, comments, profiles, me, update, insert, remove } = store
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const job = jobs.find(j => j.id === id)
  const [editJob, setEditJob] = useState(false)
  const [taskModal, setTaskModal] = useState<{ task?: Task; phaseId?: string | null } | null>(null)
  const [timeModal, setTimeModal] = useState<{ phaseId?: string | null; taskId?: string | null } | null>(null)
  const [comment, setComment] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [deposit, setDeposit] = useState(false)

  // Deep link: /jobs/:id?task=... opens that task.
  useEffect(() => {
    const t = params.get('task')
    if (t) { const task = tasks.find(x => x.id === t); if (task) setTaskModal({ task }); setParams(p => { p.delete('task'); return p }, { replace: true }) }
  }, [params, tasks, setParams])

  const billing = useMemo(() => job ? jobBilling(store, job) : null, [store, job])
  const hourMap = useMemo(() => new Map(id ? jobHours(store, id).map(h => [h.entry.id, h]) : []), [store, id])
  if (!job) return <div className="card"><Empty>Job not found. <Link to="/jobs">Back to jobs</Link></Empty></div>
  const client = clients.find(c => c.id === job.client_id)
  const jobPhases = phases.filter(p => p.job_id === job.id)
  const jobTasks = tasks.filter(t => t.job_id === job.id)
  const jobEntries = timeEntries.filter(e => e.job_id === job.id)
  const est = sum(jobPhases.map(p => p.estimate_hours))
  const logged = sum(jobEntries.map(entryHours))
  const running = jobEntries.find(e => e.started_at && e.hours == null && e.user_id === me?.id)

  async function startTimer(phaseId: string | null, taskId: string | null) {
    if (!me) return
    const other = timeEntries.find(e => e.user_id === me.id && e.started_at && e.hours == null)
    if (other) await update('time_entries', other.id, { hours: timerHours(other), started_at: null })
    await insert('time_entries', { job_id: job!.id, phase_id: phaseId, task_id: taskId, user_id: me.id, started_at: new Date().toISOString(), hours: null })
  }
  async function stopTimer() {
    if (!running) return
    await update('time_entries', running.id, { hours: timerHours(running), started_at: null })
  }
  async function addComment() {
    if (!comment.trim()) return
    await insert('comments', { job_id: job!.id, user_id: me?.id ?? null, body: comment.trim() })
    setComment('')
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="small muted"><Link to="/jobs">Jobs</Link> › {client && <Link to={`/clients/${client.id}`}>{client.name}</Link>}</div>
          <h1>{job.job_number && <span className="muted">{job.job_number} · </span>}{job.name} <JobStatusBadge status={job.status} /></h1>
          {job.address && <div className="small muted"><Icon name="pin" size={12} /> {job.address}</div>}
        </div>
        <div className="actions">
          {running ? <button className="btn" onClick={stopTimer}><Icon name="stop" size={14} /> Stop timer</button> : <button className="btn" onClick={() => startTimer(jobPhases.find(p => p.status === 'in_progress')?.id ?? jobPhases[0]?.id ?? null, null)}><Icon name="play" size={14} /> Start timer</button>}
          <button className="btn" onClick={() => setTimeModal({})}><Icon name="time" size={14} /> Log hours</button>
          <button className="btn" onClick={() => setDeposit(true)}><Icon name="plus" size={14} /> Deposit</button>
          <button className="btn" onClick={() => setEditJob(true)}><Icon name="edit" size={14} /> Edit</button>
        </div>
      </div>

      <div className="stats mb">
        <div className="stat"><div className="label">Hours</div><div className="value">{fmtHours(logged)}<span className="muted" style={{ fontSize: 14 }}> / {fmtHours(est)}</span></div><Progress value={logged} max={est} /></div>
        <div className="stat"><div className="label">Due</div><div className="value" style={{ fontSize: 20 }}>{job.due_date ? fmtDate(job.due_date) : '–'}</div><div className="sub"><DueBadge date={job.due_date} done={job.status === 'complete'} /></div></div>
        <div className="stat"><div className="label">Job balance</div><div className={`value ${billing && billing.balance < 0 ? 'money-neg' : 'money-pos'}`} style={{ fontSize: 20 }}>{billing && fmtSigned(billing.balance)}</div><div className="sub">{billing && `${fmtMoney(billing.deposits)} deposits · ${fmtMoney(billing.invoiced)} billed`}</div></div>
        <div className="stat"><div className="label">Not billed yet</div><div className={`value ${billing && billing.unbilledAmount > 0.5 ? 'danger-text' : ''}`} style={{ fontSize: 20 }}>{billing && fmtMoney(billing.unbilledAmount)}</div><div className="sub">{billing && `${fmtHours(billing.unbilledHours)} · `}<Link to={`/billing?job=${job.id}`}>money details →</Link></div></div>
      </div>

      <div className="grid job-grid">
        <div>
          {job.description && <div className="card"><p style={{ whiteSpace: 'pre-wrap' }}>{job.description}</p></div>}
          <div className="row mb" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Phases</h3>
            <label className="chip" style={{ margin: 0 }}><input type="checkbox" style={{ width: 16, minHeight: 0, margin: 0 }} checked={showDone} onChange={e => setShowDone(e.target.checked)} /> show done tasks</label>
          </div>
          {jobPhases.map(p => (
            <PhaseCard key={p.id} phase={p} tasks={jobTasks.filter(t => t.phase_id === p.id && (showDone || t.status !== 'done'))} logged={hoursForPhase(timeEntries, p.id)}
              onAddTask={() => setTaskModal({ phaseId: p.id })} onEditTask={t => setTaskModal({ task: t })} onLog={() => setTimeModal({ phaseId: p.id })} onStart={() => startTimer(p.id, null)} />
          ))}
          <GeneralTasks tasks={jobTasks.filter(t => !t.phase_id && (showDone || t.status !== 'done'))} onAdd={() => setTaskModal({ phaseId: null })} onEdit={t => setTaskModal({ task: t })} />
        </div>

        <div>
          <div className="card">
            <h2>Notes &amp; comments</h2>
            {comments.filter(c => c.job_id === job.id).length === 0 && <p className="small muted">No notes yet.</p>}
            {comments.filter(c => c.job_id === job.id).map(c => (
              <div className="comment" key={c.id}>
                <Avatar userId={c.user_id} size="sm" />
                <div className="body">
                  <div className="who">{profiles.find(p => p.id === c.user_id)?.full_name ?? 'Someone'} · {fmtDateTime(c.created_at)}{c.user_id === me?.id && <> · <a href="#" onClick={e => { e.preventDefault(); if (confirm('Delete this note?')) void remove('comments', c.id) }}>delete</a></>}</div>
                  {c.body}
                </div>
              </div>
            ))}
            <div className="mt">
              <textarea placeholder="Add a note… (Ctrl+Enter to post)" value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void addComment() }} />
              <div className="row mt" style={{ justifyContent: 'flex-end' }}><button className="btn primary sm" onClick={addComment} disabled={!comment.trim()}>Post note</button></div>
            </div>
          </div>

          <div className="card">
            <h2>Hours on this job <span className="actions"><button className="btn sm" onClick={() => setTimeModal({})}>+ Log</button></span></h2>
            {jobEntries.length === 0 && <p className="small muted">No hours logged yet.</p>}
            <div className="table-wrap">
              <table>
                <tbody>
                  {jobEntries.slice(0, 12).map(e => (
                    <tr key={e.id} className="clickable" onClick={() => nav(`/time?entry=${e.id}`)}>
                      <td className="nowrap small">{fmtDate(e.date)}</td>
                      <td><Person userId={e.user_id} hideName /></td>
                      <td className="small">{phases.find(p => p.id === e.phase_id)?.name ?? 'General'}{e.notes && <div className="tiny muted">{e.notes}</div>}</td>
                      <td className="num nowrap">{e.started_at && e.hours == null ? <span className="timer-pill"><span className="dot" />running</span> : fmtHours(e.hours)}</td>
                      <td>{hourMap.get(e.id) && <StatusBadge h={hourMap.get(e.id)!} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {jobEntries.length > 12 && <p className="small mt"><Link to={`/time?job=${job.id}`}>All {jobEntries.length} entries →</Link></p>}
          </div>

          {client && (
            <div className="card">
              <h2>Client</h2>
              <div className="bold"><Link to={`/clients/${client.id}`}>{client.name}</Link></div>
              {client.contact_name && <div className="small">{client.contact_name}</div>}
              {client.phone && <div className="small"><a href={`tel:${client.phone}`}>{client.phone}</a></div>}
              {client.email && <div className="small"><a href={`mailto:${client.email}`}>{client.email}</a></div>}
            </div>
          )}
        </div>
      </div>

      {editJob && <JobModal job={job} onClose={() => setEditJob(false)} />}
      {deposit && <DepositModal jobId={job.id} onClose={() => setDeposit(false)} />}
      {taskModal && <TaskModal task={taskModal.task} defaults={{ job_id: job.id, phase_id: taskModal.phaseId ?? null }} onClose={() => setTaskModal(null)} />}
      {timeModal && <TimeModal defaults={{ job_id: job.id, phase_id: timeModal.phaseId ?? null, task_id: timeModal.taskId ?? null }} onClose={() => setTimeModal(null)} />}
    </div>
  )
}

function PhaseCard({ phase, tasks, logged, onAddTask, onEditTask, onLog, onStart }: { phase: Phase; tasks: Task[]; logged: number; onAddTask: () => void; onEditTask: (t: Task) => void; onLog: () => void; onStart: () => void }) {
  const store = useData()
  const { update } = store
  const [notes, setNotes] = useState(phase.notes)
  useEffect(() => setNotes(phase.notes), [phase.notes])
  return (
    <div className="phase-card">
      <div className="phase-head">
        <h2>{phase.name}</h2>
        <PhaseStatusSelect value={phase.status} onChange={s => update('phases', phase.id, { status: s })} />
        <div className="inline-edit"><PersonSelect value={phase.assignee_id} onChange={v => update('phases', phase.id, { assignee_id: v })} /></div>
      </div>
      <div className="phase-meta">
        <span className="inline-edit">Est. <input type="number" step="1" min="0" style={{ width: 70 }} value={phase.estimate_hours} onChange={e => update('phases', phase.id, { estimate_hours: Number(e.target.value) || 0 })} /> h</span>
        <span className="inline-edit">Start <input type="date" value={phase.start_date ?? ''} onChange={e => update('phases', phase.id, { start_date: e.target.value || null })} /></span>
        <span className="inline-edit">Due <input type="date" value={phase.due_date ?? ''} onChange={e => update('phases', phase.id, { due_date: e.target.value || null })} /> <DueBadge date={phase.due_date} done={phase.status === 'complete'} /></span>
        <span className="grow" />
        <span className="nowrap"><b>{fmtHours(logged)}</b> of {fmtHours(phase.estimate_hours)} {phase.estimate_hours > 0 && <span className={logged > phase.estimate_hours ? 'danger-text' : 'muted'}>({Math.round(logged / phase.estimate_hours * 100)}%)</span>}</span>
      </div>
      <div style={{ margin: '8px 0' }}><Progress value={logged} max={phase.estimate_hours} /></div>
      <div className="tasks">
        <ul className="list">
          {tasks.map(t => (
            <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
              <Checkbox on={t.status === 'done'} onToggle={() => void toggleTaskDone(store, t)} />
              <div className="title">
                <a href="#" onClick={e => { e.preventDefault(); onEditTask(t) }}>{t.is_site_visit && <span className="badge site" style={{ marginRight: 6 }}>Site visit</span>}{t.title}</a>
                <div className="meta">{t.scheduled_at ? fmtDateTime(t.scheduled_at) : ''}{t.estimate_hours ? ` · ${fmtHours(t.estimate_hours)} est` : ''}{t.recurrence !== 'none' ? ' · repeats' : ''}</div>
              </div>
              <span className={`badge ${t.status}`}>{t.status === 'doing' ? 'In progress' : t.status === 'waiting' ? 'Waiting' : t.status === 'done' ? 'Done' : 'To do'}</span>
              <Person userId={t.assignee_id} hideName />
              <DueBadge date={t.due_date} done={t.status === 'done'} />
            </li>
          ))}
        </ul>
        <div className="row mt" style={{ gap: 6 }}>
          <button className="btn sm" onClick={onAddTask}><Icon name="plus" size={14} /> Task</button>
          <button className="btn sm ghost" onClick={onLog}><Icon name="time" size={14} /> Log hours</button>
          <button className="btn sm ghost" onClick={onStart}><Icon name="play" size={12} /> Timer</button>
          <input className="grow" placeholder="Phase notes…" value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => { if (notes !== phase.notes) void update('phases', phase.id, { notes }) }} style={{ minHeight: 32, padding: '4px 8px', fontSize: 13, minWidth: 140 }} />
        </div>
      </div>
    </div>
  )
}

function GeneralTasks({ tasks, onAdd, onEdit }: { tasks: Task[]; onAdd: () => void; onEdit: (t: Task) => void }) {
  const store = useData()
  return (
    <div className="phase-card">
      <div className="phase-head"><h2 className="muted">General tasks (no phase)</h2><button className="btn sm" onClick={onAdd}><Icon name="plus" size={14} /> Task</button></div>
      {tasks.length === 0 && <p className="small muted" style={{ margin: '6px 0 0' }}>Admin, check-in calls, anything that is not part of a phase.</p>}
      <ul className="list">
        {tasks.map(t => (
          <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
            <Checkbox on={t.status === 'done'} onToggle={() => void toggleTaskDone(store, t)} />
            <div className="title"><a href="#" onClick={e => { e.preventDefault(); onEdit(t) }}>{t.title}</a>{t.recurrence !== 'none' && <div className="meta">repeats</div>}</div>
            <Person userId={t.assignee_id} hideName />
            <DueBadge date={t.due_date} done={t.status === 'done'} />
          </li>
        ))}
      </ul>
    </div>
  )
}
