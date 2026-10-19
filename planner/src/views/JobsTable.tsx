// Compact job overview with an optional week of planned hours. Worked time and
// saved plans stay separate; historical ownership is preserved when editing.
import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, addWeeks, format, isWeekend, startOfWeek } from 'date-fns'
import { Link } from 'react-router-dom'
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useData } from '../lib/store'
import { jobRows, type JobOverview } from '../lib/jobs'
import type { Job, ScheduleEntry } from '../lib/types'
import { PHASE_KIND_SHORT } from '../lib/types'
import { downloadCSV, fmtDate, fmtHourlyRate, fmtHours, fmtMoney, sum, todayISO } from '../lib/utils'
import './JobsTable.css'
import { ScheduleModal } from '../components/ScheduleModal'
import { DueBadge, Empty, Icon, JobStatusSelect } from '../components/ui'

type SortKey = 'priority' | 'name' | 'client' | 'due'
type Props = {
  jobs: Job[]
  showExport?: boolean
  schedulable?: boolean
  allowReorder?: boolean
  onLogHours?: (jobId: string) => void
  onAddTask?: (jobId: string) => void
}

function readPref(key: string, fallback: boolean) {
  try { const value = localStorage.getItem(key); return value == null ? fallback : value === '1' } catch { return fallback }
}
function writePref(key: string, value: boolean) {
  try { localStorage.setItem(key, value ? '1' : '0') } catch { /* storage unavailable */ }
}
const round2 = (n: number) => Math.round(n * 100) / 100

export function JobsTable({ jobs, showExport = true, schedulable = false, allowReorder = false, onLogHours, onAddTask }: Props) {
  const store = useData()
  const { schedule, me, settings, update, refresh, toast } = store
  const [plan, setPlan] = useState(() => readPref('table-plan', false))
  const [weekends, setWeekends] = useState(() => readPref('table-plan-weekends', false))
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [sort, setSort] = useState<SortKey>('priority')
  const [asc, setAsc] = useState(true)
  const [reordering, setReordering] = useState(false)
  const [reorderMode, setReorderMode] = useState(false)
  const reorderBusy = useRef(false)
  const ownerId = me?.id ?? ''
  const [modal, setModal] = useState<{ jobId: string; phaseId: string | null; from: string; to: string } | null>(null)
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).filter(day => weekends || !isWeekend(day)).map(day => format(day, 'yyyy-MM-dd')), [weekStart, weekends])
  const weekPlans = useMemo(() => schedule.filter(entry => days.includes(entry.date)), [schedule, days])
  const activeIds = useMemo(() => new Set(store.jobs.filter(job => job.status === 'active').map(job => job.id)), [store.jobs])
  const dailyCap = (me?.weekly_hours || settings.weekly_capacity || 40) / 5
  const rows = useMemo(() => {
    const ids = new Set(jobs.map(job => job.id))
    return jobRows(store).filter(row => ids.has(row.job.id))
  }, [store, jobs])
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    let order: number
    switch (sort) {
      case 'name': order = a.job.name.localeCompare(b.job.name); break
      case 'client': order = a.clientName.localeCompare(b.clientName); break
      case 'due': order = (a.nextDeadline?.date ?? '9999').localeCompare(b.nextDeadline?.date ?? '9999'); break
      default: order = a.job.priority - b.job.priority
    }
    return (asc ? order : -order) || a.job.created_at.localeCompare(b.job.created_at) || a.job.id.localeCompare(b.job.id)
  }), [rows, sort, asc])
  const openIds = new Set(store.jobs.filter(job => job.status === 'active' || job.status === 'on_hold').map(job => job.id))
  const completeOpenScope = jobs.length === openIds.size && jobs.every(job => openIds.has(job.id)) && new Set(jobs.map(job => job.id)).size === jobs.length
  const canReorder = allowReorder && reorderMode && completeOpenScope && sort === 'priority' && asc && !reordering
  const showPlan = schedulable && plan
  const today = todayISO()
  const dayTotal = (date: string) => sum(weekPlans.filter(entry => entry.date === date && activeIds.has(entry.job_id)).map(entry => entry.hours))
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function changeSort(key: SortKey) { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(true) } }
  const ariaSort = (key: SortKey) => sort === key ? asc ? 'ascending' as const : 'descending' as const : 'none' as const
  function sortButton(key: SortKey, label: string, className = '') {
    return <button type="button" className={`jobs-sort-button ${className}`} onClick={() => changeSort(key)} aria-label={`Sort by ${label.toLowerCase()}`}>{label}{sort === key && <span aria-hidden="true"> {asc ? '↑' : '↓'}</span>}</button>
  }

  async function moveJob(from: number, to: number) {
    if (!canReorder || reorderBusy.current || from === to || from < 0 || to < 0 || from >= sorted.length || to >= sorted.length) return
    reorderBusy.current = true; setReordering(true)
    const moved = arrayMove(sorted.map(row => row.job), from, to)
    // Preserve usable open-job priority slots. If old data has duplicates or
    // overlaps hidden jobs, normalize only these open jobs into free slots.
    const hiddenPriorities = new Set(store.jobs.filter(job => !openIds.has(job.id)).map(job => job.priority))
    let slots = sorted.map(row => row.job.priority).sort((a, b) => a - b)
    if (new Set(slots).size !== slots.length || slots.some(value => !Number.isInteger(value) || value < 1 || hiddenPriorities.has(value))) {
      slots = []
      for (let candidate = 1; slots.length < moved.length; candidate++) if (!hiddenPriorities.has(candidate)) slots.push(candidate)
    }
    let saved = 0
    try {
      for (const [index, job] of moved.entries()) {
        if (job.priority === slots[index]) continue
        if (!await update('jobs', job.id, { priority: slots[index] })) {
          await refresh('jobs')
          toast(saved ? 'Some priorities saved, but reordering did not finish. Jobs were refreshed; review their order.' : 'Priority was not saved. Jobs were refreshed; try again.', 'error')
          return
        }
        saved++
      }
    } catch {
      await refresh('jobs')
      toast('Reordering did not finish. Jobs were refreshed; review their order.', 'error')
    } finally { reorderBusy.current = false; setReordering(false) }
  }

  async function onDragEnd(event: DragEndEvent) {
    if (!event.over) return
    await moveJob(sorted.findIndex(row => row.job.id === event.active.id), sorted.findIndex(row => row.job.id === event.over!.id))
  }

  function exportCSV() {
    downloadCSV('jobs.csv', ['Priority', 'Job #', 'Job', 'Client', 'Status', 'Current phase', 'Phase status', 'Historical assignee', 'Next due', 'Job due (recorded)', 'Phase due (recorded)', 'Deadline', 'Next task', 'Estimate h', 'Actual h', 'Billable completed h', 'Nonbillable completed h', 'Fee', 'Ready to bill $', 'Awaiting payment $', 'Fees recorded $', 'Effective hourly rate $'],
      sorted.map(row => [row.job.priority, row.job.job_number, row.job.name, row.clientName, row.job.status, row.currentPhase ? PHASE_KIND_SHORT[row.currentPhase.kind] : '', row.currentPhase?.status ?? '', row.assigneeName, row.nextDeadline?.date ?? '', row.job.due_date ?? '', row.currentPhase?.due_date ?? '', row.nextDeadline?.title ?? '', row.nextTask?.title ?? '', row.estimatedHours, round2(row.actualHours), round2(row.billableHours), round2(row.nonBillableHours), row.job.fee, round2(row.billing.unbilledAmount), round2(row.billing.outstanding), round2(row.billing.feeRevenue), row.billing.effectiveHourlyRate == null ? '' : round2(row.billing.effectiveHourlyRate)]))
  }

  if (jobs.length === 0) return <Empty>No jobs match.</Empty>

  return <div>
    {(schedulable || allowReorder) && <div className="filters jobs-planning-toolbar">
      {schedulable && <button type="button" className={`chip ${plan ? 'on' : ''}`} aria-pressed={plan} onClick={() => { setPlan(!plan); writePref('table-plan', !plan) }}><Icon name="calendar" size={14} /> Plan hours</button>}
      {allowReorder && <button type="button" className={`chip ${reorderMode ? 'on' : ''}`} aria-pressed={reorderMode} disabled={reordering} onClick={() => setReorderMode(!reorderMode)}>Reorder priority</button>}
      {schedulable && plan && <>
        <button type="button" className="btn sm icon" onClick={() => setWeekStart(week => addWeeks(week, -1))} aria-label="Previous week"><Icon name="chevronL" size={16} /></button>
        <span className="bold nowrap">Week of {format(weekStart, 'MMM d')}</span>
        <button type="button" className="btn sm icon" onClick={() => setWeekStart(week => addWeeks(week, 1))} aria-label="Next week"><Icon name="chevronR" size={16} /></button>
        <button type="button" className="btn sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</button>
        <button type="button" className={`chip ${weekends ? 'on' : ''}`} aria-pressed={weekends} onClick={() => { setWeekends(!weekends); writePref('table-plan-weekends', !weekends) }}>Weekends</button>
      </>}
    </div>}
    {showPlan && <p className="small muted">Plan your hours on the job's current work phase. Clear a box to remove your hours; additional saved plans are shown below it. Totals include every saved plan on active jobs.<span className="show-mobile">Swipe the table to see each day.</span></p>}
    <div className="jobs-mobile-sort show-mobile"><label>Sort jobs <select aria-label="Sort jobs" value={`${sort}-${asc ? 'asc' : 'desc'}`} onChange={event => { const [key, direction] = event.target.value.split('-'); setSort(key as SortKey); setAsc(direction === 'asc') }}>
      <option value="priority-asc">Priority: highest first</option><option value="priority-desc">Priority: lowest first</option><option value="name-asc">Job: A–Z</option><option value="name-desc">Job: Z–A</option><option value="client-asc">Client: A–Z</option><option value="client-desc">Client: Z–A</option><option value="due-asc">Due: earliest first</option><option value="due-desc">Due: latest first</option>
    </select></label></div>
    <div className="table-wrap">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={sorted.map(row => row.job.id)} strategy={verticalListSortingStrategy}>
          <table className={`jobs-overview-table ${showPlan ? 'planning jobs-planning-table' : ''}`}>
            <thead><tr>
              <th className="nowrap" aria-sort={ariaSort('priority')}>{sortButton('priority', 'Priority')}</th>
              <th aria-sort={sort === 'client' ? ariaSort('client') : ariaSort('name')}>{sortButton('name', 'Job')}{sortButton('client', 'Client', 'jobs-client-sort')}</th>
              <th className={`jobs-phase-column ${showPlan ? 'plan-hide-mobile' : 'hide-mobile'}`}>Current phase</th>
              <th className={`jobs-deadline-column ${showPlan ? 'plan-hide-mobile' : ''}`} aria-sort={ariaSort('due')}>{sortButton('due', 'Next due')}</th>
              {!showPlan && <><th className="jobs-work-column hide-mobile">Worked / estimate</th><th className="jobs-billing-column hide-mobile">Billing</th></>}
              {showPlan && days.map(date => <th key={date} className={`plan-col ${date === today ? 'is-today' : ''}`}>{format(new Date(`${date}T00:00:00`), 'EEE')}<div>{format(new Date(`${date}T00:00:00`), 'd')}</div></th>)}
              {showPlan && <th className="plan-col num plan-hide-mobile">Week total</th>}
            </tr></thead>
            <tbody>{sorted.map((row, index) => <Row key={row.job.id} row={row} reorderVisible={allowReorder && reorderMode} reorderEnabled={canReorder} first={index === 0} last={index === sorted.length - 1} onMove={direction => void moveJob(index, index + direction)} onLogHours={onLogHours} onAddTask={onAddTask}
              plan={showPlan ? { days, who: ownerId, entries: weekPlans.filter(entry => entry.job_id === row.job.id), onComplex: date => setModal({ jobId: row.job.id, phaseId: row.workPhase?.id ?? null, from: date, to: date }) } : null} />)}</tbody>
            {showPlan && <tfoot><tr>
              <td colSpan={2}>Active jobs total <span className="tiny muted">(all saved plans)</span></td>
              <td className="plan-hide-mobile" /><td className="plan-hide-mobile" />
              {days.map(date => { const total = dayTotal(date); return <td key={date} className={`plan-col num ${total > dailyCap ? 'plan-over' : ''}`}>{total ? fmtHours(total) : <span className="muted">–</span>}</td> })}
              <td className="plan-col num plan-hide-mobile">{fmtHours(sum(days.map(dayTotal)))}</td>
            </tr></tfoot>}
          </table>
        </SortableContext>
      </DndContext>
    </div>
    {modal && <ScheduleModal {...modal} onClose={() => setModal(null)} />}
    {(showExport || allowReorder) && <div className="row mt small muted jobs-table-footer"><span>{canReorder ? 'Drag a handle or use the arrow buttons to change priority.' : allowReorder && !reorderMode ? 'Use Reorder priority to change the queue order.' : 'Reordering is available on all open jobs in priority order.'}</span><span className="grow" />{showExport && <button type="button" className="btn sm" onClick={exportCSV}>Export CSV</button>}</div>}
  </div>
}

type PlanProps = { days: string[]; who: string; entries: ScheduleEntry[]; onComplex: (date: string) => void }
function Row({ row, reorderVisible, reorderEnabled, first, last, onMove, onLogHours, onAddTask, plan }: { row: JobOverview; reorderVisible: boolean; reorderEnabled: boolean; first: boolean; last: boolean; onMove: (direction: number) => void; onLogHours?: Props['onLogHours']; onAddTask?: Props['onAddTask']; plan: PlanProps | null }) {
  const { update } = useData()
  const { job, currentPhase: phase, billing } = row
  const operational = job.status === 'active' || job.status === 'on_hold'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id, disabled: !reorderEnabled })
  const billingLabel = billing.unbilledAmount > 0.005 ? `${fmtMoney(billing.unbilledAmount)} ready to bill` : 'Billing'
  const rateBasis = 'Recorded deposits and invoices counted once, less funded separate charges, divided by all completed hours including nonbillable time. Includes unused deposits; before overhead and tax.'
  return <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
    <td className="nowrap"><div className="jobs-priority-controls">
      <span className="jobs-rank">{job.priority}</span>
      {reorderVisible && <>
        <button type="button" className="jobs-drag-handle" disabled={!reorderEnabled} style={{ touchAction: 'none' }} {...attributes} {...listeners} aria-label={`Drag ${job.name} to reorder`}>≡</button>
        <button type="button" className="jobs-reorder-button" disabled={!reorderEnabled || first} onClick={() => onMove(-1)} aria-label={`Move ${job.name} up`}>↑</button>
        <button type="button" className="jobs-reorder-button" disabled={!reorderEnabled || last} onClick={() => onMove(1)} aria-label={`Move ${job.name} down`}>↓</button>
      </>}
    </div></td>
    <td className="jobs-job-cell">
      <div className="job-row-heading"><Link className="bold" to={`/jobs/${job.id}`} title={`${job.name}${job.address ? ` · ${job.address}` : ''}`}>{job.name}</Link><JobStatusSelect value={job.status} label={`Status for ${job.name}`} onChange={status => update('jobs', job.id, { status })} /></div>
      <div className="tiny muted jobs-client-context">{job.job_number && <span>{job.job_number} · </span>}<Link to={`/clients/${job.client_id}`} title={row.clientName}>{row.clientName || 'Client'}</Link></div>
      <div className="jobs-mobile-summary">{phase && <span>{PHASE_KIND_SHORT[phase.kind]} · </span>}{fmtHours(row.actualHours)} / {fmtHours(row.estimatedHours)} worked{row.nonBillableHours > 0 && <span> · {fmtHours(row.nonBillableHours)} nonbillable</span>}{row.nextDeadline && <div><Link to={row.nextDeadline.link}><DueBadge date={row.nextDeadline.date} /></Link></div>}{!row.nextDeadline && !operational && job.due_date && <div className="muted">Recorded due {fmtDate(job.due_date)}</div>}{!plan && <><div><Link to={`/billing?job=${job.id}`} title={rateBasis}>{billingLabel} · {fmtHourlyRate(billing.effectiveHourlyRate)}</Link></div>{billing.outstanding > 0.005 && <div><Link to={`/billing?job=${job.id}`}>{fmtMoney(billing.outstanding)} awaiting payment</Link></div>}</>}</div>
      <details className="jobs-row-details">
        <summary aria-label={`Details for ${job.name}`} title={`Details for ${job.name}`}><Icon name="chevronR" size={15} /><span className="sr-only">Details</span></summary>
        <div className="jobs-row-expanded">
      {row.nextTask && <div className="jobs-next-task"><Link to={`/jobs/${job.id}?task=${row.nextTask.id}`}>Next: {row.nextTask.title}</Link>{row.nextTask.status === 'waiting' && <span className="badge waiting">Waiting</span>}{row.nextTask.status === 'doing' && <span className="badge doing">In progress</span>}</div>}
      {(row.waitingPhaseCount > 0 || row.overEstimatePhases.length > 0) && <div className="jobs-row-flags">{row.waitingPhaseCount > 0 && <span className="badge waiting">{row.waitingPhaseCount} waiting phase{row.waitingPhaseCount === 1 ? '' : 's'}</span>}{row.overEstimatePhases.length > 0 && <span className="badge warn">Phase over estimate</span>}</div>}
          {row.nextDeadline && <p className="tiny"><Link to={row.nextDeadline.link}>{row.nextDeadline.title} · {fmtDate(row.nextDeadline.date)}</Link></p>}
      {operational && (onLogHours || onAddTask) && <div className="jobs-row-actions">{onLogHours && <button type="button" className="btn sm ghost" onClick={() => onLogHours(job.id)} aria-label={`Log hours for ${job.name}`}><Icon name="time" size={13} /> Log hours</button>}{onAddTask && <button type="button" className="btn sm ghost" onClick={() => onAddTask(job.id)} aria-label={`Add task for ${job.name}`}><Icon name="plus" size={13} /> Task</button>}</div>}
        </div>
      </details>
    </td>
    <td className={`jobs-phase-column ${plan ? 'plan-hide-mobile' : 'hide-mobile'}`}>{phase ? <><span className={`badge ${phase.status}`}>{PHASE_KIND_SHORT[phase.kind]}</span><div className="tiny muted">{fmtHours(row.currentPhaseHours)} / {fmtHours(phase.estimate_hours)}</div></> : <span className="muted">–</span>}</td>
    <td className={`jobs-deadline-column ${plan ? 'plan-hide-mobile' : ''}`}>{row.nextDeadline ? <Link to={row.nextDeadline.link} title={row.nextDeadline.title} aria-label={`${row.nextDeadline.title}, ${fmtDate(row.nextDeadline.date)}`}><DueBadge date={row.nextDeadline.date} /></Link> : !operational && job.due_date ? <span className="small muted">Recorded {fmtDate(job.due_date)}</span> : <span className="muted">–</span>}</td>
    {!plan && <>
      <td className="jobs-work-column hide-mobile"><div className="small nowrap">{fmtHours(row.actualHours)} / {fmtHours(row.estimatedHours)}</div><div className="tiny muted">{row.nonBillableHours > 0 && `${fmtHours(row.nonBillableHours)} nonbillable`}{row.runningCount > 0 ? `${row.nonBillableHours > 0 ? ' · ' : ''}timer running` : ''}</div></td>
      <td className="jobs-billing-column hide-mobile"><Link to={`/billing?job=${job.id}`}>{billingLabel} →</Link>{billing.outstanding > 0.005 && <div className="tiny warn-text">{fmtMoney(billing.outstanding)} awaiting payment</div>}<div className="tiny muted" title={rateBasis}>{fmtHourlyRate(billing.effectiveHourlyRate)}</div></td>
    </>}
    {plan && plan.days.map(date => <DayCell key={date} date={date} jobId={job.id} jobName={job.name} phaseId={row.workPhase?.id ?? null} who={plan.who} entries={plan.entries.filter(entry => entry.date === date && entry.user_id === plan.who)} savedHours={sum(plan.entries.filter(entry => entry.date === date && entry.user_id !== plan.who).map(entry => entry.hours))} onComplex={() => plan.onComplex(date)} />)}
    {plan && <td className="plan-col num bold plan-hide-mobile" title="All saved plans for this job this week">{fmtHours(sum(plan.entries.map(entry => entry.hours)))}</td>}
  </tr>
}

/** A day saves once on blur/Enter. Escape restores the focus-time value. */
function DayCell({ date, jobId, jobName, phaseId, who, entries, savedHours, onComplex }: { date: string; jobId: string; jobName: string; phaseId: string | null; who: string; entries: ScheduleEntry[]; savedHours: number; onComplex: () => void }) {
  const { insert, update, remove, refresh, toast } = useData()
  const total = sum(entries.map(entry => entry.hours))
  const shown = total ? String(round2(total)) : ''
  const [value, setValue] = useState(shown)
  const [focused, setFocused] = useState(false)
  const [saving, setSaving] = useState(false)
  const draft = useRef(shown)
  const editing = useRef(false)
  const busy = useRef(false)
  const baseline = useRef({ shown, total })
  const multi = entries.length > 1
  useEffect(() => {
    if (focused || saving) return
    draft.current = shown; setValue(shown)
  }, [shown, focused, saving])

  function restore() { draft.current = baseline.current.shown; setValue(baseline.current.shown) }
  async function commit(badInput = false) {
    if (!editing.current || multi || busy.current || !who) return
    editing.current = false; setFocused(false)
    const hours = draft.current.trim() === '' ? 0 : Number(draft.current)
    if (badInput || !Number.isFinite(hours) || hours < 0 || hours > 24) { restore(); toast('Enter planned hours from 0 to 24.', 'error'); return }
    if (hours === baseline.current.total) return
    busy.current = true; setSaving(true)
    let saved = false
    try {
      if (entries.length === 1) saved = hours === 0 ? await remove('schedule_entries', entries[0].id) : await update('schedule_entries', entries[0].id, { hours })
      else if (hours > 0) saved = Boolean(await insert('schedule_entries', { job_id: jobId, phase_id: phaseId, user_id: who, date, hours }))
      if (!saved) {
        restore(); await refresh('schedule_entries')
        toast('Could not confirm the save. Plans were refreshed; check the hours before retrying.', 'error')
      }
    } catch {
      restore(); await refresh('schedule_entries')
      toast('Could not confirm the save. Plans were refreshed; check the hours before retrying.', 'error')
    } finally { busy.current = false; setSaving(false) }
  }

  return <td className="plan-col">
    <input className={`plan-cell ${total ? 'filled' : ''}`} type="number" inputMode="decimal" min="0" max="24" step="0.5" value={value} placeholder="–" readOnly={multi} disabled={!who || saving} aria-busy={saving} aria-label={`Hours for ${jobName} on ${date}`} title={multi ? 'Your hours are on multiple phases. Open the schedule form to edit them.' : 'Your planned hours'}
      onFocus={() => { if (multi) { onComplex(); return } editing.current = true; baseline.current = { shown: draft.current, total: Number(draft.current) || 0 }; setFocused(true) }}
      onChange={event => { draft.current = event.target.value; setValue(event.target.value) }}
      onBlur={event => { void commit(event.currentTarget.validity.badInput) }}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing.current = false; restore(); setFocused(false); event.currentTarget.blur() }
      }} />
    {savedHours > 0 && <span className="jobs-saved-plan" title="Additional saved plans from existing records; your input above is separate">+ {fmtHours(savedHours)} saved</span>}
  </td>
}
