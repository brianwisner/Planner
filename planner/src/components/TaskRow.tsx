// One task in a list: tick it off, open it, or start a timer on it.
import { Clock3, MapPin, Play, Repeat } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import type { Task } from '../lib/types'
import { setTaskStatus, toggleTaskDone } from '../lib/taskActions'
import { startTimer } from '../lib/timer'
import { DueText, TaskCheck } from './ui'
import { useEditors } from './editors'
import './rows.css'

export function TaskRow({ task, showJob = true, compact }: { task: Task; showJob?: boolean; compact?: boolean }) {
  const store = useData()
  const edit = useEditors()
  const job = store.jobs.find(j => j.id === task.job_id)
  const client = store.clients.find(c => c.id === job?.client_id)
  const phase = store.phases.find(p => p.id === task.phase_id)
  const done = task.status === 'done'
  async function toggle() {
    const before = task.status
    const result = await toggleTaskDone(store, task)
    if (result.success && before !== 'done') store.toast(`Done: ${task.title}`, 'ok', { label: 'Undo', run: () => setTaskStatus(store, { ...task, status: 'done' }, before) })
  }
  const time = task.scheduled_at ? new Date(task.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null
  return <div className={`task-row ${done ? 'is-done' : ''} ${compact ? 'compact' : ''}`} onClick={() => edit.task(task)}>
    <TaskCheck done={done} onToggle={toggle} label={task.title} />
    <div className="task-main">
      <div className="task-title">
        {task.is_site_visit && <span className="badge visit"><MapPin size={12} />Site visit{time ? ` · ${time}` : ''}</span>}
        <button type="button" className="task-open" onClick={e => { e.stopPropagation(); edit.task(task) }}>{task.title}</button>
        {task.status === 'doing' && <span className="badge accent">Doing</span>}
        {task.status === 'waiting' && <span className="badge warn">Waiting</span>}
        {task.recurrence !== 'none' && <Repeat size={13} className="muted" aria-label="Repeats" />}
      </div>
      {(showJob || phase || task.estimate_hours) && <div className="task-meta">
        {showJob && job && <Link to={`/jobs/${job.id}`} onClick={e => e.stopPropagation()}>{job.name}</Link>}
        {showJob && client && <span>{client.name}</span>}
        {!showJob && phase && <span>{phase.name}</span>}
        {task.estimate_hours ? <span className="row" style={{ gap: 3, display: 'inline-flex' }}><Clock3 size={12} />{task.estimate_hours}h</span> : null}
      </div>}
    </div>
    <div className="task-side">
      <DueText date={task.due_date} done={done} />
      {!done && job?.status === 'active' && <button className="btn ghost icon xs row-action" title="Start timer on this task" aria-label={`Start timer on ${task.title}`} onClick={e => { e.stopPropagation(); void startTimer(store, { job_id: task.job_id, phase_id: task.phase_id, task_id: task.id }) }}><Play size={14} /></button>}
    </div>
  </div>
}
