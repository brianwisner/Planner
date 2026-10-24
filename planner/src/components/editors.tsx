/* eslint-disable react-refresh/only-export-components */
// Every pop-up form in the app, plus a provider so any page can open one with
// `const edit = useEditors(); edit.task()` without wiring state itself.
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Briefcase, Building2, CalendarDays, Camera, Clock, FileText, Lock, MapPin, Repeat } from 'lucide-react'
import { addDays, format, nextMonday } from 'date-fns'
import { useData, type Store } from '../lib/store'
import type { Client, Deposit, Invoice, Job, JobItem, JobStatus, JobType, Recurrence, Task, TaskStatus, TimeEntry } from '../lib/types'
import { ITEM_CATEGORIES, JOB_STATUS_LABEL, RECURRENCE_LABEL } from '../lib/types'
import { jobCharges, rateFor, workPhase } from '../lib/calc'
import { fmtDate, fmtHours, fmtMoney, todayISO } from '../lib/utils'
import { saveTask } from '../lib/taskActions'
import { guessType } from '../lib/jobTyping'
import { jobPhotoPaths, removePhotoFiles } from '../lib/siteVisits'
import type { InvoiceWorkLink } from '../lib/billingActions'
import { isWorkflowPhase, phaseLabel } from '../lib/phases'
import { STAGE_LABEL, jobStage, stageChanges, type Stage } from '../lib/stages'
import { Field, Modal, NumberInput, Segmented, useConfirm } from './ui'

/* ================= Shared form helpers ================= */

// Hold the draft and block closing/repeated actions until the store confirms
// the write. After a failure, refetch so a retry starts from saved values.
function useRecordForm(name: string, onClose: () => void, restore: () => Promise<void>) {
  const id = useId()
  const busy = useRef(false)
  const [pending, setPending] = useState<'save' | 'delete' | null>(null)
  const [error, setError] = useState('')
  const close = () => { if (!busy.current) onClose() }
  async function run(action: 'save' | 'delete', operation: () => Promise<boolean>) {
    if (busy.current) return
    busy.current = true; setPending(action); setError('')
    try {
      if (await operation()) onClose()
      else {
        await restore()
        setError(`The ${name} was not ${action === 'save' ? 'saved' : 'deleted'}. Your changes are still here — try again.`)
      }
    } catch {
      try { await restore() } catch { /* the store shows connection errors */ }
      setError(`Could not confirm the ${action === 'save' ? 'save' : 'delete'}. Your changes are still here; check the records before trying again.`)
    } finally { busy.current = false; setPending(null) }
  }
  return { id, busy, pending, error, fail: setError, close, run }
}

export function validDate(value: string | null | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  const [y, m, d] = value.split('-').map(Number)
  return date.getFullYear() === y && date.getMonth() + 1 === m && date.getDate() === d
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

function FormError({ message }: { message: string }) {
  if (!message) return null
  return <div className="form-error" role="alert"><AlertCircle size={16} style={{ flex: 'none', marginTop: 1 }} />{message}</div>
}

function Footer({ form, onDelete, deleteLabel = 'Delete', saveLabel = 'Save' }: { form: ReturnType<typeof useRecordForm>; onDelete?: () => void; deleteLabel?: string; saveLabel?: string }) {
  return <>
    {onDelete && <button type="button" className="btn ghost danger left" onClick={onDelete} disabled={form.pending !== null}>{form.pending === 'delete' ? 'Deleting…' : deleteLabel}</button>}
    <button type="button" className="btn" onClick={form.close} disabled={form.pending !== null}>Cancel</button>
    <button type="submit" form={form.id} className="btn primary" disabled={form.pending !== null}>{form.pending === 'save' ? 'Saving…' : saveLabel}</button>
  </>
}

/** Job picker grouped by status, with the client name for context. */
function JobSelect({ store, value, onChange, include, disabled, id }: { store: Pick<Store, 'jobs' | 'clients'>; value: string; onChange: (id: string) => void; include?: (string | null | undefined)[]; disabled?: boolean; id?: string }) {
  const keep = new Set(include?.filter(Boolean))
  const label = (j: Job) => `${j.job_number ? j.job_number + ' · ' : ''}${j.name} — ${store.clients.find(c => c.id === j.client_id)?.name ?? ''}`
  const groups: [string, Job[]][] = [
    ['Active', store.jobs.filter(j => j.status === 'active')],
    ['On hold', store.jobs.filter(j => j.status === 'on_hold')],
    ['Closed', store.jobs.filter(j => (j.status === 'complete' || j.status === 'cancelled' || j.status === 'archived') && keep.has(j.id))],
  ]
  return <select id={id} className="input" value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    {!value && <option value="">Choose a job…</option>}
    {groups.filter(([, jobs]) => jobs.length).map(([name, jobs]) => <optgroup key={name} label={name}>{jobs.map(j => <option key={j.id} value={j.id}>{label(j)}</option>)}</optgroup>)}
  </select>
}

function QuickChips<T extends string | number>({ options, value, onPick, label }: { options: { label: string; value: T }[]; value: T | null; onPick: (v: T) => void; label: string }) {
  return <div className="quick-chips" role="group" aria-label={label}>
    {options.map(o => <button key={String(o.value)} type="button" className={`chip-btn ${o.value === value ? 'on' : ''}`} onClick={() => onPick(o.value)}>{o.label}</button>)}
  </div>
}

function localTime(isoTime: string) {
  const d = new Date(isoTime)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* ================= Task ================= */

export interface TaskDefaults { job_id?: string; phase_id?: string | null; title?: string; due_date?: string | null; is_site_visit?: boolean; status?: TaskStatus }

export function TaskEditor({ task, defaults, onClose }: { task?: Task; defaults?: TaskDefaults; onClose: () => void }) {
  const store = useData()
  const { jobs, phases, remove, me, refresh } = store
  const confirm = useConfirm()
  const form = useRecordForm('task', onClose, () => refresh('tasks'))
  const firstJob = jobs.find(j => j.status === 'active') ?? jobs[0]
  const startJob = task?.job_id ?? defaults?.job_id ?? firstJob?.id ?? ''
  const [d, setD] = useState(() => task ? {
    job_id: task.job_id, phase_id: task.phase_id, title: task.title, description: task.description, status: task.status,
    due_date: task.due_date, time: task.scheduled_at ? localTime(task.scheduled_at) : '09:00', is_site_visit: task.is_site_visit,
    estimate_hours: task.estimate_hours, recurrence: task.recurrence,
  } : {
    job_id: startJob,
    phase_id: defaults?.phase_id !== undefined ? defaults.phase_id : jobStage(phases, startJob).phase?.id ?? null,
    title: defaults?.title ?? '', description: '', status: defaults?.status ?? 'todo' as TaskStatus,
    due_date: defaults?.due_date ?? null as string | null, time: '09:00', is_site_visit: defaults?.is_site_visit ?? false,
    estimate_hours: null as number | null, recurrence: 'none' as Recurrence,
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const persisted = useRef<Task | undefined>(task)
  const jobPhases = phases.filter(p => p.job_id === d.job_id && (isWorkflowPhase(p) || p.id === task?.phase_id))
  const [dateOptions] = useState(() => {
    const now = new Date()
    return [{ label: 'Today', value: iso(now) }, { label: 'Tomorrow', value: iso(addDays(now, 1)) }, { label: 'Next week', value: iso(nextMonday(now)) }]
  })

  async function save() {
    if (form.busy.current) return
    if (!d.title.trim()) { form.fail('Give the task a short title.'); return }
    if (!d.job_id) { form.fail('Choose which job this task belongs to.'); return }
    if (d.due_date && !validDate(d.due_date)) { form.fail('Enter a valid due date, or clear it.'); return }
    const row: Partial<Task> = {
      job_id: d.job_id, phase_id: d.phase_id, title: d.title.trim(), description: d.description, status: d.status,
      due_date: d.due_date, is_site_visit: d.is_site_visit,
      scheduled_at: d.is_site_visit && d.due_date ? new Date(`${d.due_date}T${d.time || '09:00'}:00`).toISOString() : null,
      estimate_hours: d.estimate_hours, recurrence: d.recurrence,
      ...(persisted.current ? {} : { assignee_id: me?.id ?? null }),
    }
    await form.run('save', async () => {
      const result = await saveTask(store, persisted.current, row)
      // A new completed task may save while its successor fails. Retry that
      // same task rather than inserting a second copy.
      if (result.task) persisted.current = result.task
      return result.success
    })
  }
  async function del() {
    if (!task || form.busy.current) return
    if (!await confirm({ title: 'Delete this task?', body: `"${task.title}" will be removed.`, confirmLabel: 'Delete task', danger: true })) return
    await form.run('delete', () => remove('tasks', task.id))
  }

  return <Modal title={task ? 'Edit task' : d.is_site_visit ? 'New site visit' : 'New task'} onClose={form.close} footer={<Footer form={form} onDelete={task ? del : undefined} saveLabel={task ? 'Save' : 'Add task'} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        <input className="input title-input" autoFocus value={d.title} onChange={e => set('title', e.target.value)} placeholder={d.is_site_visit ? 'e.g. Footing inspection' : 'What needs to be done?'} aria-label="Task title" />
        <div className="field-grid">
          <Field label="Job" htmlFor={`${form.id}-job`}>
            <JobSelect id={`${form.id}-job`} store={store} value={d.job_id} include={[task?.job_id, defaults?.job_id]} onChange={id => setD(x => ({ ...x, job_id: id, phase_id: jobStage(phases, id).phase?.id ?? null }))} />
          </Field>
          <Field label="Phase" htmlFor={`${form.id}-phase`}>
            <select id={`${form.id}-phase`} className="input" value={d.phase_id ?? ''} onChange={e => set('phase_id', e.target.value || null)}>
              <option value="">General (no phase)</option>
              {d.phase_id && !jobPhases.some(p => p.id === d.phase_id) && <option value={d.phase_id}>Saved phase</option>}
              {jobPhases.map(p => <option key={p.id} value={p.id}>{phaseLabel(p)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Status">
          <Segmented label="Status" value={d.status} onChange={v => set('status', v)} options={[
            { value: 'todo', label: 'To do' }, { value: 'doing', label: 'Doing' }, { value: 'waiting', label: 'Waiting on someone' }, { value: 'done', label: 'Done' },
          ]} />
        </Field>
        <div className="field-grid">
          <Field label="Due" htmlFor={`${form.id}-due`}>
            <input id={`${form.id}-due`} className="input" type="date" value={d.due_date ?? ''} onChange={e => set('due_date', e.target.value || null)} />
            <QuickChips label="Due date shortcuts" value={d.due_date ?? ''} onPick={v => set('due_date', v || null)} options={[...dateOptions, { label: 'No date', value: '' }]} />
          </Field>
          <Field label="Estimate" htmlFor={`${form.id}-est`}>
            <NumberInput id={`${form.id}-est`} value={d.estimate_hours} onChange={v => set('estimate_hours', v)} step={0.25} min={0} suffix="hours" placeholder="Optional" />
          </Field>
        </div>
        <div className="option-row">
          <label className="switch"><input type="checkbox" checked={d.is_site_visit} onChange={e => set('is_site_visit', e.target.checked)} /><MapPin size={16} className="muted" /> Site visit</label>
          {d.is_site_visit && <div className="row"><label className="small muted" htmlFor={`${form.id}-time`}>at</label><input id={`${form.id}-time`} className="input sm" style={{ width: 120 }} type="time" value={d.time} onChange={e => set('time', e.target.value)} disabled={!d.due_date} /></div>}
          <div className="row grow" style={{ justifyContent: 'flex-end' }}>
            <Repeat size={16} className="muted" />
            <select className="input sm" style={{ width: 'auto' }} value={d.recurrence} onChange={e => set('recurrence', e.target.value as Recurrence)} aria-label="Repeats">
              {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map(r => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
            </select>
          </div>
        </div>
        {d.is_site_visit && !d.due_date && <p className="tiny muted">Pick a date to set the visit time.</p>}
        {task?.is_site_visit && <VisitReportLink task={task} onOpen={onClose} />}
        {d.recurrence !== 'none' && !d.due_date && <p className="tiny warn-text">Repeating tasks need a due date so the next one can be scheduled.</p>}
        <Field label="Notes" htmlFor={`${form.id}-notes`}>
          <textarea id={`${form.id}-notes`} className="input" value={d.description} onChange={e => set('description', e.target.value)} placeholder="Details, who you're waiting on, links…" />
        </Field>
      </fieldset>
    </form>
  </Modal>
}

/* ================= Job ================= */

/** From a scheduled site visit: open its report, or start one. */
function VisitReportLink({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { siteVisits } = useData()
  const navigate = useNavigate()
  const visit = siteVisits.find(v => v.task_id === task.id)
  const go = () => { onOpen(); navigate(visit ? `/jobs/${task.job_id}/visits/${visit.id}` : `/jobs/${task.job_id}/visits/new?task=${task.id}`) }
  return <div className="form-note info"><Camera size={16} style={{ flex: 'none', marginTop: 1 }} />
    <span className="grow">{visit ? 'This visit has a report with your notes and photos.' : 'At the site? Start the report: photos and notes, printed as a site observation report.'}</span>
    <button type="button" className="btn sm" onClick={go}>{visit ? 'Open report' : 'Start report'}</button>
  </div>
}

export interface JobDefaults { client_id?: string }

function suggestJobNumber(jobs: Job[]): string {
  const yy = String(new Date().getFullYear()).slice(2)
  const nums = jobs.map(j => j.job_number).filter(n => n?.startsWith(yy + '-')).map(n => parseInt(n.slice(3), 10)).filter(n => !isNaN(n))
  return `${yy}-${String((nums.length ? Math.max(...nums) : 100) + 1).padStart(3, '0')}`
}

export function JobEditor({ job, defaults, onClose, onCreated, openClient, openJobType }: { job?: Job; defaults?: JobDefaults; onClose: () => void; onCreated?: (j: Job) => void; openClient: (done: (c: Client) => void) => void; openJobType: (done: (t: JobType) => void) => void }) {
  const store = useData()
  const { clients, jobTypes, jobs, insert, update, remove, refresh, toast, fetchWhere } = store
  const confirm = useConfirm()
  const navigate = useNavigate()
  const form = useRecordForm('job', onClose, () => refresh('jobs'))
  const [d, setD] = useState(() => ({
    client_id: job?.client_id ?? defaults?.client_id ?? '',
    job_number: job?.job_number ?? suggestJobNumber(jobs),
    name: job?.name ?? '', description: job?.description ?? '', address: job?.address ?? '',
    status: (job?.status ?? 'active') as JobStatus,
    fee: job?.fee ?? null as number | null,
    job_type_id: job?.job_type_id ?? null as string | null,
    size: job?.size ?? null as number | null,
    use_in_estimates: job?.use_in_estimates !== false,
    estimate_note: job?.estimate_note ?? '',
    start_date: job?.start_date ?? null as string | null,
    due_date: job?.due_date ?? null as string | null,
  }))
  const [startStage, setStartStage] = useState<Stage>('bidding')
  // New jobs get a type guessed from their name and scope until one is picked by hand.
  const [typeTouched, setTypeTouched] = useState(Boolean(job?.job_type_id))
  const guess = useMemo(() => d.job_type_id ? null : guessType(store, `${d.name} ${d.description}`, job?.id), [store, d.job_type_id, d.name, d.description, job?.id])
  const autoType = !job && !typeTouched ? guess?.type.id ?? null : null
  const typeId = d.job_type_id ?? autoType
  const sizeUnit = jobTypes.find(t => t.id === typeId)?.size_unit.trim() ?? ''
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))

  async function save() {
    if (form.busy.current) return
    if (!d.name.trim()) { form.fail('Give the job a name, e.g. "Smith residence addition".'); return }
    if (!d.client_id) { form.fail('Choose a client, or add a new one.'); return }
    if ((d.start_date && !validDate(d.start_date)) || (d.due_date && !validDate(d.due_date))) { form.fail('Enter valid dates, or clear them.'); return }
    if (d.fee != null && d.fee < 0) { form.fail('The fee cannot be negative.'); return }
    if (d.size != null && d.size < 0) { form.fail('The size cannot be negative.'); return }
    const row = { ...d, job_type_id: typeId, name: d.name.trim(), job_number: d.job_number.trim(), address: d.address.trim(), estimate_note: d.use_in_estimates ? '' : d.estimate_note.trim() }
    await form.run('save', async () => {
      if (job) return update('jobs', job.id, row)
      // New jobs go to the end of the queue with a number no other job uses.
      const maxPriority = Math.max(0, ...jobs.map(j => j.priority))
      const created = await insert('jobs', { ...row, priority: maxPriority + 1 })
      if (!created) return false
      if (startStage !== 'bidding') {
        const phases = await fetchWhere('phases', 'job_id', created.id)
        await Promise.all(stageChanges(phases, created.id, startStage).map(c => update('phases', c.id, { status: c.to })))
      }
      toast(`Job created in ${STAGE_LABEL[startStage]}`)
      onCreated?.(created)
      navigate(`/jobs/${created.id}`)
      return true
    })
  }
  async function del() {
    if (!job || form.busy.current) return
    if (!await confirm({ title: `Delete "${job.name}"?`, body: 'This permanently removes the job and everything in it: phases, tasks, hours, charges, deposits, invoices, plan check comments and site visit photos. To keep the history, set the status to Complete or Cancelled instead.', confirmLabel: 'Delete job', danger: true })) return
    await form.run('delete', async () => {
      const photos = jobPhotoPaths(store, job.id)
      const ok = await remove('jobs', job.id)
      if (ok) { await removePhotoFiles(photos); navigate('/jobs') }
      return ok
    })
  }

  return <Modal size="wide" title={job ? 'Edit job' : 'New job'} onClose={form.close} footer={<Footer form={form} onDelete={job ? del : undefined} deleteLabel="Delete job" saveLabel={job ? 'Save' : 'Create job'} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        <div className="field-grid" style={{ gridTemplateColumns: 'minmax(0, 120px) minmax(0, 1fr)' }}>
          <Field label="Job #" htmlFor={`${form.id}-num`}><input id={`${form.id}-num`} className="input" value={d.job_number} onChange={e => set('job_number', e.target.value)} /></Field>
          <Field label="Job name" htmlFor={`${form.id}-name`}><input id={`${form.id}-name`} className="input" autoFocus value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Smith residence — garage addition" /></Field>
        </div>
        <div className="field-grid">
          <Field label="Client" htmlFor={`${form.id}-client`}>
            <div className="row">
              <select id={`${form.id}-client`} className="input" value={d.client_id} onChange={e => set('client_id', e.target.value)}>
                <option value="">{clients.length ? 'Choose a client…' : 'Add a client first →'}</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" className="btn" onClick={() => openClient(c => set('client_id', c.id))}>New</button>
            </div>
          </Field>
          <Field label="Site address" htmlFor={`${form.id}-addr`}><input id={`${form.id}-addr`} className="input" value={d.address} onChange={e => set('address', e.target.value)} placeholder="Street, city" /></Field>
        </div>
        {job ? <Field label="Status">
          <Segmented label="Status" value={d.status} onChange={v => set('status', v)} options={(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map(s => ({ value: s, label: JOB_STATUS_LABEL[s] }))} />
        </Field> : <Field label="Starts in" hint="You can move the job along later by dragging it on the Jobs board.">
          <Segmented label="Starting stage" value={startStage} onChange={setStartStage} options={(['bidding', 'ready', 'design'] as Stage[]).map(s => ({ value: s, label: STAGE_LABEL[s] }))} />
        </Field>}
        <div className="field-grid">
          <Field label="Job type" htmlFor={`${form.id}-type`} hint={autoType && guess
            ? `Guessed from the name${guess.matched.length ? ` (“${guess.matched[0]}”)` : ''}. Change it if it's wrong.`
            : !typeId && guess
              ? <>Looks like {guess.type.name}. <button type="button" className="btn ghost xs" onClick={() => { setTypeTouched(true); set('job_type_id', guess.type.id) }}>Use it</button></>
              : 'The fee estimator learns from finished jobs of each type.'}>
            <div className="row">
              <select id={`${form.id}-type`} className="input" value={typeId ?? ''} onChange={e => { setTypeTouched(true); set('job_type_id', e.target.value || null) }}>
                <option value="">No type</option>
                {jobTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button type="button" className="btn" onClick={() => openJobType(t => { setTypeTouched(true); set('job_type_id', t.id) })}>New</button>
            </div>
          </Field>
          <Field label="Fee" htmlFor={`${form.id}-fee`}><NumberInput id={`${form.id}-fee`} value={d.fee} onChange={v => set('fee', v)} step={50} min={0} prefix="$" placeholder="Optional" /></Field>
        </div>
        <div className="field-grid">
          <Field label="Start" htmlFor={`${form.id}-start`}><input id={`${form.id}-start`} className="input" type="date" value={d.start_date ?? ''} onChange={e => set('start_date', e.target.value || null)} /></Field>
          <Field label="Due" htmlFor={`${form.id}-due`}><input id={`${form.id}-due`} className="input" type="date" value={d.due_date ?? ''} onChange={e => set('due_date', e.target.value || null)} /></Field>
        </div>
        <Field label="Scope / description" htmlFor={`${form.id}-desc`}>
          <textarea id={`${form.id}-desc`} className="input" value={d.description} onChange={e => set('description', e.target.value)} placeholder="Structure type, scope, special conditions…" />
        </Field>
        {(sizeUnit || d.size != null) && <Field label={`Size${sizeUnit ? ` (${sizeUnit})` : ''}`} htmlFor={`${form.id}-size`} hint="Lets the fee estimator compare jobs of different sizes.">
          <NumberInput id={`${form.id}-size`} value={d.size} onChange={v => set('size', v)} step={10} min={0} placeholder="Optional" />
        </Field>}
        {job && (d.status === 'complete' || d.status === 'archived' || !d.use_in_estimates) && <div className="option-row">
          <label className="switch"><input type="checkbox" checked={d.use_in_estimates} onChange={e => set('use_in_estimates', e.target.checked)} /> Use this job in future fee estimates</label>
          {!d.use_in_estimates && <input className="input sm grow" value={d.estimate_note} onChange={e => set('estimate_note', e.target.value)} placeholder="Why not? e.g. stopped after design, hours incomplete" aria-label="Why this job is left out" />}
        </div>}
        {!job && <p className="tiny muted">Each job gets five phases automatically: Bidding, Original design, County / plan-check comments, Construction changes and Client-requested changes.</p>}
      </fieldset>
    </form>
  </Modal>
}

/* ================= Job type ================= */

export function JobTypeEditor({ jobType, onClose, onCreated }: { jobType?: JobType; onClose: () => void; onCreated?: (t: JobType) => void }) {
  const { insert, update, remove, refresh, jobs, jobTypes } = useData()
  const confirm = useConfirm()
  const form = useRecordForm('job type', onClose, () => refresh('job_types'))
  const [d, setD] = useState({
    name: jobType?.name ?? '', notes: jobType?.notes ?? '',
    design_hours: jobType ? Number(jobType.design_hours) : null as number | null,
    plan_check_hours: jobType ? Number(jobType.plan_check_hours) : null as number | null,
    construction_hours: jobType ? Number(jobType.construction_hours) : null as number | null,
    site_visits: jobType ? Number(jobType.site_visits) : null as number | null,
    size_unit: jobType?.size_unit ?? '',
    keywords: jobType?.keywords ?? '',
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const total = (d.design_hours ?? 0) + (d.plan_check_hours ?? 0) + (d.construction_hours ?? 0)
  async function save() {
    if (form.busy.current) return
    const name = d.name.trim()
    if (!name) { form.fail('Name the job type, e.g. "ADU / addition".'); return }
    if (jobTypes.some(t => t.id !== jobType?.id && t.name.trim().toLowerCase() === name.toLowerCase())) { form.fail(`There is already a job type called "${name}".`); return }
    if ([d.design_hours, d.plan_check_hours, d.construction_hours, d.site_visits].some(h => h != null && h < 0)) { form.fail('Hours and visits cannot be negative.'); return }
    const row = { name, notes: d.notes.trim(), design_hours: d.design_hours ?? 0, plan_check_hours: d.plan_check_hours ?? 0, construction_hours: d.construction_hours ?? 0, site_visits: d.site_visits ?? 0, size_unit: d.size_unit.trim(), keywords: d.keywords.split(/[,;\n]/).map(k => k.trim()).filter(Boolean).join(', ') }
    await form.run('save', async () => {
      if (jobType) return update('job_types', jobType.id, row)
      const created = await insert('job_types', row)
      if (created) onCreated?.(created)
      return Boolean(created)
    })
  }
  async function del() {
    if (!jobType || form.busy.current) return
    const count = jobs.filter(j => j.job_type_id === jobType.id).length
    if (!await confirm({ title: `Delete "${jobType.name}"?`, body: count ? `${count} job${count === 1 ? '' : 's'} will keep all their hours and money but have no type, so the estimator stops learning from them.` : 'No jobs use this type.', confirmLabel: 'Delete type', danger: true })) return
    await form.run('delete', () => remove('job_types', jobType.id))
  }
  return <Modal title={jobType ? 'Edit job type' : 'New job type'} onClose={form.close} footer={<Footer form={form} onDelete={jobType ? del : undefined} deleteLabel="Delete type" saveLabel={jobType ? 'Save' : 'Add job type'} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        <Field label="Name" htmlFor={`${form.id}-name`}><input id={`${form.id}-name`} className="input" autoFocus value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. ADU / addition" /></Field>
        <div>
          <div className="field-label">Your usual hours</div>
          <p className="tiny muted" style={{ margin: '4px 0 10px' }}>A best guess is fine. As jobs of this type are finished, the estimator blends in the hours you really logged.</p>
          <div className="field-grid three">
            <Field label="Design" htmlFor={`${form.id}-design`}><NumberInput id={`${form.id}-design`} value={d.design_hours} onChange={v => set('design_hours', v)} step={0.5} min={0} suffix="h" placeholder="0" /></Field>
            <Field label="Plan check" htmlFor={`${form.id}-pc`}><NumberInput id={`${form.id}-pc`} value={d.plan_check_hours} onChange={v => set('plan_check_hours', v)} step={0.5} min={0} suffix="h" placeholder="0" /></Field>
            <Field label="Construction" htmlFor={`${form.id}-con`}><NumberInput id={`${form.id}-con`} value={d.construction_hours} onChange={v => set('construction_hours', v)} step={0.5} min={0} suffix="h" placeholder="0" /></Field>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>Total {fmtHours(total)}. Bidding and client-requested changes aren't part of the fee.</p>
        </div>
        <div className="field-grid">
          <Field label="Usual site visits" htmlFor={`${form.id}-visits`} hint="Hours per visit are set in Settings. Leave them out of Construction above.">
            <NumberInput id={`${form.id}-visits`} value={d.site_visits} onChange={v => set('site_visits', v)} step={1} min={0} placeholder="0" />
          </Field>
          <Field label="Measure size in" htmlFor={`${form.id}-unit`} hint="Optional, e.g. sq ft or ft of wall.">
            <input id={`${form.id}-unit`} className="input" list={`${form.id}-units`} value={d.size_unit} onChange={e => set('size_unit', e.target.value)} placeholder="Not tracked" />
            <datalist id={`${form.id}-units`}><option value="sq ft" /><option value="ft of wall" /><option value="openings" /><option value="units" /></datalist>
          </Field>
        </div>
        <Field label="Key words" htmlFor={`${form.id}-keys`} hint="Separate with commas. A job whose name or scope contains one of these gets this type automatically.">
          <input id={`${form.id}-keys`} className="input" value={d.keywords} onChange={e => set('keywords', e.target.value)} placeholder="e.g. deck, porch, stair, balcony" />
        </Field>
        <Field label="Notes" htmlFor={`${form.id}-notes`}><textarea id={`${form.id}-notes`} className="input" value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="What's included, typical size, things that make it take longer…" /></Field>
      </fieldset>
    </form>
  </Modal>
}

/* ================= Client ================= */

export function ClientEditor({ client, onClose, onCreated }: { client?: Client; onClose: () => void; onCreated?: (c: Client) => void }) {
  const { clients, insert, update, conditionalUpdate, remove, refresh, jobs } = useData()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const form = useRecordForm('client', onClose, () => refresh('clients'))
  const [notesBase, setNotesBase] = useState(client?.notes ?? null)
  const [d, setD] = useState({
    name: client?.name ?? '', contact_name: client?.contact_name ?? '', email: client?.email ?? '', phone: client?.phone ?? '',
    address: client?.address ?? '', notes: client?.notes ?? '',
  })
  const set = (k: keyof typeof d, v: string) => setD(x => ({ ...x, [k]: v }))
  const latestClient = client ? clients.find(c => c.id === client.id) : undefined
  const latestNotes = latestClient ? latestClient.notes : notesBase
  const notesChanged = d.notes !== (notesBase ?? '')
  const notesConflict = Boolean(client && notesChanged && latestNotes !== notesBase)
  function useLatestNotes() {
    if (form.busy.current) return
    setNotesBase(latestNotes)
    setD(x => ({ ...x, notes: latestNotes ?? '' }))
    form.fail('')
  }
  async function save(replaceLatestNotes = false) {
    if (form.busy.current) return
    const row = { ...d, name: d.name.trim(), contact_name: d.contact_name.trim(), email: d.email.trim(), phone: d.phone.trim(), address: d.address.trim() }
    if (!row.name) { form.fail('Enter a client or company name.'); return }
    if (row.email && !/^[^\s@]+@[^\s@]+$/.test(row.email)) { form.fail('Enter a valid email address, or leave it blank.'); return }
    if (notesConflict && !replaceLatestNotes) { form.fail('The saved notes changed. Review them below, then choose which version to keep.'); return }
    await form.run('save', async () => {
      if (client) {
        if (notesChanged) return conditionalUpdate('clients', client.id, row, { notes: replaceLatestNotes ? latestNotes : notesBase })
        // A contact-only edit must not put an old copy of the notes back.
        const { notes: _notes, ...contact } = row
        return update('clients', client.id, contact)
      }
      const created = await insert('clients', row)
      if (created) onCreated?.(created)
      return Boolean(created)
    })
  }
  async function del() {
    if (!client || form.busy.current) return
    const count = jobs.filter(j => j.client_id === client.id).length
    if (!await confirm({ title: `Delete ${client.name}?`, body: count ? `This also deletes their ${count} job${count === 1 ? '' : 's'} and all hours, invoices and deposits on them. This cannot be undone.` : 'This cannot be undone.', confirmLabel: 'Delete client', danger: true })) return
    await form.run('delete', async () => { const ok = await remove('clients', client.id); if (ok) navigate('/clients'); return ok })
  }
  return <Modal title={client ? 'Edit client' : 'New client'} onClose={form.close} footer={<Footer form={form} onDelete={client ? del : undefined} deleteLabel="Delete client" saveLabel={client ? 'Save' : 'Add client'} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        <Field label="Client or company" htmlFor={`${form.id}-name`}><input id={`${form.id}-name`} className="input" autoFocus value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Smith Architects" /></Field>
        <div className="field-grid">
          <Field label="Contact person" htmlFor={`${form.id}-contact`}><input id={`${form.id}-contact`} className="input" value={d.contact_name} onChange={e => set('contact_name', e.target.value)} /></Field>
          <Field label="Phone" htmlFor={`${form.id}-phone`}><input id={`${form.id}-phone`} className="input" type="tel" value={d.phone} onChange={e => set('phone', e.target.value)} /></Field>
        </div>
        <Field label="Email" htmlFor={`${form.id}-email`}><input id={`${form.id}-email`} className="input" type="email" value={d.email} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Address" htmlFor={`${form.id}-addr`}><input id={`${form.id}-addr`} className="input" value={d.address} onChange={e => set('address', e.target.value)} /></Field>
        <Field label="Notes" htmlFor={`${form.id}-notes`}><textarea id={`${form.id}-notes`} className="input" value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="Billing preferences, how they like drawings delivered…" /></Field>
        {notesConflict && <div className="stack" role="alert">
          <p className="small warn-text">The saved notes changed while this form was open. Your draft is still in the Notes box.</p>
          <details><summary style={{ minHeight: 40, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Latest saved notes</summary><p className="small soft" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{latestNotes || 'No notes saved.'}</p></details>
          <p className="small muted">Use the latest notes, or replace them with your draft and save this client.</p>
          <div className="row wrap">
            <button type="button" className="btn" style={{ minHeight: 40 }} onClick={useLatestNotes}>Use latest notes</button>
            <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => void save(true)}>Save my version</button>
          </div>
        </div>}
      </fieldset>
    </form>
  </Modal>
}

/* ================= Time entry ================= */

export interface TimeDefaults { job_id?: string; phase_id?: string | null; task_id?: string | null; date?: string; hours?: number | null; billable?: boolean; notes?: string }

export function TimeEditor({ entry, defaults, onClose }: { entry?: TimeEntry; defaults?: TimeDefaults; onClose: () => void }) {
  const store = useData()
  const { jobs, phases, tasks, timeEntries, me, profiles, settings, insert, update, remove, refresh, toast } = store
  const confirm = useConfirm()
  const form = useRecordForm('time entry', onClose, () => refresh('time_entries'))
  const personRate = (uid: string) => rateFor(profiles.find(p => p.id === uid), settings.default_rate)
  const defaultJob = entry?.job_id ?? defaults?.job_id ?? jobs.find(j => j.status === 'active')?.id ?? ''
  const defaultPhase = (jobId: string) => workPhase(phases, jobId)?.id ?? null
  const [d, setD] = useState(() => ({
    job_id: defaultJob,
    phase_id: entry ? entry.phase_id : defaults?.phase_id !== undefined ? defaults.phase_id : defaultPhase(defaultJob),
    task_id: entry?.task_id ?? defaults?.task_id ?? null as string | null,
    user_id: entry?.user_id ?? me?.id ?? '',
    date: entry?.date ?? defaults?.date ?? todayISO(),
    hours: entry?.hours ?? defaults?.hours ?? null as number | null,
    notes: entry?.notes ?? defaults?.notes ?? '',
    rate: entry ? entry.rate : personRate(me?.id ?? '') as number | null,
    billable: entry ? entry.billable !== false : defaults?.billable !== false,
  }))
  const [showRate, setShowRate] = useState(false)
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const current = entry ? timeEntries.find(e => e.id === entry.id) ?? entry : undefined
  const locked = Boolean(current?.billed || current?.invoice_id || (current?.deposit_applied ?? 0) > 0)
  // Billed hours keep the figures printed on their invoice.
  const onInvoice = Boolean(current?.invoice_id && current.hours != null)
  const jobPhases = phases.filter(p => p.job_id === d.job_id && (isWorkflowPhase(p) || p.id === entry?.phase_id))
  const jobTasks = tasks.filter(t => t.job_id === d.job_id && (t.status !== 'done' || t.id === d.task_id))
  const running = current?.started_at && current.hours == null
  const [yesterday] = useState(() => iso(addDays(new Date(), -1)))

  async function save() {
    if (form.busy.current) return
    if (!d.job_id) { form.fail('Choose a job.'); return }
    if (d.hours == null || !Number.isFinite(d.hours) || d.hours <= 0) { form.fail('Enter the hours worked (more than zero).'); return }
    if (d.hours > 24) { form.fail('That is more than 24 hours in one entry. Split it across days.'); return }
    if (!validDate(d.date)) { form.fail('Enter a valid work date.'); return }
    if (d.rate != null && (!Number.isFinite(d.rate) || d.rate < 0)) { form.fail('Enter a rate of zero or more.'); return }
    if (!d.billable && locked) { form.fail('These hours are on an invoice. Unbill them on the job’s Billing tab before making them non-billable.'); return }
    if (current && locked && d.job_id !== current.job_id) { form.fail('These hours are on an invoice. Unbill them before moving them to another job.'); return }
    if (current && onInvoice && (d.hours !== current.hours || d.date !== current.date || d.rate !== current.rate)) { form.fail('These hours are on an invoice, so their hours, date and rate stay as billed. Unbill them first to change those.'); return }
    const credit = current?.billed ? current.deposit_applied ?? 0 : 0
    if (current && credit > 0 && d.hours * (d.rate ?? personRate(d.user_id)) < credit) { form.fail('A deposit credit is applied to these hours. Unbill them before reducing their value below that credit.'); return }
    await form.run('save', async () => {
      if (entry) return update('time_entries', entry.id, { ...d, started_at: null })
      const created = await insert('time_entries', { ...d, started_at: null })
      if (created) toast(`Logged ${fmtHours(d.hours)}`)
      return Boolean(created)
    })
  }
  async function del() {
    if (!entry || form.busy.current) return
    if (!await confirm({ title: 'Delete this time entry?', body: `${fmtHours(entry.hours)} on ${fmtDate(entry.date, 'long')}.`, confirmLabel: 'Delete', danger: true })) return
    await form.run('delete', () => remove('time_entries', entry.id))
  }

  return <Modal title={entry ? (running ? 'Running timer' : 'Edit hours') : 'Log hours'} onClose={form.close} footer={<Footer form={form} onDelete={entry ? del : undefined} saveLabel={entry ? 'Save' : 'Log hours'} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        {running && <div className="form-note info"><Clock size={16} />This timer is still running. Saving with hours entered stops it.</div>}
        <Field label="Job" htmlFor={`${form.id}-job`}>
          <JobSelect id={`${form.id}-job`} store={store} value={d.job_id} disabled={locked} include={[entry?.job_id, defaults?.job_id]} onChange={id => setD(x => ({ ...x, job_id: id, phase_id: defaultPhase(id), task_id: null }))} />
        </Field>
        <div className="field-grid">
          <Field label="Phase" htmlFor={`${form.id}-phase`}>
            <select id={`${form.id}-phase`} className="input" value={d.phase_id ?? ''} onChange={e => setD(x => ({ ...x, phase_id: e.target.value || null, task_id: null }))}>
              <option value="">General</option>
              {d.phase_id && !jobPhases.some(p => p.id === d.phase_id) && <option value={d.phase_id}>Saved phase</option>}
              {jobPhases.map(p => <option key={p.id} value={p.id}>{phaseLabel(p)}</option>)}
            </select>
          </Field>
          <Field label="Task" htmlFor={`${form.id}-task`}>
            <select id={`${form.id}-task`} className="input" value={d.task_id ?? ''} onChange={e => set('task_id', e.target.value || null)}>
              <option value="">— none —</option>
              {jobTasks.filter(t => !d.phase_id || t.phase_id === d.phase_id || t.id === d.task_id).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          </Field>
        </div>
        <div className="field-grid">
          <Field label="Hours" htmlFor={`${form.id}-hours`}>
            <NumberInput id={`${form.id}-hours`} autoFocus={!onInvoice} disabled={onInvoice} value={d.hours} onChange={v => set('hours', v)} step={0.25} min={0} suffix="h" />
            {!onInvoice && <QuickChips label="Hour shortcuts" value={d.hours} onPick={v => set('hours', v)} options={[0.5, 1, 2, 4, 8].map(h => ({ label: `${h}h`, value: h }))} />}
          </Field>
          <Field label="Date" htmlFor={`${form.id}-date`}>
            <input id={`${form.id}-date`} className="input" type="date" value={d.date} disabled={onInvoice} onChange={e => set('date', e.target.value)} />
            {!onInvoice && <QuickChips label="Date shortcuts" value={d.date} onPick={v => set('date', v)} options={[{ label: 'Today', value: todayISO() }, { label: 'Yesterday', value: yesterday }]} />}
          </Field>
        </div>
        <Field label="What did you work on?" htmlFor={`${form.id}-notes`}>
          <input id={`${form.id}-notes`} className="input" value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Shear wall calcs, plan-check responses" />
        </Field>
        <div className="option-row">
          <label className="switch"><input type="checkbox" checked={d.billable} disabled={locked} onChange={e => set('billable', e.target.checked)} />Billable to the client</label>
          <button type="button" className="btn ghost sm" disabled={onInvoice} onClick={() => setShowRate(s => !s)}>Rate: {d.rate == null ? 'default' : `${fmtMoney(d.rate)}/h`}</button>
        </div>
        {showRate && <Field label="Rate for this entry" hint="Each entry keeps its own rate, so changing your rate later never changes past hours." htmlFor={`${form.id}-rate`}>
          <NumberInput id={`${form.id}-rate`} value={d.rate} onChange={v => set('rate', v)} step={5} min={0} prefix="$" suffix="/ hour" />
        </Field>}
        {!d.billable && <p className="tiny muted">Non-billable time still counts toward the job's hours and your effective hourly rate, but it is never invoiced or paid from a deposit.</p>}
        {d.hours != null && d.rate != null && d.billable && <p className="tiny muted">Value: {fmtMoney(d.hours * d.rate)}</p>}
        {locked && <div className="form-note"><Lock size={15} />These hours are on an invoice{current?.invoice_id ? ` (${store.invoices.find(i => i.id === current.invoice_id)?.number ?? 'saved invoice'})` : ''}. Their job, hours, date, rate and billable setting stay as billed; you can still edit the notes. To change the rest, unbill them on the job’s Billing tab (Billed work → Unbill).</div>}
      </fieldset>
    </form>
  </Modal>
}

/* ================= Deposit ================= */

export function DepositEditor({ deposit, jobId, onClose }: { deposit?: Deposit; jobId?: string; onClose: () => void }) {
  const store = useData()
  const { jobs, insert, update, remove, refresh, toast } = store
  const confirm = useConfirm()
  const form = useRecordForm('deposit', onClose, () => refresh('deposits'))
  const [d, setD] = useState({
    job_id: deposit?.job_id ?? jobId ?? jobs.find(j => j.status === 'active')?.id ?? '',
    amount: deposit?.amount ?? (null as number | null),
    received_date: deposit?.received_date ?? todayISO(),
    method: deposit?.method ?? 'Check',
    notes: deposit?.notes ?? '',
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  async function save() {
    if (form.busy.current) return
    if (!d.job_id || d.amount == null || !Number.isFinite(d.amount) || d.amount <= 0) { form.fail('Choose a job and enter an amount greater than zero.'); return }
    if (!validDate(d.received_date)) { form.fail('Enter the date you received it.'); return }
    await form.run('save', async () => {
      if (deposit) return update('deposits', deposit.id, { ...d, amount: d.amount! })
      const ok = Boolean(await insert('deposits', { ...d, amount: d.amount! }))
      if (ok) toast(`Deposit of ${fmtMoney(d.amount)} recorded`)
      return ok
    })
  }
  async function del() {
    if (!deposit || form.busy.current) return
    if (!await confirm({ title: 'Delete this deposit?', body: `${fmtMoney(deposit.amount)} received ${fmtDate(deposit.received_date, 'long')}. Work it covered will show as not billed again.`, confirmLabel: 'Delete', danger: true })) return
    await form.run('delete', () => remove('deposits', deposit.id))
  }
  const methods = ['Check', 'ACH / transfer', 'Credit card', 'Cash', 'Other']
  return <Modal title={deposit ? 'Edit deposit' : 'Record a deposit'} subtitle="Money received before the work is invoiced (a retainer)" onClose={form.close} footer={<Footer form={form} onDelete={deposit ? del : undefined} saveLabel={deposit ? 'Save' : 'Record deposit'} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        <Field label="Job" htmlFor={`${form.id}-job`}><JobSelect id={`${form.id}-job`} store={store} value={d.job_id} include={[deposit?.job_id, jobId]} onChange={id => set('job_id', id)} /></Field>
        <div className="field-grid">
          <Field label="Amount" htmlFor={`${form.id}-amt`}><NumberInput id={`${form.id}-amt`} autoFocus value={d.amount} onChange={v => set('amount', v)} step={0.01} min={0} prefix="$" /></Field>
          <Field label="Received" htmlFor={`${form.id}-date`}><input id={`${form.id}-date`} className="input" type="date" value={d.received_date} onChange={e => set('received_date', e.target.value)} /></Field>
        </div>
        <Field label="How it was paid">
          <Segmented label="Payment method" size="sm" value={methods.includes(d.method) ? d.method : 'Other'} onChange={v => set('method', v)} options={methods.map(m => ({ value: m, label: m }))} />
        </Field>
        <Field label="Notes" htmlFor={`${form.id}-notes`}><input id={`${form.id}-notes`} className="input" value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Retainer at signing, check #1043" /></Field>
        <p className="tiny muted">The deposit pays for this job's billable hours and charges automatically, oldest first.</p>
      </fieldset>
    </form>
  </Modal>
}

/* ================= Charge (expense, mileage, fee…) ================= */

export function ChargeEditor({ item, jobId, onClose }: { item?: JobItem; jobId?: string; onClose: () => void }) {
  const store = useData()
  const { jobs, items, me, insert, update, remove, refresh, toast } = store
  const confirm = useConfirm()
  const form = useRecordForm('charge', onClose, () => refresh('job_items'))
  const [d, setD] = useState({
    job_id: item?.job_id ?? jobId ?? jobs.find(j => j.status === 'active')?.id ?? '',
    date: item?.date ?? todayISO(),
    category: item?.category ?? 'Expense',
    description: item?.description ?? '',
    quantity: item?.quantity ?? 1 as number | null,
    unit_price: item?.unit_price ?? (null as number | null),
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const amount = (d.quantity ?? 0) * (d.unit_price ?? 0)
  const miles = d.category === 'Mileage'
  const current = item ? items.find(r => r.id === item.id) ?? item : undefined
  const locked = Boolean(current?.billed || current?.invoice_id || (current?.deposit_applied ?? 0) > 0)
  async function save() {
    if (form.busy.current) return
    if (!d.job_id) { form.fail('Choose a job.'); return }
    if (d.unit_price == null || d.unit_price <= 0 || d.quantity == null || d.quantity <= 0 || !Number.isFinite(amount)) { form.fail(`Enter ${miles ? 'the miles and the rate per mile' : 'a quantity and price'} greater than zero.`); return }
    if (!validDate(d.date)) { form.fail('Enter a valid date.'); return }
    if (current && locked && d.job_id !== current.job_id) { form.fail('This charge is on an invoice. Unbill it before moving it to another job.'); return }
    if (current && current.invoice_id && (d.quantity !== current.quantity || d.unit_price !== current.unit_price || d.date !== current.date)) { form.fail('This charge is on an invoice, so its amount and date stay as billed. Unbill it first to change them.'); return }
    const credit = current?.billed ? current.deposit_applied ?? 0 : 0
    if (current && credit > 0 && amount < credit) { form.fail('A deposit credit is applied to this charge. Unbill it before reducing it below that credit.'); return }
    const row = { ...d, quantity: d.quantity, unit_price: d.unit_price, description: d.description.trim() }
    await form.run('save', async () => {
      if (item) return update('job_items', item.id, row)
      const ok = Boolean(await insert('job_items', { ...row, created_by: me?.id ?? null }))
      if (ok) toast(`Charge of ${fmtMoney(amount)} added`)
      return ok
    })
  }
  async function del() {
    if (!item || form.busy.current) return
    if (!await confirm({ title: 'Delete this charge?', confirmLabel: 'Delete', danger: true })) return
    await form.run('delete', () => remove('job_items', item.id))
  }
  return <Modal title={item ? 'Edit charge' : 'Add a charge'} subtitle="Expenses, mileage, printing, fees — anything billed that isn't hours" onClose={form.close} footer={<Footer form={form} onDelete={item ? del : undefined} saveLabel={amount > 0 && Number.isFinite(amount) ? `Save ${fmtMoney(amount)}` : 'Save'} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        <Field label="Job" htmlFor={`${form.id}-job`}><JobSelect id={`${form.id}-job`} store={store} value={d.job_id} disabled={locked} include={[item?.job_id, jobId]} onChange={id => set('job_id', id)} /></Field>
        <div className="field-grid">
          <Field label="Type" htmlFor={`${form.id}-cat`}>
            <select id={`${form.id}-cat`} className="input" value={d.category} onChange={e => setD(x => ({ ...x, category: e.target.value, unit_price: e.target.value === 'Mileage' && x.unit_price == null ? 0.7 : x.unit_price }))}>
              {ITEM_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Date" htmlFor={`${form.id}-date`}><input id={`${form.id}-date`} className="input" type="date" value={d.date} disabled={Boolean(current?.invoice_id)} onChange={e => set('date', e.target.value)} /></Field>
        </div>
        <Field label="Description" htmlFor={`${form.id}-desc`}><input id={`${form.id}-desc`} className="input" autoFocus value={d.description} onChange={e => set('description', e.target.value)} placeholder={miles ? 'e.g. Site visit round trip' : 'e.g. County plan-check fee'} /></Field>
        <div className="field-grid">
          <Field label={miles ? 'Miles' : 'Quantity'} htmlFor={`${form.id}-qty`}><NumberInput id={`${form.id}-qty`} disabled={Boolean(current?.invoice_id)} value={d.quantity} onChange={v => set('quantity', v)} step={miles ? 1 : 0.5} min={0} /></Field>
          <Field label={miles ? 'Rate per mile' : 'Price each'} htmlFor={`${form.id}-price`}><NumberInput id={`${form.id}-price`} disabled={Boolean(current?.invoice_id)} value={d.unit_price} onChange={v => set('unit_price', v)} step={0.01} min={0} prefix="$" /></Field>
        </div>
        <div className="amount-line"><span className="muted">Amount</span><strong className="num">{fmtMoney(Number.isFinite(amount) ? amount : 0)}</strong></div>
        {locked && <div className="form-note"><Lock size={15} />This charge is on an invoice. Its job, amount and date stay as billed; to change them, unbill it on the job’s Billing tab (Billed work → Unbill).</div>}
      </fieldset>
    </form>
  </Modal>
}

/* ================= Invoice ================= */

function suggestInvoiceNumber(invoices: Invoice[]): string {
  const nums = invoices.map(i => parseInt(i.number.replace(/\D/g, ''), 10)).filter(n => !isNaN(n))
  return `INV-${String((nums.length ? Math.max(...nums) : 1000) + 1).padStart(4, '0')}`
}

/** Create an invoice from a job's unbilled work (all selected to start), or edit one. */
export function InvoiceEditor({ invoice, jobId, preselect, onClose }: { invoice?: Invoice; jobId: string; preselect?: { entryIds: string[]; itemIds: string[] }; onClose: () => void }) {
  const store = useData()
  const { invoices, jobs, phases, recordInvoice, update, remove, refresh, toast } = store
  const confirm = useConfirm()
  const navigate = useNavigate()
  const form = useRecordForm('invoice', onClose, () => refresh())
  const job = jobs.find(j => j.id === jobId)
  const phaseName = (id: string | null) => { const p = phases.find(x => x.id === id); return p ? phaseLabel(p) : 'General' }
  // Freeze the work values when the form opens: the database checks them again.
  const [work] = useState(() => {
    if (invoice) return []
    const c = jobCharges(store, jobId)
    const open = (s: string) => s === 'unbilled' || s === 'partial'
    return [
      ...c.hours.filter(h => open(h.status)).map(h => ({ key: `h:${h.entry.id}`, table: 'time_entries' as const, id: h.entry.id, date: h.entry.date, title: h.entry.notes || phaseName(h.entry.phase_id), detail: `${fmtHours(h.entry.hours)} × ${fmtMoney(h.amount / (h.entry.hours || 1))}`, amount: h.amount, covered: h.covered })),
      ...c.items.filter(i => open(i.status)).map(i => ({ key: `i:${i.item.id}`, table: 'job_items' as const, id: i.item.id, date: i.item.date, title: i.item.description || i.item.category, detail: i.item.category, amount: i.amount, covered: i.covered })),
    ].sort((a, b) => a.date.localeCompare(b.date))
  })
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselect ? [...preselect.entryIds.map(id => `h:${id}`), ...preselect.itemIds.map(id => `i:${id}`)] : work.map(w => w.key)))
  const due = work.filter(w => selected.has(w.key)).reduce((s, w) => s + w.amount - w.covered, 0)
  const [d, setD] = useState({
    number: invoice?.number ?? suggestInvoiceNumber(invoices),
    amount: invoice?.amount ?? (Math.round((due + Number.EPSILON) * 100) / 100) as number | null,
    amountTouched: Boolean(invoice),
    issued_date: invoice?.issued_date ?? todayISO(),
    paid_date: invoice?.paid_date ?? null as string | null,
    notes: invoice?.notes ?? '',
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const choose = (next: Set<string>) => {
    setSelected(next)
    if (!d.amountTouched) {
      const total = work.filter(w => next.has(w.key)).reduce((sum, w) => sum + w.amount - w.covered, 0)
      setD(x => ({ ...x, amount: Math.round((total + Number.EPSILON) * 100) / 100 }))
    }
  }
  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    choose(next)
  }

  async function save() {
    if (form.busy.current) return
    if (!d.number.trim()) { form.fail('Enter an invoice number.'); return }
    if (d.amount == null || !Number.isFinite(d.amount) || d.amount < 0) { form.fail('Enter the invoice amount (zero or more).'); return }
    if (!validDate(d.issued_date) || (d.paid_date && !validDate(d.paid_date))) { form.fail('Enter valid dates.'); return }
    await form.run('save', async () => {
      const row = { number: d.number.trim(), amount: d.amount!, issued_date: d.issued_date, paid_date: d.paid_date, notes: d.notes }
      if (invoice) {
        // Only send what changed, so a notes edit never undoes a payment recorded elsewhere.
        const changes: Partial<Invoice> = {}
        for (const k of ['number', 'amount', 'issued_date', 'paid_date', 'notes'] as const) if (row[k] !== invoice[k]) (changes as Record<string, unknown>)[k] = row[k]
        return Object.keys(changes).length ? update('invoices', invoice.id, changes) : true
      }
      // Send the amounts and deposit credits shown when the form opened. If the
      // work or deposits changed since then, the database refuses the invoice
      // instead of billing figures nobody saw.
      const links: InvoiceWorkLink[] = work.filter(w => selected.has(w.key)).map(w => ({ table: w.table, id: w.id, amount: w.amount, depositApplied: w.covered }))
      const created = await recordInvoice({ ...row, job_id: jobId }, links)
      if (created) toast(`Invoice ${created.number} recorded`, 'ok', { label: 'View', run: () => navigate(`/money/invoice/${created.id}`) })
      return Boolean(created)
    })
  }
  async function del() {
    if (!invoice || form.busy.current) return
    if (!await confirm({ title: `Delete invoice ${invoice.number}?`, body: 'The hours and charges on it become unbilled again, and any deposit credit they used is released.', confirmLabel: 'Delete invoice', danger: true })) return
    await form.run('delete', () => remove('invoices', invoice.id))
  }

  return <Modal size={invoice ? undefined : 'wide'} title={invoice ? `Invoice ${invoice.number}` : 'New invoice'} subtitle={job ? `${job.name}` : undefined} onClose={form.close} footer={<Footer form={form} onDelete={invoice ? del : undefined} deleteLabel="Delete invoice" saveLabel={invoice ? 'Save' : `Record ${fmtMoney(d.amount ?? 0)} invoice`} />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="form-fields" disabled={form.pending !== null}>
        {!invoice && <div className="invoice-pick">
          <div className="row between"><span className="field-label">Work on this invoice</span>{work.length > 0 && <button type="button" className="btn ghost xs" onClick={() => choose(new Set(selected.size < work.length ? work.map(w => w.key) : []))}>{selected.size < work.length ? 'Select all' : 'Clear'}</button>}</div>
          {work.length ? <ul className="pick-list">{work.map(w => <li key={w.key}>
            <label className="pick-row">
              <input type="checkbox" checked={selected.has(w.key)} onChange={() => toggle(w.key)} />
              <span className="grow"><span className="strong">{w.title}</span><span className="tiny muted"> · {fmtDate(w.date)} · {w.detail}</span>{w.covered > 0 && <span className="tiny ok-text"> · {fmtMoney(w.covered)} paid by deposit</span>}</span>
              <span className="num strong">{fmtMoney(w.amount - w.covered)}</span>
            </label>
          </li>)}</ul> : <p className="small muted">No unbilled work on this job. You can still record a fixed-fee or progress invoice for any amount.</p>}
        </div>}
        <div className="field-grid">
          <Field label="Invoice #" htmlFor={`${form.id}-num`}><input id={`${form.id}-num`} className="input" value={d.number} onChange={e => set('number', e.target.value)} /></Field>
          <Field label="Amount" htmlFor={`${form.id}-amt`} hint={!invoice && d.amountTouched && Math.abs((d.amount ?? 0) - due) > 0.005 ? `Selected work comes to ${fmtMoney(due)}` : undefined}>
            <NumberInput id={`${form.id}-amt`} value={d.amount} onChange={v => setD(x => ({ ...x, amount: v, amountTouched: true }))} step={0.01} min={0} prefix="$" />
          </Field>
          <Field label="Issued" htmlFor={`${form.id}-issued`}><input id={`${form.id}-issued`} className="input" type="date" value={d.issued_date} onChange={e => set('issued_date', e.target.value)} /></Field>
          <Field label="Paid on" htmlFor={`${form.id}-paid`} hint="Leave blank until the client pays">
            <input id={`${form.id}-paid`} className="input" type="date" value={d.paid_date ?? ''} onChange={e => set('paid_date', e.target.value || null)} />
          </Field>
        </div>
        <Field label="Note on the invoice" htmlFor={`${form.id}-notes`}><input id={`${form.id}-notes`} className="input" value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Design phase — 50% progress billing" /></Field>
        {!invoice && <p className="tiny muted"><FileText size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /> After saving you can open a printable invoice to save as PDF and email.</p>}
      </fieldset>
    </form>
  </Modal>
}

/* ================= Mark paid ================= */

export function PaidEditor({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { update, refresh, toast } = useData()
  const form = useRecordForm('payment', onClose, () => refresh('invoices'))
  const [date, setDate] = useState(todayISO())
  async function save() {
    if (!validDate(date)) { form.fail('Enter the date the payment arrived.'); return }
    await form.run('save', async () => {
      const ok = await update('invoices', invoice.id, { paid_date: date })
      if (ok) toast(`${invoice.number} marked paid`, 'ok', { label: 'Undo', run: () => update('invoices', invoice.id, { paid_date: null }) })
      return ok
    })
  }
  return <Modal size="narrow" title={`Mark ${invoice.number} paid`} subtitle={fmtMoney(invoice.amount)} onClose={form.close} footer={<Footer form={form} saveLabel="Mark paid" />}>
    <FormError message={form.error} />
    <form id={form.id} noValidate onSubmit={e => { e.preventDefault(); void save() }}>
      <Field label="Payment received" htmlFor={`${form.id}-date`}><input id={`${form.id}-date`} className="input" type="date" autoFocus value={date} onChange={e => setDate(e.target.value)} /></Field>
    </form>
  </Modal>
}

/* ================= Provider ================= */

type EditorRequest =
  | { kind: 'task'; task?: Task; defaults?: TaskDefaults }
  | { kind: 'job'; job?: Job; defaults?: JobDefaults }
  | { kind: 'client'; client?: Client; onCreated?: (c: Client) => void }
  | { kind: 'jobType'; jobType?: JobType; onCreated?: (t: JobType) => void }
  | { kind: 'time'; entry?: TimeEntry; defaults?: TimeDefaults }
  | { kind: 'deposit'; deposit?: Deposit; jobId?: string }
  | { kind: 'charge'; item?: JobItem; jobId?: string }
  | { kind: 'invoice'; invoice?: Invoice; jobId: string; preselect?: { entryIds: string[]; itemIds: string[] } }
  | { kind: 'paid'; invoice: Invoice }

export interface Editors {
  task: (task?: Task, defaults?: TaskDefaults) => void
  job: (job?: Job, defaults?: JobDefaults) => void
  client: (client?: Client, onCreated?: (c: Client) => void) => void
  jobType: (jobType?: JobType, onCreated?: (t: JobType) => void) => void
  time: (entry?: TimeEntry, defaults?: TimeDefaults) => void
  deposit: (deposit?: Deposit, jobId?: string) => void
  charge: (item?: JobItem, jobId?: string) => void
  invoice: (jobId: string, invoice?: Invoice, preselect?: { entryIds: string[]; itemIds: string[] }) => void
  paid: (invoice: Invoice) => void
}

const EditorContext = createContext<Editors | null>(null)

export function useEditors(): Editors {
  const e = useContext(EditorContext)
  if (!e) throw new Error('useEditors must be used inside <EditorProvider>')
  return e
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ id: number; req: EditorRequest }[]>([])
  const counter = useRef(0)
  const open = useCallback((req: EditorRequest) => setStack(s => [...s, { id: ++counter.current, req }]), [])
  const closeTop = useCallback((id: number) => setStack(s => s.filter(x => x.id !== id)), [])
  const editors = useMemo<Editors>(() => ({
    task: (task, defaults) => open({ kind: 'task', task, defaults }),
    job: (job, defaults) => open({ kind: 'job', job, defaults }),
    client: (client, onCreated) => open({ kind: 'client', client, onCreated }),
    jobType: (jobType, onCreated) => open({ kind: 'jobType', jobType, onCreated }),
    time: (entry, defaults) => open({ kind: 'time', entry, defaults }),
    deposit: (deposit, jobId) => open({ kind: 'deposit', deposit, jobId }),
    charge: (item, jobId) => open({ kind: 'charge', item, jobId }),
    invoice: (jobId, invoice, preselect) => open({ kind: 'invoice', jobId, invoice, preselect }),
    paid: invoice => open({ kind: 'paid', invoice }),
  }), [open])

  return <EditorContext.Provider value={editors}>
    {children}
    {stack.map(({ id, req }) => {
      const close = () => closeTop(id)
      switch (req.kind) {
        case 'task': return <TaskEditor key={id} task={req.task} defaults={req.defaults} onClose={close} />
        case 'job': return <JobEditor key={id} job={req.job} defaults={req.defaults} onClose={close} openClient={done => editors.client(undefined, done)} openJobType={done => editors.jobType(undefined, done)} />
        case 'client': return <ClientEditor key={id} client={req.client} onCreated={req.onCreated} onClose={close} />
        case 'jobType': return <JobTypeEditor key={id} jobType={req.jobType} onCreated={req.onCreated} onClose={close} />
        case 'time': return <TimeEditor key={id} entry={req.entry} defaults={req.defaults} onClose={close} />
        case 'deposit': return <DepositEditor key={id} deposit={req.deposit} jobId={req.jobId} onClose={close} />
        case 'charge': return <ChargeEditor key={id} item={req.item} jobId={req.jobId} onClose={close} />
        case 'invoice': return <InvoiceEditor key={id} invoice={req.invoice} jobId={req.jobId} preselect={req.preselect} onClose={close} />
        case 'paid': return <PaidEditor key={id} invoice={req.invoice} onClose={close} />
      }
    })}
  </EditorContext.Provider>
}

// Icons used by callers that build "New …" menus.
export const EDITOR_ICONS = { task: CalendarDays, job: Briefcase, client: Building2, time: Clock, visit: MapPin }
