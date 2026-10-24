// One job: where it stands, what's next, the phases, hours, money and notes.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Calculator, Camera, Check, ChevronRight, ClipboardCheck, Clock, Ellipsis, FileText, Mail, MapPin, MessageSquare, Pencil, Phone, Play, Plus, Receipt, Square, Trash2, Wallet,
} from 'lucide-react'
import { useData } from '../lib/store'
import { EMAIL_TARGET, useEmailLink } from '../lib/email'
import { useEditors } from '../components/editors'
import { TaskRow } from '../components/TaskRow'
import { JobMoneyPanel } from '../components/JobMoneyPanel'
import { JobPlanCheck } from '../components/JobPlanCheck'
import { JobSiteVisits } from '../components/JobSiteVisits'
import { planCheckStatus } from '../lib/planCheck'
import { DueText, Empty, Menu, NumberInput, Progress, useConfirm, type MenuEntry } from '../components/ui'
import { STAGES, STAGE_LABEL, type Stage } from '../lib/stages'
import { moveJobToStage, setJobStatus } from '../lib/jobActions'
import { allHours, entryHours, hoursForPhase, HOUR_STATUS_LABEL } from '../lib/calc'
import { jobPhaseGroups, phaseLabel } from '../lib/phases'
import { runningTimer, startTimer, elapsedLabel } from '../lib/timer'
import { useStopTimer } from '../components/useTimerActions'
import { summarizeJob, taskOrder } from '../lib/views'
import { FEE_PHASES, FEE_PHASE_LABEL, jobActuals, latestQuote, quotedHours } from '../lib/estimate'
import { CLOSEOUT_REASONS, JOB_STATUS_LABEL, PHASE_STATUS_LABEL, type JobStatus, type Phase, type PhaseStatus } from '../lib/types'
import { fmtDate, fmtDateTime, fmtHourlyRate, fmtHours, fmtMoney, fmtSigned, sum, todayISO } from '../lib/utils'
import './job.css'

type Tab = 'overview' | 'time' | 'billing' | 'plancheck' | 'visits' | 'notes'
const TABS: Tab[] = ['overview', 'time', 'billing', 'plancheck', 'visits', 'notes']

export function JobPage() {
  const { id = '' } = useParams()
  const store = useData()
  const edit = useEditors()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const job = store.jobs.find(j => j.id === id)
  const tab = ((TABS as string[]).includes(params.get('tab') ?? '') ? params.get('tab') : 'overview') as Tab
  const setTab = (t: Tab) => setParams(p => { const n = new URLSearchParams(p); if (t === 'overview') n.delete('tab'); else n.set('tab', t); n.delete('task'); return n }, { replace: true })

  // Deep link: /jobs/:id?task=<id> opens that task.
  const opened = useRef<string | null>(null)
  useEffect(() => {
    const taskId = params.get('task')
    if (!taskId || opened.current === taskId) return
    const task = store.tasks.find(t => t.id === taskId && t.job_id === id)
    if (task) { opened.current = taskId; edit.task(task) }
  }, [params, store.tasks, id, edit])

  const summary = useMemo(() => job ? summarizeJob(store, job) : null, [store, job])
  const stopTimer = useStopTimer()
  if (!job || !summary) return <div className="card" style={{ marginTop: 20 }}><Empty title="Job not found" action={<Link className="btn" to="/jobs">Back to jobs</Link>}>It may have been deleted.</Empty></div>

  const { client, stage, money } = summary
  const notes = store.comments.filter(c => c.job_id === job.id)
  const planCheck = planCheckStatus(store, job.id)
  const visits = store.siteVisits.filter(v => v.job_id === job.id).length
  const timer = runningTimer(store)
  const timerHere = timer?.job_id === job?.id ? timer : undefined
  const open = job.status === 'active' || job.status === 'on_hold'

  const more: MenuEntry[] = [
    { label: 'Edit job details', icon: <Pencil size={15} />, onSelect: () => edit.job(job) },
    { label: 'Log hours', icon: <Clock size={15} />, onSelect: () => edit.time(undefined, { job_id: job.id }) },
    { label: 'Add charge', icon: <FileText size={15} />, onSelect: () => edit.charge(undefined, job.id) },
    { label: 'Record deposit', icon: <Wallet size={15} />, onSelect: () => edit.deposit(undefined, job.id) },
    { label: 'New invoice', icon: <Receipt size={15} />, onSelect: () => edit.invoice(job.id) },
    { label: 'Estimate fee', icon: <Calculator size={15} />, onSelect: () => navigate(`/money?tab=estimate&job=${job.id}`) },
    'sep',
    { label: 'Schedule a site visit', icon: <MapPin size={15} />, onSelect: () => edit.task(undefined, { job_id: job.id, is_site_visit: true, due_date: todayISO() }) },
    { label: 'Site visit report', icon: <Camera size={15} />, onSelect: () => navigate(`/jobs/${job.id}/visits/new`) },
    { label: 'Plan check comments', icon: <ClipboardCheck size={15} />, onSelect: () => setTab('plancheck') },
  ]

  return <div className="job-page">
    <div className="crumbs"><Link to="/jobs">Jobs</Link><ChevronRight size={14} />{client ? <Link to={`/clients/${client.id}`}>{client.name}</Link> : <span>No client</span>}</div>
    <div className="page-head job-head">
      <div className="titles">
        <h1>{job.name}
          <select className={`status-select st-${job.status}`} value={job.status} aria-label="Job status" onChange={e => void setJobStatus(store, job, e.target.value as JobStatus)}>
            {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map(s => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}
          </select>
        </h1>
        <p className="lede job-meta">
          {job.job_number && <span>#{job.job_number}</span>}
          {job.address && <a href={`https://maps.google.com/?q=${encodeURIComponent(job.address)}`} target="_blank" rel="noreferrer"><MapPin size={13} />{job.address}</a>}
          {job.due_date && <span>Due {fmtDate(job.due_date, 'long')}</span>}
          {(t => t && <span>{t.name}</span>)(store.jobTypes.find(t => t.id === job.job_type_id))}
          {job.fee != null ? <span>Fee {fmtMoney(job.fee)}</span> : open && <Link to={`/money?tab=estimate&job=${job.id}`}><Calculator size={13} />Estimate fee</Link>}
        </p>
      </div>
      <div className="actions">
        {timerHere
          ? <button className="btn ok" onClick={() => void stopTimer(timerHere)}><Square size={13} fill="currentColor" /> Stop · {elapsedLabel(timerHere.started_at!)}</button>
          : job.status === 'active' && <button className="btn" onClick={() => void startTimer(store, { job_id: job.id })}><Play size={15} /> Start timer</button>}
        <button className="btn primary" onClick={() => edit.task(undefined, { job_id: job.id })}><Plus size={16} /> Task</button>
        <Menu label="More actions" items={more} trigger={p => <button className="btn icon" aria-label="More actions" {...p}><Ellipsis size={18} /></button>} />
      </div>
    </div>

    {job.status === 'active' || job.status === 'on_hold'
      ? <StageStepper jobId={job.id} current={stage.stage} held={job.status === 'on_hold'} clientChanges={Boolean(stage.clientChanges)} />
      : <div className="closed-note">{job.status === 'complete' ? <Check size={16} /> : null}This job is {JOB_STATUS_LABEL[job.status].toLowerCase()}. Its hours, invoices and notes are kept. {job.status !== 'archived' && <button className="btn sm" onClick={() => void setJobStatus(store, job, 'active')}>Reopen</button>}</div>}

    <div className="tabs" role="tablist">
      {([['overview', 'Overview'], ['time', `Hours & charges`], ['billing', 'Billing'],
        ['plancheck', `Plan check${planCheck?.open ? ` (${planCheck.open} open)` : ''}`], ['visits', `Site visits${visits ? ` (${visits})` : ''}`],
        ['notes', `Notes${notes.length ? ` (${notes.length})` : ''}`]] as [Tab, string][]).map(([t, label]) =>
        <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{label}</button>)}
    </div>

    <div className="tab-body">
      {tab === 'overview' && <Overview jobId={job.id} />}
      {tab === 'time' && <JobTime jobId={job.id} />}
      {tab === 'billing' && <JobMoneyPanel jobId={job.id} />}
      {tab === 'plancheck' && <JobPlanCheck jobId={job.id} />}
      {tab === 'visits' && <JobSiteVisits jobId={job.id} />}
      {tab === 'notes' && <JobNotes jobId={job.id} />}
    </div>
    {!open && money.unbilledAmount > 0.5 && tab !== 'billing' && <p className="small muted mt">{fmtMoney(money.unbilledAmount)} of work on this job hasn't been billed yet. <button className="btn ghost xs" onClick={() => setTab('billing')}>Open billing</button></p>}
  </div>
}

/** Old billing links (/money/job/:id) now open the job's Billing tab. */
export function JobMoneyRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/jobs/${id}?tab=billing`} replace />
}

/* ---------------- Stage stepper ---------------- */

function StageStepper({ jobId, current, held, clientChanges }: { jobId: string; current: Stage; held: boolean; clientChanges: boolean }) {
  const store = useData()
  const job = store.jobs.find(j => j.id === jobId)!
  const idx = STAGES.indexOf(current)
  const phases = jobPhaseGroups(store.phases, jobId).workflow
  const phaseFor = (s: Stage) => phases.find(p => p.kind === (s === 'ready' ? '__none' : s))
  const cc = phases.find(p => p.kind === 'client_changes')
  return <div className="stepper-wrap">
    <ol className="stepper" aria-label="Job stage">
      {STAGES.map((s, i) => {
        const state = i < idx ? 'done' : i === idx ? 'current' : 'todo'
        const p = phaseFor(s)
        return <li key={s} data-stage={s} className={`step ${state} ${held && state === 'current' ? 'held' : ''}`}>
          <button onClick={() => { if (s !== current) void moveJobToStage(store, job, s) }} aria-current={state === 'current' ? 'step' : undefined} title={s === current ? 'Current stage' : `Move to ${STAGE_LABEL[s]}`}>
            <span className="step-dot">{state === 'done' ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            <span className="step-text">
              <span className="step-label">{STAGE_LABEL[s]}</span>
              <span className="step-sub">{state === 'current' ? (held ? 'On hold' : p?.status === 'waiting' ? 'Waiting on someone' : p?.status === 'not_started' ? 'Not started' : 'In progress') : p?.due_date && state === 'todo' ? `Due ${fmtDate(p.due_date)}` : state === 'done' ? 'Done' : ''}</span>
            </span>
          </button>
        </li>
      })}
    </ol>
    {cc && <button className={`cc-toggle ${clientChanges ? 'on' : ''}`} data-stage="client_changes" onClick={() => void store.update('phases', cc.id, { status: clientChanges ? 'complete' : 'in_progress' })} title="Client-requested changes can happen during any stage">
      <span className="dot" />{clientChanges ? 'Client changes in progress' : 'Client changes'}
    </button>}
  </div>
}

/* ---------------- Overview ---------------- */

function Overview({ jobId }: { jobId: string }) {
  const store = useData()
  const emailLink = useEmailLink()
  const edit = useEditors()
  const job = store.jobs.find(j => j.id === jobId)!
  const summary = summarizeJob(store, job)
  const { client, money, hours, estimate } = summary
  const [showDone, setShowDone] = useState(false)
  const tasks = store.tasks.filter(t => t.job_id === jobId)
  const openTasks = tasks.filter(t => t.status !== 'done').sort(taskOrder)
  const doneTasks = tasks.filter(t => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
  const today = todayISO()
  const planned = store.schedule.filter(s => s.job_id === jobId && s.date >= today).slice(0, 6)

  return <div className="job-grid">
    <div className="stack loose">
      <section className="card">
        <div className="card-head"><h2>Tasks <span className="count">{openTasks.length}</span></h2>
          <div className="row"><button className="btn ghost sm" onClick={() => setShowDone(s => !s)}>{showDone ? 'Hide done' : `Show done (${doneTasks.length})`}</button><button className="btn sm" onClick={() => edit.task(undefined, { job_id: jobId })}><Plus size={15} /> Add</button></div>
        </div>
        {openTasks.length === 0 && !showDone && <Empty compact title="No open tasks" action={<button className="btn sm soft" onClick={() => edit.task(undefined, { job_id: jobId })}><Plus size={14} /> Add the next step</button>}>What's the next thing to do on this job?</Empty>}
        {openTasks.map(t => <TaskRow key={t.id} task={t} showJob={false} />)}
        {showDone && doneTasks.map(t => <TaskRow key={t.id} task={t} showJob={false} />)}
      </section>

      <PhaseTable jobId={jobId} />
    </div>

    <div className="stack loose">
      <section className="card">
        <div className="card-head"><h2>At a glance</h2></div>
        <div className="card-body glance">
          <div className="glance-row"><span>Hours</span><strong className="num">{fmtHours(hours)}{estimate > 0 && <span className="muted"> / {fmtHours(estimate)}</span>}</strong></div>
          {estimate > 0 && <Progress value={hours} max={estimate} />}
          <div className="glance-row"><span>Ready to bill</span><strong className={`num ${money.unbilledAmount > 0.5 ? 'ok-text' : ''}`}>{fmtMoney(money.unbilledAmount)}</strong></div>
          <div className="glance-row"><span>Awaiting payment</span><strong className="num">{fmtMoney(money.outstanding)}</strong></div>
          <div className="glance-row"><span title="Deposits + invoices − value of the work done">Job balance</span><strong className={`num ${money.balance < -0.5 ? 'danger-text' : money.balance > 0.5 ? 'ok-text' : ''}`}>{fmtSigned(money.balance)}</strong></div>
          <div className="glance-row"><span title="Deposits and invoices ÷ all hours worked (before overhead and tax)">Earned per hour</span><strong className="num">{fmtHourlyRate(money.effectiveHourlyRate)}</strong></div>
        </div>
      </section>

      <QuoteCard jobId={jobId} />

      {client && <section className="card">
        <div className="card-head"><h2>Client</h2><Link className="small" to={`/clients/${client.id}`}>Open</Link></div>
        <div className="card-body contact">
          <div className="strong">{client.name}</div>
          {client.contact_name && <div className="small soft">{client.contact_name}</div>}
          <div className="contact-actions">
            {client.phone && <a className="btn sm" href={`tel:${client.phone}`}><Phone size={14} />{client.phone}</a>}
            {client.email && <a className="btn sm" href={emailLink(client.email, job.name)} {...EMAIL_TARGET}><Mail size={14} />Email</a>}
          </div>
        </div>
      </section>}

      {(job.description || planned.length > 0) && <section className="card">
        {job.description && <><div className="card-head"><h2>Scope</h2><button className="btn ghost xs" onClick={() => edit.job(job)}><Pencil size={13} /> Edit</button></div>
          <div className="card-body"><p className="small soft" style={{ whiteSpace: 'pre-wrap' }}>{job.description}</p></div></>}
        {planned.length > 0 && <><div className="card-head" style={job.description ? { borderTop: '1px solid var(--border)' } : undefined}><h2>Planned hours</h2><Link className="small" to="/schedule">Schedule</Link></div>
          <ul className="list">{planned.map(s => <li key={s.id} className="list-row" style={{ minHeight: 40, padding: '8px 18px' }}>
            <span className="grow small">{fmtDate(s.date, 'long').replace(/, \d{4}$/, '')}</span>
            <span className="tiny muted">{(p => p ? phaseLabel(p) : '')(store.phases.find(p => p.id === s.phase_id))}</span>
            <strong className="num small">{fmtHours(s.hours)}</strong>
          </li>)}</ul></>}
      </section>}
    </div>
  </div>
}

/* ---------------- Quote vs. actual ---------------- */

function QuoteCard({ jobId }: { jobId: string }) {
  const store = useData()
  const job = store.jobs.find(j => j.id === jobId)!
  const quote = latestQuote(store, jobId)
  if (!quote) return null
  const q = quotedHours(quote)
  const a = jobActuals(store, jobId)
  const earlier = store.quotes.filter(x => x.job_id === jobId).length - 1
  const closed = job.status === 'complete' || job.status === 'archived'
  const over = FEE_PHASES.filter(k => a.hours[k] - q[k] >= 1)
  const qTotal = q.design + q.plan_check + q.construction
  const diff = (d: number) => Math.abs(d) < 0.25 ? <span className="muted">on target</span> : <span className={d > 0 ? 'danger-text' : 'ok-text'}>{fmtHours(Math.abs(d))} {d > 0 ? 'over' : 'under'}</span>
  return <section className="card">
    <div className="card-head"><h2>Quote vs. actual</h2><Link className="small" to={`/money?tab=estimate&job=${jobId}`}>Re-estimate</Link></div>
    <div className="card-body stack">
      <div className="small muted">Quoted {fmtMoney(quote.fee)} on {fmtDate(quote.created_at.slice(0, 10))}{earlier > 0 ? ` · ${earlier} earlier quote${earlier === 1 ? '' : 's'} kept` : ''}{quote.fee_note ? ` · "${quote.fee_note}"` : ''}</div>
      <table className="quote-table">
        <thead><tr><th /><th className="num">Quoted</th><th className="num">Actual</th><th className="num">Difference</th></tr></thead>
        <tbody>
          {FEE_PHASES.map(k => <tr key={k}><td>{FEE_PHASE_LABEL[k]}</td><td className="num">{fmtHours(q[k])}</td><td className="num">{fmtHours(a.hours[k])}</td><td className="num">{diff(a.hours[k] - q[k])}</td></tr>)}
          <tr className="total"><td>Total</td><td className="num">{fmtHours(qTotal)}</td><td className="num">{fmtHours(a.total)}</td><td className="num">{diff(a.total - qTotal)}</td></tr>
        </tbody>
      </table>
      {a.clientChanges > 0 && <div className="tiny muted">Client-requested changes: {fmtHours(a.clientChanges)}, billed separately.</div>}
      {a.unphased > 0 && <div className="tiny warn-text">{fmtHours(a.unphased)} logged with no phase are counted as Design. <Link to={`/jobs/${jobId}?tab=time`}>Assign a phase</Link></div>}
      {!closed && over.length > 0 && <div className="form-note warn small">{over.map(k => FEE_PHASE_LABEL[k]).join(' and ')} {over.length === 1 ? 'is' : 'are'} over the quote. If the scope grew, it may be an additional service to price with the client.</div>}
      {closed && <div className="stack">
        <label className="small strong" htmlFor="closeout-reason">{a.total - qTotal >= 1 ? 'What made it take longer?' : 'How did it go?'}</label>
        <select id="closeout-reason" className="input sm" value={job.closeout_reason} onChange={e => void store.update('jobs', jobId, { closeout_reason: e.target.value })}>
          <option value="">Choose a reason…</option>
          {CLOSEOUT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          {job.closeout_reason && !(CLOSEOUT_REASONS as readonly string[]).includes(job.closeout_reason) && <option value={job.closeout_reason}>{job.closeout_reason}</option>}
        </select>
        <label className="switch small"><input type="checkbox" checked={job.use_in_estimates !== false} onChange={e => void store.update('jobs', jobId, { use_in_estimates: e.target.checked })} /> Use this job in future fee estimates</label>
      </div>}
    </div>
  </section>
}

/* ---------------- Phases ---------------- */

const STATUS_ORDER: PhaseStatus[] = ['not_started', 'in_progress', 'waiting', 'complete']

function PhaseTable({ jobId }: { jobId: string }) {
  const store = useData()
  const groups = jobPhaseGroups(store.phases, jobId)
  const [editing, setEditing] = useState<string | null>(null)
  return <section className="card">
    <div className="card-head"><h2>Phases</h2><span className="sub">Estimates, dates and progress for each phase</span></div>
    <div className="phase-list">
      {groups.workflow.map(p => <PhaseRow key={p.id} phase={p} editing={editing === p.id} onEdit={() => setEditing(editing === p.id ? null : p.id)} />)}
      {groups.history.map(p => { const h = hoursForPhase(store.timeEntries, p.id); return h > 0 ? <div key={p.id} className="phase-row history"><span className="grow small muted">{phaseLabel(p)} (earlier queue tracking)</span><span className="tiny muted num">{fmtHours(h)} logged</span></div> : null })}
    </div>
  </section>
}

function PhaseRow({ phase, editing, onEdit }: { phase: Phase; editing: boolean; onEdit: () => void }) {
  const store = useData()
  const logged = hoursForPhase(store.timeEntries, phase.id)
  const stageKey = phase.kind === 'client_changes' ? 'client_changes' : phase.kind
  return <div className={`phase-row ${phase.status}`} data-stage={stageKey}>
    <div className="phase-main">
      <span className="phase-bar" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="phase-name">{phaseLabel(phase)}</div>
        <div className="phase-meta">
          {phase.start_date || phase.due_date ? <span>{phase.start_date ? fmtDate(phase.start_date) : '…'} → {phase.due_date ? <DueText date={phase.due_date} done={phase.status === 'complete'} /> : '…'}</span> : <span className="muted">No dates</span>}
          <span className="num">{fmtHours(logged)}{phase.estimate_hours > 0 ? ` of ${fmtHours(phase.estimate_hours)}` : ' logged'}</span>
        </div>
        {phase.estimate_hours > 0 && <div style={{ marginTop: 6, maxWidth: 260 }}><Progress value={logged} max={phase.estimate_hours} /></div>}
      </div>
      <select className={`phase-status ps-${phase.status}`} value={phase.status} aria-label={`${phase.name} status`} onChange={e => void store.update('phases', phase.id, { status: e.target.value as PhaseStatus })}>
        {STATUS_ORDER.map(s => <option key={s} value={s}>{PHASE_STATUS_LABEL[s]}</option>)}
      </select>
      <button className="btn ghost icon sm" aria-label={`Edit ${phase.name}`} aria-expanded={editing} onClick={onEdit}><Pencil size={15} /></button>
    </div>
    {editing && <PhaseForm phase={phase} onDone={onEdit} />}
    {!editing && phase.notes && <p className="phase-notes">{phase.notes}</p>}
  </div>
}

function PhaseForm({ phase, onDone }: { phase: Phase; onDone: () => void }) {
  const store = useData()
  const [draft, setDraft] = useState({ estimate_hours: phase.estimate_hours as number | null, start_date: phase.start_date, due_date: phase.due_date, notes: phase.notes ?? '' })
  const [busy, setBusy] = useState(false)
  async function save() {
    if (draft.start_date && draft.due_date && draft.due_date < draft.start_date) { store.toast('The due date is before the start date', 'error'); return }
    setBusy(true)
    const ok = await store.update('phases', phase.id, { estimate_hours: draft.estimate_hours ?? 0, start_date: draft.start_date || null, due_date: draft.due_date || null, notes: draft.notes })
    setBusy(false)
    if (ok) { store.toast(`${phase.name} saved`); onDone() }
  }
  return <form className="phase-edit" onSubmit={e => { e.preventDefault(); void save() }}>
    <div className="field"><label>Estimate</label><NumberInput value={draft.estimate_hours} onChange={v => setDraft(d => ({ ...d, estimate_hours: v }))} step={0.5} min={0} suffix="h" /></div>
    <div className="field"><label>Start</label><input className="input" type="date" value={draft.start_date ?? ''} onChange={e => setDraft(d => ({ ...d, start_date: e.target.value || null }))} /></div>
    <div className="field"><label>Due</label><input className="input" type="date" value={draft.due_date ?? ''} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value || null }))} /></div>
    <div className="field span-all"><label>Notes</label><input className="input" value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="e.g. Waiting on county — reviewer Karen L." /></div>
    <div className="row span-all" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn" onClick={onDone}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save phase'}</button></div>
  </form>
}

/* ---------------- Hours & charges ---------------- */

function JobTime({ jobId }: { jobId: string }) {
  const store = useData()
  const edit = useEditors()
  const [filter, setFilter] = useState<'all' | 'billable' | 'nonbillable'>('all')
  const status = useMemo(() => allHours(store), [store])
  const entries = store.timeEntries.filter(e => e.job_id === jobId && (filter === 'all' || (filter === 'billable') === (e.billable !== false)))
  const charges = store.items.filter(i => i.job_id === jobId)
  const phaseName = (id: string | null) => { const p = store.phases.find(x => x.id === id); return p ? phaseLabel(p) : 'General' }
  const total = sum(entries.map(entryHours))
  return <div className="stack loose">
    <section className="card">
      <div className="card-head">
        <h2>Hours <span className="sub">{fmtHours(total)} total</span></h2>
        <div className="row">
          <select className="input sm" style={{ width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Which hours">
            <option value="all">All hours</option><option value="billable">Billable</option><option value="nonbillable">Non-billable</option>
          </select>
          <button className="btn sm" onClick={() => edit.time(undefined, { job_id: jobId })}><Plus size={15} /> Log hours</button>
        </div>
      </div>
      {entries.length === 0 ? <Empty compact icon={<Clock size={20} />} title="No hours yet">Log time you've worked, or start a timer from the top of the page.</Empty> :
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Work</th><th className="hide-sm">Phase</th><th className="num">Hours</th><th className="hide-sm">Billing</th></tr></thead>
          <tbody>{entries.map(e => { const h = status.get(e.id); const running = e.started_at && e.hours == null; return <tr key={e.id} className="clickable" onClick={() => edit.time(e)}>
            <td className="nowrap">{fmtDate(e.date)}</td>
            <td><span className="clamp-2">{e.notes || <span className="muted">—</span>}</span></td>
            <td className="hide-sm small soft">{phaseName(e.phase_id)}</td>
            <td className="num strong">{running ? <span className="badge ok">Running</span> : fmtHours(e.hours)}</td>
            <td className="hide-sm">{e.billable === false ? <span className="badge">Non-billable</span> : h && <span className={`badge money-${h.status}`}>{HOUR_STATUS_LABEL[h.status]}</span>}</td>
          </tr> })}</tbody>
        </table></div>}
    </section>
    <section className="card">
      <div className="card-head"><h2>Charges <span className="sub">expenses, mileage, fees</span></h2><button className="btn sm" onClick={() => edit.charge(undefined, jobId)}><Plus size={15} /> Add charge</button></div>
      {charges.length === 0 ? <Empty compact icon={<FileText size={20} />} title="No charges">Add mileage, printing, permit fees or other costs you bill on this job.</Empty> :
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Date</th><th>Charge</th><th className="num">Amount</th><th className="hide-sm">Billing</th></tr></thead>
          <tbody>{charges.map(i => <tr key={i.id} className="clickable" onClick={() => edit.charge(i)}>
            <td className="nowrap">{fmtDate(i.date)}</td>
            <td>{i.description || i.category}<div className="tiny muted">{i.category}{i.quantity !== 1 ? ` · ${i.quantity} × ${fmtMoney(i.unit_price)}` : ''}</div></td>
            <td className="num strong">{fmtMoney(i.quantity * i.unit_price)}</td>
            <td className="hide-sm">{i.billed ? <span className="badge ok">On invoice</span> : <span className="badge">Not billed</span>}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </div>
}

/* ---------------- Notes ---------------- */

function JobNotes({ jobId }: { jobId: string }) {
  const store = useData()
  const confirm = useConfirm()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const notes = store.comments.filter(c => c.job_id === jobId).sort((a, b) => b.created_at.localeCompare(a.created_at))
  async function add() {
    if (!body.trim() || busy) return
    setBusy(true)
    const ok = await store.insert('comments', { job_id: jobId, user_id: store.me?.id ?? null, body: body.trim() })
    setBusy(false)
    if (ok) setBody('')
  }
  return <section className="card notes-card">
    <form className="note-new" onSubmit={e => { e.preventDefault(); void add() }}>
      <textarea className="input" value={body} onChange={e => setBody(e.target.value)} placeholder="Add a note — calls, decisions, what the reviewer said…" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void add() }} />
      <div className="row between"><span className="tiny muted">Ctrl + Enter to save</span><button className="btn primary sm" disabled={!body.trim() || busy}>{busy ? 'Saving…' : 'Add note'}</button></div>
    </form>
    {notes.length === 0 ? <Empty compact icon={<MessageSquare size={20} />} title="No notes yet">Notes are a running log for this job.</Empty> :
      <ul className="list">{notes.map(n => <li key={n.id} className="note">
        <div className="row between"><span className="tiny muted">{fmtDateTime(n.created_at)}</span>
          <button className="btn ghost icon xs" aria-label="Delete note" onClick={async () => { if (await confirm({ title: 'Delete this note?', confirmLabel: 'Delete', danger: true })) void store.remove('comments', n.id) }}><Trash2 size={14} /></button>
        </div>
        <p style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>
      </li>)}</ul>}
  </section>
}

