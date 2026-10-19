import { useRef, useState } from 'react'
import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { usePlanning } from '../lib/planningStore'
import { dayCapacity, defaultDailyHours, projectSchedule, scheduleMoveErrors, validPlanningDate } from '../lib/planningCapacity'
import type { AvailabilityBlock, AvailabilityBlockKind, DailyAvailability, PlanningScheduleMove } from '../lib/planningTypes'
import { isWorkflowPhase, phaseLabel } from '../lib/phases'
import { fmtDate, fmtHours, todayISO } from '../lib/utils'
import { Icon, Modal } from '../components/ui'
import { ScheduleModal } from '../components/ScheduleModal'
import './Availability.css'

const KINDS: Record<AvailabilityBlockKind, string> = { appointment: 'Appointment', travel: 'Travel', admin: 'Administrative work', time_off: 'Time off', buffer: 'Buffer', other: 'Other' }
type DraftMove = Omit<PlanningScheduleMove, 'hours'> & { hours: string }

export function Availability() {
  const store = useData(), planning = usePlanning()
  const [params, setParams] = useSearchParams()
  const requestedDate = params.get('date') ?? ''
  const date = validPlanningDate(requestedDate) ? requestedDate : todayISO()
  const weekStart = startOfWeek(parseISO(date), { weekStartsOn: 1 })
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), 'yyyy-MM-dd'))
  const [editDay, setEditDay] = useState<{ date: string; row?: DailyAvailability } | null>(null)
  const [editBlock, setEditBlock] = useState<{ date: string; row?: AvailabilityBlock } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftMove>>({})
  const [pending, setPending] = useState(false), busy = useRef(false)
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState('')
  const [newPlan, setNewPlan] = useState<{ jobId: string; date: string } | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const moves = Object.values(drafts).map(draft => ({ ...draft, hours: Number(draft.hours) }))
  const changes = moves.filter(move => move.date !== move.expected_date || move.hours !== move.expected_hours)
  const moveErrors = scheduleMoveErrors(store, changes)
  const projected = projectSchedule(store.schedule, changes)
  const preview = changes.length > 0
  const day = dayCapacity(store, planning, date, projected)
  const week = days.map(day => dayCapacity(store, planning, day, projected))
  const extraDates = [...new Set(changes.map(move => move.date).filter(date => validPlanningDate(date) && !days.includes(date)))].sort()
  const savedPlans = store.schedule.filter(entry => days.includes(entry.date) && (includeInactive || store.jobs.find(job => job.id === entry.job_id)?.status === 'active'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.job_id.localeCompare(b.job_id) || a.id.localeCompare(b.id))
  const activeJobs = store.jobs.filter(job => job.status === 'active').sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  function changeDate(next: string) { if (validPlanningDate(next)) setParams(current => { const nextParams = new URLSearchParams(current); nextParams.set('date', next); return nextParams }) }
  function startMove(id: string) {
    if (busy.current) return
    const row = store.schedule.find(row => row.id === id)
    if (!row) return
    setDrafts(previous => ({ ...previous, [id]: { id, expected_job_id: row.job_id, expected_phase_id: row.phase_id, expected_date: row.date, expected_hours: row.hours, date: row.date, hours: String(row.hours) } }))
    setError('')
  }
  async function apply() {
    if (busy.current || !changes.length || moveErrors.length) return
    busy.current = true; setPending(true); setError('')
    try {
      if (!await planning.applyMoves(changes)) { setError('The move could not be confirmed. Your preview is kept. Review the refreshed plans before trying again.'); return }
      await store.refresh('schedule_entries'); setDrafts({}); store.toast('Schedule changes saved')
    } catch { setError('The move could not be confirmed. Your preview is kept. Review the refreshed plans before trying again.') }
    finally { busy.current = false; setPending(false) }
  }
  if (planning.loading) return <div className="empty">Loading shared availability…</div>
  return <div className="availability-page">
    {planning.error && <div className="card" role="alert"><p className="danger-text">Shared availability could not be refreshed: {planning.error}</p><button className="btn" onClick={() => void planning.refresh()}>Retry planning data</button></div>}
    <div className="page-header"><div><h1>Availability &amp; weekly plan</h1><p>Fit job work around the time you actually have. Preview moves before saving.</p></div><div className="availability-header-actions"><Link className="btn" to="/review">Morning Review</Link><Link className="btn" to="/jobs?view=gantt">Timeline</Link></div></div>
    <div className="availability-week-nav"><button className="btn icon" aria-label="Previous availability week" onClick={() => changeDate(format(addWeeks(parseISO(date), -1), 'yyyy-MM-dd'))}><Icon name="chevronL" /></button><strong>Week of {fmtDate(days[0])}</strong><button className="btn icon" aria-label="Next availability week" onClick={() => changeDate(format(addWeeks(parseISO(date), 1), 'yyyy-MM-dd'))}><Icon name="chevronR" /></button><button className="btn" onClick={() => changeDate(todayISO())}>This week</button><label>Selected date<input aria-label="Availability date" type="date" value={date} onChange={event => changeDate(event.target.value)} /></label></div>
    <div className="availability-week-scroll" role="region" aria-label="Weekly availability" tabIndex={0}><div className="availability-week">{week.map((summary, i) => <button className={`availability-day ${summary.overHours ? 'over' : ''}`} key={days[i]} aria-pressed={date === days[i]} aria-label={`Availability for ${days[i]}`} onClick={() => changeDate(days[i])}><strong>{format(parseISO(days[i]), 'EEE, MMM d')}</strong><span>{fmtHours(summary.availableHours)} available</span><span>{fmtHours(summary.plannedHours)} planned{preview ? ' in preview' : ''}</span><span className="availability-free">{summary.overHours ? `${fmtHours(summary.overHours)} over capacity` : `${fmtHours(summary.freeHours)} unplanned`}</span></button>)}</div></div>
    <div className="availability-summary"><span><b>{fmtHours(week.reduce((sum, day) => sum + day.availableHours, 0))}</b> available this week</span><span><b>{fmtHours(week.reduce((sum, day) => sum + day.plannedHours, 0))}</b> planned</span></div>
    <p className="small muted">Whole-day capacity, separate from worked time. Saved plans on active jobs count across all existing ownership, including planning history. Weekend capacity starts at zero; set daily hours when you plan to work.</p>
    <div className="availability-grid"><section className="card"><h2>{fmtDate(date, 'long')}</h2><div className="availability-summary"><span>{fmtHours(day.baseHours)} base</span><span>− {fmtHours(day.blockedHours)} blocked</span><span>= <b>{fmtHours(day.availableHours)}</b> available</span></div>{day.blockedHours > day.baseHours && <p className="warn-text small">Blocks exceed the base hours. Availability is zero.</p>}{day.override?.note && <p className="planning-day-note">{day.override.note}</p>}<div className="availability-day-actions"><button className="btn" onClick={() => setEditDay({ date, row: day.override })}>Set daily hours</button><button className="btn" onClick={() => setEditBlock({ date })}><Icon name="plus" size={14} /> Block time</button></div><p className="small muted">Base hours default to one fifth of your weekly capacity on weekdays. An explicit zero means a day off.</p></section>
    <section className="card"><h2>Time outside job plans</h2><p className="small muted">Use blocks for appointments, travel, admin, time off, or buffer that are not already included in planned job hours. Each block reduces availability once.</p>{day.blocks.length ? <ul className="availability-blocks">{day.blocks.map(block => <li key={block.id}><div><b>{block.title}</b><div className="tiny muted">{KINDS[block.kind]} · {fmtHours(block.hours)}</div>{block.note && <div className="planning-day-note">{block.note}</div>}</div><button className="btn icon" aria-label={`Edit block: ${block.title}`} onClick={() => setEditBlock({ date: block.date, row: block })}><Icon name="edit" size={15} /></button></li>)}</ul> : <p className="small muted">No time blocked for this day.</p>}</section></div>
    <section className="card availability-plans"><h2>Saved job plans</h2><p className="small muted">Moving a plan changes its scheduled date and hours. Job deadlines and client commitments stay separate. Historical-owner and retired-phase plans remain visible; use the timeline to review them.</p><div className="availability-day-actions"><label className="small availability-inactive-toggle"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} /> Include inactive jobs</label><span className="grow" /><label className="small">Plan a job<select aria-label="Job to plan" value={jobId} onChange={event => setJobId(event.target.value)}><option value="">Choose an active job</option>{activeJobs.map(job => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label><button className="btn" disabled={pending || Boolean(planning.error) || !jobId || !store.me} onClick={() => setNewPlan({ jobId, date })}>Plan hours</button></div>
    {Object.keys(drafts).length > 0 && <div className="availability-plan-preview" aria-label="Schedule preview"><b>{changes.length} unsaved move{changes.length === 1 ? '' : 's'}</b><p className="small">Day totals above include this preview. Changes save together after the original records are checked.</p>{[...moveErrors, ...(error ? [error] : [])].map(message => <p key={message} className="danger-text small" role="alert">{message}</p>)}{extraDates.length > 0 && <div className="availability-extra-days">{extraDates.map(date => { const day = dayCapacity(store, planning, date, projected); return <span key={date}>{fmtDate(date)}: {fmtHours(day.plannedHours)} planned / {fmtHours(day.availableHours)} available{day.overHours ? ` · ${fmtHours(day.overHours)} over` : ''}</span> })}</div>}<div className="availability-day-actions"><button className="btn primary" disabled={pending || Boolean(planning.error) || !changes.length || moveErrors.length > 0} onClick={() => void apply()}>{pending ? 'Saving moves…' : 'Save preview'}</button><button className="btn" disabled={pending} onClick={() => { setDrafts({}); setError('') }}>Discard preview</button></div></div>}
    {savedPlans.length ? <div className="table-wrap"><table><thead><tr><th>Saved date</th><th>Job / phase</th><th>Saved hours</th><th>Preview date</th><th>Preview hours</th><th>Action</th></tr></thead><tbody>{savedPlans.map(entry => {
      const job = store.jobs.find(job => job.id === entry.job_id), phase = store.phases.find(phase => phase.id === entry.phase_id)
      const draft = drafts[entry.id], canMove = entry.user_id === store.me?.id && job?.status === 'active' && (!entry.phase_id || phase && isWorkflowPhase(phase) && phase.job_id === entry.job_id)
      return <tr key={entry.id}><td>{fmtDate(entry.date)}</td><td><Link to={`/jobs/${entry.job_id}`}>{job?.name ?? 'Job unavailable'}</Link><div className="tiny muted">{phase ? phaseLabel(phase) : 'General'}{entry.user_id !== store.me?.id ? ' · additional saved plan' : ''}{job?.status !== 'active' ? ' · outside active capacity' : ''}</div></td><td>{fmtHours(entry.hours)}</td><td>{draft ? <input type="date" aria-label={`Preview date for plan ${entry.id}`} disabled={pending} value={draft.date} onChange={event => setDrafts(previous => ({ ...previous, [entry.id]: { ...draft, date: event.target.value } }))} /> : '—'}</td><td>{draft ? <input type="number" min="0.01" max="24" step="any" aria-label={`Preview hours for plan ${entry.id}`} disabled={pending} value={draft.hours} onChange={event => setDrafts(previous => ({ ...previous, [entry.id]: { ...draft, hours: event.target.value } }))} /> : '—'}</td><td>{draft ? <button className="btn sm" disabled={pending} onClick={() => setDrafts(previous => { const next = { ...previous }; delete next[entry.id]; return next })}>Cancel move</button> : canMove ? <button className="btn sm" aria-label={`Move plan for ${job?.name} on ${entry.date}`} disabled={pending || Boolean(planning.error)} onClick={() => startMove(entry.id)}>Move</button> : <Link className="small" to="/jobs?view=gantt">Review timeline</Link>}</td></tr>
    })}</tbody></table></div> : <p className="small muted">No saved job plans in this week. Choose a job above to plan hours.</p>}</section>
    {editDay && <DayEditor key={editDay.row?.id ?? editDay.date} {...editDay} onClose={() => setEditDay(null)} />}
    {editBlock && <BlockEditor key={editBlock.row?.id ?? `new-${editBlock.date}`} {...editBlock} onClose={() => setEditBlock(null)} />}
    {newPlan && <ScheduleModal jobId={newPlan.jobId} phaseId={null} from={newPlan.date} to={newPlan.date} onClose={() => setNewPlan(null)} />}
  </div>
}

function DayEditor({ date, row, onClose }: { date: string; row?: DailyAvailability; onClose: () => void }) {
  const store = useData(), planning = usePlanning(), busy = useRef(false), form = useRef<HTMLFormElement>(null)
  const [snapshot, setSnapshot] = useState(row), [id, setId] = useState(() => row?.id ?? crypto.randomUUID())
  const [hours, setHours] = useState(String(row?.base_hours ?? defaultDailyHours(store, date))), [note, setNote] = useState(row?.note ?? '')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const latest = planning.availability.find(item => item.date === date)
  const close = () => { if (!busy.current) onClose() }
  function reload() { setSnapshot(latest); setId(latest?.id ?? id); setHours(String(latest?.base_hours ?? defaultDailyHours(store, date))); setNote(latest?.note ?? ''); setError('') }
  async function save() {
    if (busy.current) return
    if (!hours.trim() || !Number.isFinite(Number(hours)) || Number(hours) < 0 || Number(hours) > 24 || form.current?.querySelector(':invalid')) { setError('Enter base hours from zero to 24.'); return }
    busy.current = true; setSaving(true); setError('')
    try { if (await planning.save('daily_availability', { id, date, base_hours: Number(hours), note }, snapshot?.revision)) onClose(); else setError('Daily hours could not be saved. Your draft is kept. Reload the saved version if it changed.') }
    catch { setError('Daily hours could not be saved. Your draft is kept.') }
    finally { busy.current = false; setSaving(false) }
  }
  async function restoreWeeklyDefault() {
    if (!snapshot || busy.current || !confirm(`Use weekly default hours for ${date}? This removes the daily override.`)) return
    busy.current = true; setSaving(true); setError('')
    try { if (await planning.remove('daily_availability', snapshot.id, snapshot.revision)) onClose(); else setError('The override could not be removed. Reload the saved version before trying again.') }
    catch { setError('The override could not be removed.') }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title="Daily available hours" className="availability-editor" onClose={close} footer={<>{snapshot && <button className="btn danger left" disabled={saving} onClick={() => void restoreWeeklyDefault()}>Use weekly default</button>}<button className="btn" disabled={saving} onClick={close}>Cancel</button><button className="btn primary" form="daily-hours-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save daily hours'}</button></>}><form ref={form} id="daily-hours-form" noValidate onSubmit={event => { event.preventDefault(); void save() }}><p>{fmtDate(date, 'long')}</p>{error && <p className="danger-text small" role="alert">{error}</p>}{(error || latest?.revision !== snapshot?.revision) && <button type="button" className="btn sm" disabled={saving} onClick={reload}>Reload saved version</button>}<label className="field">Base hours<input aria-label="Base hours" type="number" min="0" max="24" step="any" disabled={saving} value={hours} onChange={event => setHours(event.target.value)} /></label><label className="field">Note<textarea aria-label="Daily availability note" disabled={saving} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label><p className="small muted">Use zero for a day off. Time blocks are deducted from these base hours.</p></form></Modal>
}

function BlockEditor({ date, row, onClose }: { date: string; row?: AvailabilityBlock; onClose: () => void }) {
  const planning = usePlanning(), busy = useRef(false), form = useRef<HTMLFormElement>(null)
  const [snapshot, setSnapshot] = useState(row), [id, setId] = useState(() => row?.id ?? crypto.randomUUID())
  const [draft, setDraft] = useState({ date: row?.date ?? date, title: row?.title ?? '', kind: row?.kind ?? 'appointment' as AvailabilityBlockKind, hours: String(row?.hours ?? 1), note: row?.note ?? '' })
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const close = () => { if (!busy.current) onClose() }
  const latest = planning.blocks.find(item => item.id === id)
  function reload() { if (!latest) return; setSnapshot(latest); setId(latest.id); setDraft({ date: latest.date, title: latest.title, kind: latest.kind, hours: String(latest.hours), note: latest.note }); setError('') }
  async function save() {
    if (busy.current) return
    if (!draft.title.trim() || !validPlanningDate(draft.date) || !draft.hours.trim() || !Number.isFinite(Number(draft.hours)) || Number(draft.hours) <= 0 || Number(draft.hours) > 24 || form.current?.querySelector(':invalid')) { setError('Enter a title, valid date, and hours greater than zero and no more than 24.'); return }
    busy.current = true; setSaving(true); setError('')
    try { if (await planning.save('availability_blocks', { ...draft, title: draft.title.trim(), id, hours: Number(draft.hours) }, snapshot?.revision)) onClose(); else setError('This time block could not be saved. Your draft is kept. Reload the saved version if it changed.') }
    catch { setError('This time block could not be saved. Your draft is kept.') }
    finally { busy.current = false; setSaving(false) }
  }
  async function remove() {
    if (!snapshot || busy.current || !confirm(`Remove the time block "${snapshot.title}"?`)) return
    busy.current = true; setSaving(true); setError('')
    try { if (await planning.remove('availability_blocks', snapshot.id, snapshot.revision)) onClose(); else setError('This time block could not be removed. Your draft is kept.') }
    catch { setError('This time block could not be removed. Your draft is kept.') }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title={row ? 'Edit time block' : 'Block time'} className="availability-editor" onClose={close} footer={<>{snapshot && <button className="btn danger left" disabled={saving} onClick={() => void remove()}>Remove block</button>}<button className="btn" disabled={saving} onClick={close}>Cancel</button><button className="btn primary" form="time-block-form" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save time block'}</button></>}><form ref={form} id="time-block-form" noValidate onSubmit={event => { event.preventDefault(); void save() }}><fieldset className="editor-fields" disabled={saving}>{error && <p className="danger-text small" role="alert">{error}</p>}{latest && (error || latest.revision !== snapshot?.revision) && <button className="btn sm" type="button" onClick={reload}>Reload saved version</button>}<label className="field">Title<input aria-label="Time block title" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><div className="row"><label className="field">Date<input aria-label="Time block date" type="date" value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label><label className="field">Hours<input aria-label="Time block hours" type="number" min="0.01" max="24" step="any" value={draft.hours} onChange={event => setDraft({ ...draft, hours: event.target.value })} /></label></div><label className="field">Type<select aria-label="Time block type" value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value as AvailabilityBlockKind })}>{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field">Note<textarea aria-label="Time block note" rows={3} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} /></label><p className="small muted">Only block time that is not already included in your job plans.</p></fieldset></form></Modal>
}
