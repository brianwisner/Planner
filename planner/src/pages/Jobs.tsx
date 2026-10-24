// Jobs: a pipeline board (drag a job to move it to the next stage) and a
// priority list (drag to reorder your queue). Filters live in the address bar.
import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowRightLeft, Briefcase, ClipboardCheck, Columns3, Download, Ellipsis, GripVertical, Hourglass, List, PauseCircle, Play, Plus, Search, X } from 'lucide-react'
import { useData } from '../lib/store'
import { useEditors } from '../components/editors'
import { DueText, Empty, Menu, Progress, Segmented, StageChip, type MenuEntry } from '../components/ui'
import { STAGES, STAGE_HINT, STAGE_LABEL, type Stage } from '../lib/stages'
import { mergeOrder, moveJobToStage, reorderJobs, setJobStatus } from '../lib/jobActions'
import { summarizeJob, type JobSummary } from '../lib/views'
import { startTimer } from '../lib/timer'
import { JOB_STATUS_LABEL, type JobStatus } from '../lib/types'
import { downloadCSV, fmtDate, fmtHours, fmtMoney } from '../lib/utils'
import { pref, setPref } from '../lib/theme'
import './jobs.css'

type Show = 'open' | 'active' | 'hold' | 'closed' | 'all'
type View = 'board' | 'list'
type Sort = 'priority' | 'due' | 'name' | 'client' | 'unbilled'

const SHOW_LABEL: Record<Show, string> = { open: 'Open jobs', active: 'Active only', hold: 'On hold', closed: 'Complete & cancelled', all: 'All jobs' }

function showMatches(show: Show, status: JobStatus) {
  switch (show) {
    case 'open': return status === 'active' || status === 'on_hold'
    case 'active': return status === 'active'
    case 'hold': return status === 'on_hold'
    case 'closed': return status === 'complete' || status === 'cancelled' || status === 'archived'
    case 'all': return true
  }
}

export function Jobs() {
  const store = useData()
  const edit = useEditors()
  const [params, setParams] = useSearchParams()
  const rawView = params.get('view')
  // Addresses from the previous version: table/sheet were lists; gantt/calendar now live in Schedule.
  const view = (rawView === 'list' || rawView === 'table' || rawView === 'sheet' ? 'list' : rawView === 'board' ? 'board' : pref<View>('jobs.view', 'board')) as View
  const show = (params.get('show') as Show) in SHOW_LABEL ? params.get('show') as Show : 'open'
  const q = params.get('q') ?? ''
  const clientId = params.get('client') ?? ''
  const stageFilter = (STAGES as string[]).includes(params.get('stage') ?? '') ? params.get('stage') as Stage : null
  const sort = (params.get('sort') as Sort) || 'priority'
  const patch = (next: Record<string, string | null>) => setParams(p => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(next)) { if (v == null || v === '') n.delete(k); else n.set(k, v) }
    return n
  }, { replace: true })
  const setView = (v: View) => { setPref('jobs.view', v); patch({ view: v }) }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return store.jobs
      .filter(j => showMatches(view === 'board' && (show === 'closed' || show === 'all') ? 'open' : show, j.status))
      .filter(j => !clientId || j.client_id === clientId)
      .filter(j => {
        if (!needle) return true
        const c = store.clients.find(x => x.id === j.client_id)
        return [j.name, j.job_number, j.address, j.description, c?.name, c?.contact_name].some(v => v?.toLowerCase().includes(needle))
      })
      .map(j => summarizeJob(store, j))
      .filter(r => !stageFilter || (r.job.status === 'active' && r.stage.stage === stageFilter))
  }, [store, q, clientId, show, view, stageFilter])

  const counts = useMemo(() => ({
    active: store.jobs.filter(j => j.status === 'active').length,
    hold: store.jobs.filter(j => j.status === 'on_hold').length,
  }), [store.jobs])
  const filtered = Boolean(q || clientId || stageFilter || show !== 'open')

  if (rawView === 'gantt') return <Navigate to="/schedule?view=timeline" replace />
  if (rawView === 'calendar') return <Navigate to="/schedule?view=month" replace />
  return <div className="jobs-page">
    <div className="page-head">
      <div className="titles">
        <h1>Jobs</h1>
        <p className="lede">{counts.active} active · {counts.hold} on hold{view === 'board' ? ' — drag a job to move it to its next stage' : ' — drag ⋮⋮ to set your priority order'}</p>
      </div>
      <div className="actions">
        <Segmented label="View" value={view} onChange={setView} options={[{ value: 'board', label: 'Board', icon: <Columns3 size={15} /> }, { value: 'list', label: 'List', icon: <List size={15} /> }]} />
        <button className="btn primary" onClick={() => edit.job()}><Plus size={16} /> New job</button>
      </div>
    </div>

    <div className="toolbar">
      <div className="input-wrap grow" style={{ maxWidth: 360 }}>
        <Search size={16} />
        <input className="input" value={q} onChange={e => patch({ q: e.target.value })} placeholder="Search name, number, client, address…" aria-label="Search jobs" />
      </div>
      <select className="input" style={{ width: 'auto', maxWidth: 220 }} value={clientId} onChange={e => patch({ client: e.target.value })} aria-label="Client">
        <option value="">All clients</option>
        {store.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="input" style={{ width: 'auto' }} value={show} onChange={e => patch({ show: e.target.value === 'open' ? null : e.target.value })} aria-label="Which jobs">
        {(Object.keys(SHOW_LABEL) as Show[]).filter(s => view === 'list' || s === 'open' || s === 'active' || s === 'hold').map(s => <option key={s} value={s}>{SHOW_LABEL[s]}</option>)}
      </select>
      {stageFilter && <button className="btn sm soft" onClick={() => patch({ stage: null })}>{STAGE_LABEL[stageFilter]} <X size={14} /></button>}
      {filtered && <button className="btn ghost sm" onClick={() => setParams(view === 'list' ? { view } : {}, { replace: true })}>Clear filters</button>}
      {view === 'list' && <>
        <div className="grow" />
        <select className="input sm" style={{ width: 'auto' }} value={sort} onChange={e => patch({ sort: e.target.value === 'priority' ? null : e.target.value })} aria-label="Sort by">
          <option value="priority">Sort: Priority</option><option value="due">Sort: Next due date</option><option value="name">Sort: Name</option><option value="client">Sort: Client</option><option value="unbilled">Sort: Ready to bill</option>
        </select>
        <button className="btn sm" onClick={() => exportCsv(rows)}><Download size={15} /> CSV</button>
      </>}
    </div>

    {store.jobs.length === 0
      ? <div className="card"><Empty icon={<Briefcase size={22} />} title="No jobs yet" action={<button className="btn primary" onClick={() => edit.job()}><Plus size={16} /> Create your first job</button>}>Each job gets standard phases automatically: bidding, design, plan check and construction.</Empty></div>
      : view === 'board' ? <Board rows={rows} /> : <JobList rows={rows} sort={sort} filtered={filtered} />}
  </div>
}

/* ---------------- Board ---------------- */

function Board({ rows }: { rows: JobSummary[] }) {
  const store = useData()
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const active = rows.filter(r => r.job.status === 'active')
  const held = rows.filter(r => r.job.status === 'on_hold')
  const byStage = (s: Stage) => active.filter(r => r.stage.stage === s)
  const dragged = rows.find(r => r.job.id === dragging)

  function onStart(e: DragStartEvent) { setDragging(String(e.active.id)) }
  async function onEnd(e: DragEndEvent) {
    setDragging(null)
    const row = rows.find(r => r.job.id === e.active.id)
    const target = e.over?.id as Stage | 'hold' | undefined
    if (!row || !target) return
    if (target === 'hold') { if (row.job.status !== 'on_hold') await setJobStatus(store, row.job, 'on_hold'); return }
    if (row.job.status === 'on_hold') await store.update('jobs', row.job.id, { status: 'active' })
    if (row.stage.stage !== target || row.job.status === 'on_hold') await moveJobToStage(store, row.job, target)
  }

  const jump = (id: string) => document.getElementById(`col-${id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  return <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={e => void onEnd(e)} onDragCancel={() => setDragging(null)}>
    <nav className="stage-nav" aria-label="Jump to stage">
      {STAGES.map(s => <button key={s} data-stage={s} onClick={() => jump(s)}><span className="dot" />{STAGE_LABEL[s]} <span className="count">{byStage(s).length}</span></button>)}
      {held.length > 0 && <button data-stage="hold" onClick={() => jump('hold')}><span className="dot" />On hold <span className="count">{held.length}</span></button>}
    </nav>
    <div className="board" role="list" aria-label="Pipeline">
      {STAGES.map(s => <Column key={s} id={s} title={STAGE_LABEL[s]} hint={STAGE_HINT[s]} stage={s} rows={byStage(s)} />)}
      <Column id="hold" title="On hold" hint="Paused — not counted in your workload" stage="hold" rows={held} />
    </div>
    <DragOverlay dropAnimation={null}>{dragged && <JobCard row={dragged} overlay />}</DragOverlay>
  </DndContext>
}

function Column({ id, title, hint, stage, rows }: { id: string; title: string; hint: string; stage: Stage | 'hold'; rows: JobSummary[] }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const fees = rows.reduce((s, r) => s + (r.job.fee ?? 0), 0)
  return <section ref={setNodeRef} id={`col-${id}`} className={`board-col ${isOver ? 'over' : ''}`} data-stage={stage} role="listitem" aria-label={`${title}: ${rows.length} jobs`}>
    <header className="board-col-head" title={hint}>
      <span className="dot" /><h2>{title}</h2><span className="count">{rows.length}</span>
      {fees > 0 && <span className="col-fee num" title="Total agreed fees in this column">{fmtMoney(fees)} in fees</span>}
    </header>
    <div className="board-col-body">
      {rows.map(r => <DraggableCard key={r.job.id} row={r} />)}
      {!rows.length && <div className="board-empty">{stage === 'hold' ? 'Drop a job here to pause it' : 'No jobs'}</div>}
    </div>
  </section>
}

function DraggableCard({ row }: { row: JobSummary }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.job.id })
  return <div ref={setNodeRef} {...attributes} {...listeners} className={`drag-wrap ${isDragging ? 'is-dragging' : ''}`} aria-roledescription="draggable job" aria-label={row.job.name}>
    <JobCard row={row} />
  </div>
}

function JobCard({ row, overlay }: { row: JobSummary; overlay?: boolean }) {
  const navigate = useNavigate()
  const { job, client, stage, nextTask, nextDeadline, hours, estimate, money, planCheck } = row
  const held = job.status === 'on_hold'
  return <article className={`job-card ${overlay ? 'overlay' : ''} ${held ? 'held' : ''}`} onClick={() => navigate(`/jobs/${job.id}`)}>
    <div className="job-card-top">
      <span className="job-num">{job.job_number || '—'}</span>
      <span className="grow" />
      {!overlay && <JobMenu row={row} />}
    </div>
    <Link to={`/jobs/${job.id}`} className="job-card-name" onClick={e => e.stopPropagation()}>{job.name}</Link>
    {client && <div className="job-card-client">{client.name}</div>}
    {nextTask && <div className="job-card-next"><span className="muted">Next:</span> {nextTask.title}</div>}
    {estimate > 0 && <div className="job-card-hours"><Progress value={hours} max={estimate} /><span className="tiny muted num">{fmtHours(hours)} / {fmtHours(estimate)}</span></div>}
    <div className="job-card-foot">
      {nextDeadline ? <DueText date={nextDeadline.date} /> : <span className="tiny muted">No dates</span>}
      {stage.state === 'waiting' && <span className="badge warn" title="Waiting on someone (client, architect, county…)"><Hourglass size={11} />Waiting</span>}
      {stage.stage === 'plan_check' && planCheck && planCheck.total > 0 && !planCheck.round.sent_date && (planCheck.open
        ? <span className="badge accent" title="Plan check comments not yet answered"><ClipboardCheck size={11} />{planCheck.open} of {planCheck.total} open</span>
        : <span className="badge ok" title="Every comment is answered — the response letter is ready"><ClipboardCheck size={11} />Responses ready</span>)}
      <span className="grow" />
      {money.unbilledAmount > 0.5 && <span className="badge ok" title="Billable work not yet invoiced">{fmtMoney(money.unbilledAmount)} to bill</span>}
      {money.outstanding > 0.5 && <span className="badge warn" title="Invoiced, not yet paid">{fmtMoney(money.outstanding)} due</span>}
      {held && <span className="badge"><PauseCircle size={11} />On hold</span>}
      {stage.clientChanges && <span className="stage-chip" data-stage="client_changes" style={{ height: 20, fontSize: 11 }}>Client changes</span>}
    </div>
    {stage.state === 'not_started' && stage.stage !== 'ready' && stage.stage !== 'bidding' && <div className="job-card-note">{STAGE_LABEL[stage.stage]} not started yet</div>}
  </article>
}

function JobMenu({ row }: { row: JobSummary }) {
  const store = useData()
  const edit = useEditors()
  const { job, stage } = row
  const items: MenuEntry[] = [
    { section: 'Move to' },
    ...STAGES.map(s => ({ label: STAGE_LABEL[s], icon: <span className="stage-dot" data-stage={s} />, checked: job.status === 'active' && stage.stage === s, onSelect: async () => { if (job.status !== 'active') await store.update('jobs', job.id, { status: 'active' }); await moveJobToStage(store, job, s) } })),
    'sep',
    ...(job.status === 'active' ? [{ label: 'Start timer', icon: <Play size={15} />, onSelect: () => void startTimer(store, { job_id: job.id }) }] : []),
    { label: 'Add task', icon: <Plus size={15} />, onSelect: () => edit.task(undefined, { job_id: job.id }) },
    { label: 'Log hours', icon: <ArrowRightLeft size={15} />, onSelect: () => edit.time(undefined, { job_id: job.id }) },
    'sep',
    ...(job.status === 'on_hold'
      ? [{ label: 'Resume (make active)', icon: <Play size={15} />, onSelect: () => void setJobStatus(store, job, 'active') }]
      : [{ label: 'Put on hold', icon: <PauseCircle size={15} />, onSelect: () => void setJobStatus(store, job, 'on_hold') }]),
    { label: 'Mark complete', onSelect: () => void setJobStatus(store, job, 'complete') },
    { label: 'Cancel job', danger: true, onSelect: () => void setJobStatus(store, job, 'cancelled') },
  ]
  return <Menu label={`Actions for ${job.name}`} items={items} trigger={p => <button className="btn ghost icon xs" aria-label={`Actions for ${job.name}`} onPointerDown={e => e.stopPropagation()} {...p}><Ellipsis size={16} /></button>} />
}

/* ---------------- List ---------------- */

function JobList({ rows, sort, filtered }: { rows: JobSummary[]; sort: Sort; filtered: boolean }) {
  const store = useData()
  const sorted = useMemo(() => {
    const r = [...rows]
    const name = (x: JobSummary) => x.job.name.toLowerCase()
    switch (sort) {
      case 'due': return r.sort((a, b) => (a.nextDeadline?.date ?? '9999').localeCompare(b.nextDeadline?.date ?? '9999'))
      case 'name': return r.sort((a, b) => name(a).localeCompare(name(b)))
      case 'client': return r.sort((a, b) => (a.client?.name ?? '').localeCompare(b.client?.name ?? '') || a.job.priority - b.job.priority)
      case 'unbilled': return r.sort((a, b) => b.money.unbilledAmount - a.money.unbilledAmount)
      default: return r.sort((a, b) => a.job.priority - b.job.priority || a.job.created_at.localeCompare(b.job.created_at))
    }
  }, [rows, sort])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const canReorder = sort === 'priority'

  async function onEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const from = sorted.findIndex(r => r.job.id === e.active.id), to = sorted.findIndex(r => r.job.id === e.over!.id)
    const visible = arrayMove(sorted.map(r => r.job), from, to)
    const queue = store.jobs.filter(j => j.status === 'active' || j.status === 'on_hold')
    const merged = mergeOrder(queue, visible.filter(j => queue.some(q => q.id === j.id)))
    const closedNumbers = store.jobs.filter(j => j.status !== 'active' && j.status !== 'on_hold').map(j => j.priority)
    if (await reorderJobs(store, merged, closedNumbers)) store.toast('Priority order saved')
  }

  if (!sorted.length) return <div className="card"><Empty title="No jobs match">{filtered ? 'Try clearing the filters.' : 'Add a job to get started.'}</Empty></div>
  return <div className="card job-table-card">
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={e => void onEnd(e)}>
      <SortableContext items={sorted.map(r => r.job.id)} strategy={verticalListSortingStrategy} disabled={!canReorder}>
        <div className="job-table" role="table" aria-label="Jobs">
          <div className="jt-head" role="row">
            <span role="columnheader" className="jt-grip"><span className="sr-only">Order</span></span>
            <span role="columnheader">Job</span>
            <span role="columnheader" className="hide-sm">Stage</span>
            <span role="columnheader" className="hide-md">Next step</span>
            <span role="columnheader" className="hide-sm">Next date</span>
            <span role="columnheader" className="hide-md">Hours</span>
            <span role="columnheader" className="hide-sm right">To bill</span>
            <span role="columnheader" className="hide-sm">Status</span>
          </div>
          {sorted.map((r, i) => <ListRow key={r.job.id} row={r} index={i} canReorder={canReorder} />)}
        </div>
      </SortableContext>
    </DndContext>
    {!canReorder && <div className="card-foot"><span className="tiny muted">Switch the sort to Priority to drag jobs into a new order.</span></div>}
  </div>
}

function ListRow({ row, index, canReorder }: { row: JobSummary; index: number; canReorder: boolean }) {
  const store = useData()
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.job.id, disabled: !canReorder })
  const { job, client, stage, nextTask, nextDeadline, hours, estimate, money } = row
  const closed = job.status !== 'active' && job.status !== 'on_hold'
  return <div ref={setNodeRef} role="row" className={`jt-row ${isDragging ? 'is-dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }} onClick={() => navigate(`/jobs/${job.id}`)}>
    <span role="cell" className="jt-grip">
      {canReorder ? <button className="grip" aria-label={`Reorder ${job.name}`} {...attributes} {...listeners} onClick={e => e.stopPropagation()}><GripVertical size={16} /></button> : null}
      <span className="jt-rank num">{index + 1}</span>
    </span>
    <span role="cell" className="jt-job">
      <Link to={`/jobs/${job.id}`} className="strong" onClick={e => e.stopPropagation()}>{job.name}</Link>
      <span className="tiny muted">{[job.job_number, client?.name].filter(Boolean).join(' · ')}</span>
      <span className="show-sm" style={{ marginTop: 4 }}>{job.status === 'active' ? <StageChip stage={stage.stage} /> : <span className="badge">{JOB_STATUS_LABEL[job.status]}</span>}</span>
    </span>
    <span role="cell" className="hide-sm">{closed ? <span className="badge">{JOB_STATUS_LABEL[job.status]}</span> : <StageChip stage={stage.stage} hold={job.status === 'on_hold'} />}</span>
    <span role="cell" className="hide-md small truncate">{nextTask ? nextTask.title : <span className="muted">—</span>}</span>
    <span role="cell" className="hide-sm">{nextDeadline ? <DueText date={nextDeadline.date} /> : <span className="muted small">—</span>}</span>
    <span role="cell" className="hide-md jt-hours">{estimate > 0 ? <><Progress value={hours} max={estimate} /><span className="tiny muted num">{fmtHours(hours)} / {fmtHours(estimate)}</span></> : <span className="tiny muted num">{hours ? fmtHours(hours) : '—'}</span>}</span>
    <span role="cell" className="hide-sm right num">{money.unbilledAmount > 0.5 ? <Link to={`/jobs/${job.id}?tab=billing`} onClick={e => e.stopPropagation()} className="strong ok-text">{fmtMoney(money.unbilledAmount)}</Link> : <span className="muted">—</span>}</span>
    <span role="cell" className="hide-sm" onClick={e => e.stopPropagation()}>
      <select className={`status-select st-${job.status}`} value={job.status} aria-label={`Status of ${job.name}`} onChange={e => void setJobStatus(store, job, e.target.value as JobStatus)}>
        {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map(s => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}
      </select>
    </span>
  </div>
}

function exportCsv(rows: JobSummary[]) {
  downloadCSV('jobs.csv',
    ['Priority', 'Job #', 'Job', 'Client', 'Status', 'Stage', 'Next task', 'Next date', 'Hours logged', 'Non-billable hours', 'Hours estimated', 'Fee', 'Ready to bill', 'Awaiting payment', 'Balance', 'Recorded fees', 'Earned per hour'],
    rows.map(r => [r.job.priority, r.job.job_number, r.job.name, r.client?.name ?? '', JOB_STATUS_LABEL[r.job.status], STAGE_LABEL[r.stage.stage], r.nextTask?.title ?? '', r.nextDeadline ? fmtDate(r.nextDeadline.date, 'long') : '', Math.round(r.hours * 100) / 100, Math.round(r.money.nonBillableHours * 100) / 100, r.estimate, r.job.fee, Math.round(r.money.unbilledAmount * 100) / 100, Math.round(r.money.outstanding * 100) / 100, Math.round(r.money.balance * 100) / 100, Math.round(r.money.feeRevenue * 100) / 100, r.money.effectiveHourlyRate == null ? null : Math.round(r.money.effectiveHourlyRate * 100) / 100]))
}
