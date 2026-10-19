import { useId, useRef, useState } from 'react'
import { format } from 'date-fns'
import { entryHours, workPhase } from '../lib/calc'
import { jobPhaseGroups, phaseLabel } from '../lib/phases'
import { useData } from '../lib/store'
import { toggleTaskDone } from '../lib/taskActions'
import type { Job, Phase, PhaseStatus, Task, TimeEntry } from '../lib/types'
import { PHASE_STATUS_LABEL, RECURRENCE_LABEL, TASK_STATUS_LABEL } from '../lib/types'
import { fmtDate, fmtDateTime, fmtHours, sum } from '../lib/utils'
import { DueBadge, Icon, Modal, Progress } from './ui'

export interface JobWorkProps {
  job: Job
  phases: Phase[]
  tasks: Task[]
  timeEntries: TimeEntry[]
  currentPhaseId?: string
  operational: boolean
  timerBillable: boolean
  timerBusy?: boolean
  onAddTask: (phaseId: string | null) => void
  onEditTask: (task: Task) => void
  onLog: (phaseId: string | null, taskId?: string | null) => void
  onStart: (phaseId: string | null, taskId?: string | null) => void
}

type TaskFilter = 'open' | 'all' | 'waiting' | 'done'
const taskOrder = (a: Task, b: Task) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/** A fresh job gets its own disclosure state and unsaved search/filter choices. */
export function JobWork(props: JobWorkProps) {
  return <WorkContents key={props.job.id} {...props} />
}

function WorkContents(props: JobWorkProps) {
  const { job, operational, timerBillable, timerBusy, onAddTask, onEditTask, onLog, onStart } = props
  const id = useId()
  const { schedule } = useData()
  const { all: allPhases, workflow: phases, history } = jobPhaseGroups(props.phases, job.id)
  const allPhaseIds = new Set(allPhases.map(phase => phase.id))
  const phaseIds = new Set(phases.map(phase => phase.id))
  const tasks = props.tasks.filter(task => task.job_id === job.id).sort(taskOrder)
  const entries = props.timeEntries.filter(entry => entry.job_id === job.id)
  const currentPhaseId = props.currentPhaseId && phaseIds.has(props.currentPhaseId) ? props.currentPhaseId : workPhase(phases, job.id)?.id
  const general = tasks.filter(task => !task.phase_id || !phaseIds.has(task.phase_id))
  const [expanded, setExpanded] = useState(() => new Set([currentPhaseId ?? '', ...(general.some(task => task.status !== 'done') ? ['general'] : [])]))
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TaskFilter>('open')
  const [filteredCollapsed, setFilteredCollapsed] = useState(() => new Set<string>())
  const [editPhase, setEditPhase] = useState<Phase | null>(null)
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const filtering = words.length > 0 || filter !== 'open'
  const matches = (task: Task) => (filter === 'all' || (filter === 'open' ? task.status !== 'done' : task.status === filter)) && words.every(word => `${task.title} ${task.description}`.toLowerCase().includes(word))
  const matched = tasks.filter(matches)
  const openCount = tasks.filter(task => task.status !== 'done').length
  const doneCount = tasks.length - openCount

  function toggle(key: string, matchedGroup: boolean) {
    const setter = matchedGroup ? setFilteredCollapsed : setExpanded
    setter(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }

  function group(phase: Phase | null) {
    const key = phase?.id ?? 'general'
    const all = phase ? tasks.filter(task => task.phase_id === phase.id) : general
    const shown = all.filter(matches)
    const done = all.filter(task => task.status === 'done').length
    const waiting = all.filter(task => task.status === 'waiting').length
    const logged = phase ? sum(entries.filter(entry => entry.phase_id === phase.id).map(entryHours)) : sum(entries.filter(entry => !entry.phase_id || !allPhaseIds.has(entry.phase_id)).map(entryHours))
    const nonbillable = sum(entries.filter(entry => (phase ? entry.phase_id === phase.id : !entry.phase_id || !allPhaseIds.has(entry.phase_id)) && entry.billable === false && entry.hours != null).map(entryHours))
    const over = phase && phase.status !== 'complete' && phase.estimate_hours > 0 && logged > phase.estimate_hours
    const matchedGroup = filtering && shown.length > 0
    const isOpen = matchedGroup ? !filteredCollapsed.has(key) : expanded.has(key)
    const title = phase ? phaseLabel(phase) : 'General tasks'
    const bodyId = `${id}-${key}`
    return <section className={`phase-card job-phase-card ${phase?.id === currentPhaseId ? 'is-current' : ''}`} key={key} aria-label={title}>
      <div className="job-phase-header">
        <button type="button" className="job-phase-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => toggle(key, matchedGroup)}>
          <Icon name="chevronR" size={15} />
          <span className="job-phase-heading"><span className="bold">{title}</span><span className="job-phase-summary">{done} / {all.length} tasks done · {fmtHours(logged)}{phase ? ` / ${fmtHours(phase.estimate_hours)} worked` : ' worked'}</span></span>
        </button>
        <div className="job-phase-flags">
          {phase && <span className={`badge ${phase.status}`}>{PHASE_STATUS_LABEL[phase.status]}</span>}
          {phase?.id === currentPhaseId && operational && <span className="badge info">Current work</span>}
          {operational && (phase?.status === 'waiting' || waiting > 0) && <span className="badge waiting">{waiting > 0 ? `${waiting} waiting task${waiting === 1 ? '' : 's'}` : 'Waiting phase'}</span>}
          {operational && over && <span className="badge warn">Over estimate by {fmtHours(logged - phase!.estimate_hours)}</span>}
        </div>
        {phase && <button type="button" className="btn sm ghost" aria-label={`Edit phase: ${title}`} onClick={() => setEditPhase(phase)}><Icon name="edit" size={13} /> Edit</button>}
      </div>
      <div id={bodyId} className="job-phase-body" hidden={!isOpen}>
        <div className="job-phase-dates small muted">
          {phase?.start_date && <span>Start {fmtDate(phase.start_date)}</span>}
          {phase?.due_date && <span>{operational ? <><span>Due {fmtDate(phase.due_date)} </span><DueBadge date={phase.due_date} done={phase.status === 'complete'} /></> : `Recorded due ${fmtDate(phase.due_date)}`}</span>}
          {nonbillable > 0 && <span>{fmtHours(nonbillable)} nonbillable</span>}
        </div>
        {phase && phase.estimate_hours > 0 && <Progress value={logged} max={phase.estimate_hours} />}
        {phase?.notes && <p className="job-phase-notes small">{phase.notes}</p>}
        {!phase && <p className="small muted">Admin, calls and other work outside a phase. Tasks from planning history or an unavailable phase remain here.</p>}
        {shown.length > 0 ? <ul className="list job-task-list">{shown.map(task => <TaskRow key={task.id} task={task} savedPhaseLabel={!phase && task.phase_id ? history.some(phase => phase.id === task.phase_id) ? 'Planning history' : 'Unavailable phase' : undefined} operational={operational} timerBillable={timerBillable} timerBusy={timerBusy} onEdit={() => onEditTask(task)} onLog={() => onLog(task.phase_id && phaseIds.has(task.phase_id) ? task.phase_id : null, task.id)} onStart={() => onStart(task.phase_id && phaseIds.has(task.phase_id) ? task.phase_id : null, task.id)} />)}</ul> : <p className="job-task-empty small muted">{all.length === 0 ? 'No tasks yet.' : filtering ? 'No tasks match these filters.' : 'No open tasks. Choose All or Done to see completed work.'}</p>}
        <div className="job-phase-actions">
          <button type="button" className="btn sm" aria-label={`Add task to ${title}`} onClick={() => onAddTask(phase?.id ?? null)}><Icon name="plus" size={13} /> Task</button>
          <button type="button" className="btn sm ghost" aria-label={`Log hours for ${title}`} onClick={() => onLog(phase?.id ?? null)}><Icon name="time" size={13} /> Log hours</button>
          {operational && <button type="button" className="btn sm ghost" aria-label={`Start ${timerBillable ? 'billable' : 'nonbillable'} timer for ${title}`} disabled={timerBusy} onClick={() => onStart(phase?.id ?? null)}><Icon name="play" size={12} /> Timer{timerBillable ? '' : ' · nonbillable'}</button>}
        </div>
      </div>
    </section>
  }

  return <section className="job-work" aria-labelledby={`${id}-heading`}>
    <div className="job-work-toolbar"><div><h2 id={`${id}-heading`}>Phases &amp; tasks</h2><p className="small muted">{openCount} open · {doneCount} done</p></div><div className="job-work-filters">
      <label>Search tasks<input type="search" aria-label="Search tasks" placeholder="Find a task…" value={search} onChange={event => { setSearch(event.target.value); setFilteredCollapsed(new Set()) }} /></label>
      <label>Task status<select aria-label="Task status" value={filter} onChange={event => { setFilter(event.target.value as TaskFilter); setFilteredCollapsed(new Set()) }}><option value="open">Open</option><option value="all">All</option><option value="waiting">Waiting</option><option value="done">Done</option></select></label>
    </div></div>
    {filtering && <p className="small muted job-work-results" role="status">{matched.length} matching task{matched.length === 1 ? '' : 's'}<button type="button" className="btn sm ghost" onClick={() => { setSearch(''); setFilter('open'); setFilteredCollapsed(new Set()) }}>Clear filters</button></p>}
    {phases.length === 0 && <p className="small muted">No phases are set up for this job. Its tasks and time remain available below.</p>}
    {phases.map(group)}
    {group(null)}
    {history.map(phase => {
      const recorded = entries.filter(entry => entry.phase_id === phase.id)
      const plans = schedule.filter(entry => entry.job_id === job.id && entry.phase_id === phase.id)
      const savedTasks = tasks.filter(task => task.phase_id === phase.id)
      if (!phase.notes && !phase.estimate_hours && !phase.start_date && !phase.due_date && !recorded.length && !plans.length && !savedTasks.length) return null
      return <details className="job-planning-history" key={phase.id}><summary>Planning history · {fmtHours(sum(recorded.map(entryHours)))} worked</summary><div className="small muted"><p>Saved planning records remain part of this job. Their hours and billing are included in the job totals.</p>{phase.estimate_hours > 0 && <p>Recorded estimate: {fmtHours(phase.estimate_hours)}</p>}{phase.start_date && <p>Recorded start: {fmtDate(phase.start_date)}</p>}{phase.due_date && <p>Recorded due: {fmtDate(phase.due_date)}</p>}{phase.notes && <p className="job-phase-notes">{phase.notes}</p>}{savedTasks.length > 0 && <p>{savedTasks.length} saved task{savedTasks.length === 1 ? '' : 's'} available under General tasks.</p>}{plans.length > 0 && <p>{fmtHours(sum(plans.map(entry => entry.hours)))} saved plans remain on the timeline.</p>}{recorded.some(entry => entry.billable === false && entry.hours != null) && <p>{fmtHours(sum(recorded.filter(entry => entry.billable === false && entry.hours != null).map(entryHours)))} nonbillable</p>}</div></details>
    })}
    {editPhase && <PhaseEditor phase={editPhase} onClose={() => setEditPhase(null)} />}
  </section>
}

function TaskRow({ task, savedPhaseLabel, operational, timerBillable, timerBusy, onEdit, onLog, onStart }: { task: Task; savedPhaseLabel?: string; operational: boolean; timerBillable: boolean; timerBusy?: boolean; onEdit: () => void; onLog: () => void; onStart: () => void }) {
  const store = useData()
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function toggle() {
    if (busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const result = await toggleTaskDone(store, task)
      if (!result.success) setError(result.task ? 'Completion saved; open the task and save again to retry its next occurrence.' : 'Task completion could not be saved. Try again.')
    } catch { setError('Task completion could not be saved. Try again.') }
    finally { busy.current = false; setSaving(false) }
  }
  const date = task.scheduled_at ? format(new Date(task.scheduled_at), 'yyyy-MM-dd') : task.due_date
  return <li className={`job-task-row ${task.status === 'done' ? 'done' : ''}`}>
    <button type="button" className={`check ${task.status === 'done' ? 'on' : ''}`} disabled={saving} aria-busy={saving} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => void toggle()}>{task.status === 'done' && <Icon name="check" size={14} />}</button>
    <div className="title">
      <button type="button" className="job-task-edit" aria-label={`Edit task: ${task.title}`} onClick={onEdit}>{task.title}</button>
      <div className="meta job-task-meta">
        {task.is_site_visit && <span className="badge site">Site visit</span>}
        {task.scheduled_at ? <span>{fmtDateTime(task.scheduled_at)}</span> : task.due_date && <span>{operational ? 'Due' : 'Recorded due'} {fmtDate(task.due_date)}</span>}
        {task.estimate_hours != null && <span>{fmtHours(task.estimate_hours)} estimate</span>}
        {task.recurrence !== 'none' && <span>{RECURRENCE_LABEL[task.recurrence]}</span>}
        {savedPhaseLabel && <span>{savedPhaseLabel}</span>}
      </div>
      {error && <p className="small danger-text" role="alert">{error}</p>}
    </div>
    <div className="job-task-status"><span className={`badge ${task.status}`}>{TASK_STATUS_LABEL[task.status]}</span>{operational && date && <DueBadge date={date} done={task.status === 'done'} />}</div>
    <div className="job-task-actions"><button type="button" className="btn sm ghost icon" aria-label={`Log hours for task: ${task.title}`} title="Log hours" onClick={onLog}><Icon name="time" size={14} /></button>{operational && task.status !== 'done' && <button type="button" className="btn sm ghost icon" aria-label={`Start ${timerBillable ? 'billable' : 'nonbillable'} timer for task: ${task.title}`} title={`Start ${timerBillable ? 'billable' : 'nonbillable'} timer`} disabled={timerBusy} onClick={onStart}><Icon name="play" size={12} /></button>}</div>
  </li>
}

function PhaseEditor({ phase, onClose }: { phase: Phase; onClose: () => void }) {
  const { update } = useData()
  const formId = useId()
  const estimateInput = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [estimate, setEstimate] = useState(String(phase.estimate_hours))
  const [start, setStart] = useState(phase.start_date ?? '')
  const [due, setDue] = useState(phase.due_date ?? '')
  const [status, setStatus] = useState(phase.status)
  const [notes, setNotes] = useState(phase.notes)
  const [error, setError] = useState('')
  const close = () => { if (!busy.current) onClose() }
  async function save() {
    if (busy.current) return
    const hours = Number(estimate)
    if (!estimate.trim() || estimateInput.current?.validity.badInput || !Number.isFinite(hours) || hours < 0) { setError('Enter an estimate of zero hours or more.'); return }
    if (start && due && start > due) { setError('The due date must be on or after the start date.'); return }
    busy.current = true; setSaving(true); setError('')
    try {
      const phaseSaved = await update('phases', phase.id, { estimate_hours: hours, start_date: start || null, due_date: due || null, status, notes })
      if (!phaseSaved) { setError('The phase could not be saved. Your changes are still here; try again.'); return }
      onClose()
    } catch {
      setError('The phase could not be saved. Your changes are still here; try again.')
    }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title="Edit phase" className="job-phase-editor" onClose={close} footer={<><button type="button" className="btn" disabled={saving} onClick={close}>Cancel</button><button type="submit" form={formId} className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save phase'}</button></>}>
    <form id={formId} noValidate onSubmit={event => { event.preventDefault(); void save() }}>
      <p className="bold">{phase.name}</p>
      {error && <p className="danger-text small" role="alert">{error}</p>}
      <div className="row"><label className="field">Status<select aria-label="Phase status" disabled={saving} value={status} onChange={event => setStatus(event.target.value as PhaseStatus)}>{Object.entries(PHASE_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field">Estimate (hours)<input ref={estimateInput} aria-label="Estimate (hours)" type="number" min="0" step="any" value={estimate} disabled={saving} onChange={event => setEstimate(event.target.value)} /></label></div>
      <div className="row"><label className="field">Start date<input aria-label="Phase start date" type="date" value={start} disabled={saving} onChange={event => setStart(event.target.value)} /></label><label className="field">Due date<input aria-label="Phase due date" type="date" value={due} disabled={saving} onChange={event => setDue(event.target.value)} /></label></div>
      <label className="field">Notes<textarea aria-label="Phase notes" rows={4} value={notes} disabled={saving} onChange={event => setNotes(event.target.value)} /></label>
      <p className="small muted">Changes save together when you choose Save phase.</p>
    </form>
  </Modal>
}
