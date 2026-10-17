// The prioritized job queue as a table. Drag the handle to reorder priority,
// click a column header to sort, click a row to open the job.
// With "Plan hours" on, each row also gets one box per day of the chosen week:
// typing hours there schedules them on the job's current phase (same data as
// dragging on the Gantt chart). The bottom row is your total per day.
import { useEffect, useMemo, useState } from 'react'
import { addDays, addWeeks, format, isWeekend, startOfWeek } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useData } from '../lib/store'
import { hoursForJob, hoursForPhase, workPhase } from '../lib/calc'
import type { Job, Phase } from '../lib/types'
import { PHASE_KIND_SHORT } from '../lib/types'
import { daysUntil, downloadCSV, fmtDate, fmtHours, sum, todayISO } from '../lib/utils'
import type { ScheduleEntry } from '../lib/types'
import { ScheduleModal } from '../components/ScheduleModal'
import { DueBadge, Empty, Icon, JobStatusSelect, Progress } from '../components/ui'

type SortKey = 'priority' | 'name' | 'client' | 'due'

function readPref(key: string, fallback: boolean) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v === '1' } catch { return fallback }
}
function writePref(key: string, v: boolean) {
  try { localStorage.setItem(key, v ? '1' : '0') } catch { /* storage unavailable */ }
}

export function JobsTable({ jobs, showExport = true, schedulable = false }: { jobs: Job[]; showExport?: boolean; schedulable?: boolean }) {
  const store = useData()
  const { clients, phases, timeEntries, profiles, update, schedule, me, settings } = store
  const [plan, setPlan] = useState(() => schedulable && readPref('table-plan', true))
  const [weekends, setWeekends] = useState(() => readPref('table-plan-weekends', false))
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const ownerId = me?.id ?? ''
  const [modal, setModal] = useState<{ jobId: string; phaseId: string | null; from: string; to: string } | null>(null)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter(d => weekends || !isWeekend(d)).map(d => format(d, 'yyyy-MM-dd')), [weekStart, weekends])
  const mine = useMemo(() => schedule.filter(s => s.user_id === ownerId && days.includes(s.date)), [schedule, ownerId, days])
  const cancelledJobIds = useMemo(() => new Set(store.jobs.filter(j => j.status === 'cancelled').map(j => j.id)), [store.jobs])
  const dailyCap = (me?.weekly_hours || settings.weekly_capacity || 40) / 5
  const nav = useNavigate()
  const [sort, setSort] = useState<SortKey>('priority')
  const [asc, setAsc] = useState(true)

  // "Current phase" = first phase that isn't complete.
  const current = (j: Job) => phases.find(p => p.job_id === j.id && p.status !== 'complete') ?? phases.filter(p => p.job_id === j.id).at(-1)
  const rows = useMemo(() => jobs.map(j => {
    const cp = current(j)
    const est = sum(phases.filter(p => p.job_id === j.id).map(p => p.estimate_hours))
    const logged = hoursForJob(timeEntries, j.id)
    const nextDue = cp?.due_date ?? j.due_date
    const wp = workPhase(phases, j.id)
    return { j, cp, wp, est, logged, nextDue, client: clients.find(c => c.id === j.client_id)?.name ?? '', assignee: profiles.find(p => p.id === cp?.assignee_id)?.full_name ?? '' }
  }), [jobs, phases, timeEntries, clients, profiles]) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const r = [...rows]
    const dir = asc ? 1 : -1
    r.sort((a, b) => {
      switch (sort) {
        case 'name': return dir * a.j.name.localeCompare(b.j.name)
        case 'client': return dir * a.client.localeCompare(b.client)
        case 'due': return dir * ((a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999'))
        default: return dir * (a.j.priority - b.j.priority)
      }
    })
    return r
  }, [rows, sort, asc])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  )

  function header(key: SortKey, label: string, cls = '') {
    return <th className={`sortable ${cls}`} onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(true) } }}>{label}{sort === key ? (asc ? ' ↑' : ' ↓') : ''}</th>
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || sort !== 'priority') return
    const ids = sorted.map(r => r.j.id)
    const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    await Promise.all(moved.map((id, i) => {
      const job = jobs.find(j => j.id === id)!
      return job.priority === i + 1 ? Promise.resolve() : update('jobs', id, { priority: i + 1 })
    }))
  }

  function exportCSV() {
    downloadCSV('jobs.csv', ['Priority', 'Job #', 'Job', 'Client', 'Status', 'Current phase', 'Phase status', 'Assignee', 'Entered queue', 'Next due', 'Estimate h', 'Logged h', 'Fee'],
      sorted.map(r => [r.j.priority, r.j.job_number, r.j.name, r.client, r.j.status, r.cp ? PHASE_KIND_SHORT[r.cp.kind] : '', r.cp?.status ?? '', r.assignee, r.j.queued_date ?? '', r.nextDue ?? '', r.est, Math.round(r.logged * 100) / 100, r.j.fee]))
  }

  if (jobs.length === 0) return <Empty>No jobs match.</Empty>

  const showPlan = schedulable && plan
  const dayTotal = (d: string) => sum(mine.filter(s => s.date === d && !cancelledJobIds.has(s.job_id)).map(s => s.hours))
  const today = todayISO()

  return (
    <div>
      {schedulable && (
        <div className="filters">
          <button className={`chip ${plan ? 'on' : ''}`} onClick={() => { setPlan(!plan); writePref('table-plan', !plan) }}><Icon name="calendar" size={14} /> Plan hours</button>
          {plan && <>
            <button className="btn sm icon" onClick={() => setWeekStart(w => addWeeks(w, -1))} aria-label="Previous week"><Icon name="chevronL" size={16} /></button>
            <span className="bold nowrap">Week of {format(weekStart, 'MMM d')}</span>
            <button className="btn sm icon" onClick={() => setWeekStart(w => addWeeks(w, 1))} aria-label="Next week"><Icon name="chevronR" size={16} /></button>
            <button className="btn sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>This week</button>
            <button className={`chip ${weekends ? 'on' : ''}`} onClick={() => { setWeekends(!weekends); writePref('table-plan-weekends', !weekends) }}>Weekends</button>
          </>}
        </div>
      )}
      {showPlan && <p className="small muted" style={{ margin: '-4px 0 8px' }}>Type your hours in a day's box to schedule them on the job's current phase (a queued job's hours go to Original design). Clear the box to remove them. The bottom row is your total for each day (yellow = more than a full day).</p>}
      <div className="table-wrap">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sorted.map(r => r.j.id)} strategy={verticalListSortingStrategy}>
            <table className={showPlan ? 'planning' : ''}>
              <thead>
                <tr>
                  {header('priority', '#', 'nowrap')}
                  {header('name', 'Job')}
                  {!showPlan && header('client', 'Client', 'hide-mobile')}
                  <th className="plan-hide-mobile">Phase</th>
                  {header('due', 'Due', 'plan-hide-mobile')}
                  {!showPlan && <th className="hide-mobile" style={{ width: 140 }}>Hours</th>}
                  {showPlan && days.map(d => <th key={d} className={`plan-col ${d === today ? 'is-today' : ''}`}>{format(new Date(d + 'T00:00:00'), 'EEE')}<div><span>{format(new Date(d + 'T00:00:00'), 'd')}</span></div></th>)}
                  {showPlan && <th className="plan-col num plan-hide-mobile">Week</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => <Row key={r.j.id} r={r} onOpen={() => nav(`/jobs/${r.j.id}`)} draggable={sort === 'priority'} phaseLogged={r.cp ? hoursForPhase(timeEntries, r.cp.id) : 0}
                  plan={showPlan ? { days, who: ownerId, entries: mine.filter(s => s.job_id === r.j.id), onComplex: (d: string) => setModal({ jobId: r.j.id, phaseId: r.wp?.id ?? null, from: d, to: d }) } : null} />)}
              </tbody>
              {showPlan && (
                <tfoot>
                  <tr>
                    <td colSpan={2}>Your total <span className="tiny muted" style={{ fontWeight: 400 }}>(all jobs)</span></td>
                    <td className="plan-hide-mobile" /><td className="plan-hide-mobile" />
                    {days.map(d => { const t = dayTotal(d); return <td key={d} className={`plan-col num ${t > dailyCap ? 'plan-over' : ''}`}>{t ? fmtHours(t) : <span className="muted">–</span>}</td> })}
                    <td className="plan-col num plan-hide-mobile">{fmtHours(sum(days.map(dayTotal)))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </SortableContext>
        </DndContext>
      </div>
      {modal && <ScheduleModal {...modal} onClose={() => setModal(null)} />}
      {showExport && <div className="row mt small muted"><span>{sort === 'priority' ? 'Drag the ≡ handle to change priority.' : 'Sort by # to drag-reorder priority.'}</span><span className="grow" /><button className="btn sm" onClick={exportCSV}>Export CSV</button></div>}
    </div>
  )
}

type RowData = { j: Job; cp: Phase | undefined; wp: Phase | undefined; est: number; logged: number; nextDue: string | null; client: string; assignee: string }
type PlanProps = { days: string[]; who: string; entries: ScheduleEntry[]; onComplex: (date: string) => void }

function Row({ r, onOpen, draggable, phaseLogged, plan }: { r: RowData; onOpen: () => void; draggable: boolean; phaseLogged: number; plan: PlanProps | null }) {
  const { update } = useData()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.j.id, disabled: !draggable })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const overdue = daysUntil(r.nextDue) != null && (daysUntil(r.nextDue) as number) < 0 && r.j.status === 'active'
  return (
    <tr ref={setNodeRef} style={style} className="clickable" onClick={onOpen}>
      <td className="nowrap" onClick={e => e.stopPropagation()}>
        <span className="muted" style={{ cursor: draggable ? 'grab' : 'default', touchAction: 'none', padding: '6px 4px', display: 'inline-block' }} {...attributes} {...listeners}>{draggable ? '≡ ' : ''}{r.j.priority}</span>
      </td>
      <td>
        <div className="job-row-heading"><span className="bold">{r.j.name}</span><JobStatusSelect value={r.j.status} label={`Status for ${r.j.name}`} onChange={status => update('jobs', r.j.id, { status })} /></div>
        <div className="tiny muted">{r.j.job_number}{r.j.job_number && ' · '}<span className={plan ? '' : 'hide-mobile'}>{r.client}</span></div>
        {r.j.queued_date && r.cp?.kind === 'queued' && <div className="tiny muted">In queue since {fmtDate(r.j.queued_date)}{(() => { const d = -(daysUntil(r.j.queued_date) ?? 0); return d > 0 ? ` (${d}d)` : '' })()}</div>}
      </td>
      {!plan && <td className="hide-mobile">{r.client}</td>}
      <td className={plan ? 'plan-hide-mobile' : ''}>{r.cp ? <span className={`badge ${r.cp.status}`}>{PHASE_KIND_SHORT[r.cp.kind]}</span> : <span className="muted">–</span>}{plan && r.cp && <div className="tiny muted nowrap">{fmtHours(phaseLogged)} / {fmtHours(r.cp.estimate_hours)}</div>}</td>
      <td className={`nowrap ${plan ? 'plan-hide-mobile' : ''}`}>{r.j.status === 'cancelled' ? <span className="small muted">{fmtDate(r.nextDue)}</span> : <DueBadge date={r.nextDue} done={r.j.status === 'complete'} />}{overdue && ''}</td>
      {!plan && <td className="hide-mobile">
        <div className="tiny muted">{fmtHours(phaseLogged)} / {fmtHours(r.cp?.estimate_hours ?? 0)} phase · {fmtHours(r.logged)} / {fmtHours(r.est)} job</div>
        <Progress value={r.logged} max={r.est} />
      </td>}
      {plan && plan.days.map(d => <DayCell key={d} date={d} jobId={r.j.id} phaseId={r.wp?.id ?? null} who={plan.who} entries={plan.entries.filter(e => e.date === d)} onComplex={() => plan.onComplex(d)} />)}
      {plan && <td className="plan-col num bold plan-hide-mobile">{(() => { const t = sum(plan.entries.map(e => e.hours)); return t ? fmtHours(t) : <span className="muted">–</span> })()}</td>}
    </tr>
  )
}

/** One editable day box. Saves when you leave the box (or press Enter). */
function DayCell({ date, jobId, phaseId, who, entries, onComplex }: { date: string; jobId: string; phaseId: string | null; who: string; entries: ScheduleEntry[]; onComplex: () => void }) {
  const { insert, update, remove } = useData()
  const total = sum(entries.map(e => e.hours))
  const shown = total ? String(Math.round(total * 100) / 100) : ''
  const [val, setVal] = useState(shown)
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setVal(shown) }, [shown, focused])
  const multi = entries.length > 1  // several phases scheduled that day → edit in the full form

  async function commit() {
    setFocused(false)
    const v = val.trim() === '' ? 0 : Number(val)
    if (Number.isNaN(v) || v < 0 || v === total) { setVal(shown); return }
    if (entries.length === 1) {
      if (v === 0) await remove('schedule_entries', entries[0].id)
      else await update('schedule_entries', entries[0].id, { hours: v })
    } else if (entries.length === 0 && v > 0) {
      await insert('schedule_entries', { job_id: jobId, phase_id: phaseId, user_id: who, date, hours: v })
    }
  }

  return (
    <td className="plan-col" onClick={e => e.stopPropagation()}>
      <input
        className={`plan-cell ${total ? 'filled' : ''}`}
        type="number" inputMode="decimal" min="0" max="24" step="0.5"
        value={val} placeholder="–" readOnly={multi} disabled={!who}
        title={multi ? 'Hours on more than one phase. Click to edit.' : 'Hours scheduled'}
        aria-label={`Hours on ${date}`}
        onFocus={() => { if (multi) onComplex(); else setFocused(true) }}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { if (!multi) void commit() }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setVal(shown); setFocused(false); (e.target as HTMLInputElement).blur() } }}
      />
    </td>
  )
}
