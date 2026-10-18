// Pop-up forms for creating and editing things: tasks, jobs, clients,
// time entries and invoices. Every page reuses these.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import type { Client, Deposit, Invoice, Job, JobItem, JobStatus, Recurrence, Task, TaskStatus, TimeEntry } from '../lib/types'
import { ITEM_CATEGORIES } from '../lib/types'
import { rateFor, workPhase } from '../lib/calc'
import { JOB_STATUS_LABEL, RECURRENCE_LABEL, TASK_STATUS_LABEL } from '../lib/types'
import { fmtMoney, todayISO } from '../lib/utils'
import { saveTask } from '../lib/taskActions'
import { invoiceWorkLinks } from '../lib/billingActions'
import { Modal } from './ui'

export { toggleTaskDone } from '../lib/taskActions'

/* =============== Task =============== */
export interface TaskDraft {
  id?: string
  job_id: string
  phase_id: string | null
  title: string
  description: string
  status: TaskStatus
  assignee_id: string | null
  due_date: string | null
  scheduled_at: string | null
  is_site_visit: boolean
  estimate_hours: number | null
  recurrence: Recurrence
}

export function TaskModal({ task, defaults, onClose }: { task?: Task; defaults?: Partial<TaskDraft>; onClose: () => void }) {
  const store = useData()
  const { jobs, phases, clients, remove, me, toast } = store
  const activeJobs = jobs.filter(j => (j.status !== 'archived' && j.status !== 'cancelled') || j.id === task?.job_id || j.id === defaults?.job_id)
  const [d, setD] = useState<TaskDraft>(() => task ? {
    id: task.id, job_id: task.job_id, phase_id: task.phase_id, title: task.title, description: task.description, status: task.status,
    assignee_id: task.assignee_id, due_date: task.due_date, scheduled_at: task.scheduled_at, is_site_visit: task.is_site_visit,
    estimate_hours: task.estimate_hours, recurrence: task.recurrence,
  } : {
    job_id: defaults?.job_id ?? activeJobs[0]?.id ?? '', phase_id: defaults?.phase_id ?? null, title: defaults?.title ?? '', description: '',
    status: 'todo', assignee_id: me?.id ?? null, due_date: defaults?.due_date ?? null, scheduled_at: null,
    is_site_visit: defaults?.is_site_visit ?? false, estimate_hours: null, recurrence: 'none',
  })
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const persistedTask = useRef<Task | undefined>(task)
  const jobPhases = phases.filter(p => p.job_id === d.job_id)
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setD(x => ({ ...x, [k]: v }))

  // Keep the site-visit time's date in step with the due date.
  const timePart = d.scheduled_at ? localTime(d.scheduled_at) : '09:00'

  async function save() {
    if (savingRef.current) return
    if (!d.title.trim() || !d.job_id) { toast('Give the task a title and a job', 'error'); return }
    savingRef.current = true
    setSaving(true)
    const row: Partial<Task> = {
      job_id: d.job_id, phase_id: d.phase_id, title: d.title.trim(), description: d.description, status: d.status,
      assignee_id: d.assignee_id, due_date: d.due_date, is_site_visit: d.is_site_visit,
      scheduled_at: d.is_site_visit && d.due_date ? new Date(`${d.due_date}T${timePart}:00`).toISOString() : null,
      estimate_hours: d.estimate_hours, recurrence: d.recurrence,
    }
    try {
      const result = await saveTask(store, persistedTask.current, row)
      // A new completed task may save while the successor fails. Retry that
      // same task rather than inserting a second original task.
      if (result.task) persistedTask.current = result.task
      if (result.success) onClose()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function del() {
    if (!task || !confirm('Delete this task?')) return
    await remove('tasks', task.id)
    onClose()
  }

  return (
    <Modal title={task ? 'Edit task' : 'New task'} onClose={onClose} footer={<>
      {task && <button className="btn danger left" onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={saving}>{task ? 'Save' : 'Add task'}</button>
    </>}>
      <div className="field">
        <label>Task</label>
        <input autoFocus value={d.title} onChange={e => set('title', e.target.value)} placeholder="What needs to be done?" onKeyDown={e => { if (e.key === 'Enter') void save() }} />
      </div>
      <div className="row">
        <div className="field">
          <label>Job</label>
          <select value={d.job_id} onChange={e => { set('job_id', e.target.value); set('phase_id', null) }}>
            {activeJobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `${j.job_number} · ` : ''}{j.name} ({clients.find(c => c.id === j.client_id)?.name})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Phase</label>
          <select value={d.phase_id ?? ''} onChange={e => set('phase_id', e.target.value || null)}>
            <option value="">No phase (general)</option>
            {jobPhases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Status</label>
          <select value={d.status} onChange={e => set('status', e.target.value as TaskStatus)}>
            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Due date</label>
          <input type="date" value={d.due_date ?? ''} onChange={e => set('due_date', e.target.value || null)} />
        </div>
        <div className="field">
          <label>Estimate (hours)</label>
          <input type="number" step="0.5" min="0" value={d.estimate_hours ?? ''} onChange={e => set('estimate_hours', e.target.value === '' ? null : Number(e.target.value))} />
        </div>
        <div className="field">
          <label>Repeats</label>
          <select value={d.recurrence} onChange={e => set('recurrence', e.target.value as Recurrence)}>
            {(Object.keys(RECURRENCE_LABEL) as Recurrence[]).map(r => <option key={r} value={r}>{RECURRENCE_LABEL[r]}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <label className="chip" style={{ marginBottom: 12 }}>
          <input type="checkbox" style={{ width: 18, minHeight: 0, margin: 0 }} checked={d.is_site_visit} onChange={e => set('is_site_visit', e.target.checked)} />
          Site visit
        </label>
        {d.is_site_visit && (
          <div className="field">
            <label>Time</label>
            <input type="time" value={timePart} onChange={e => set('scheduled_at', d.due_date ? new Date(`${d.due_date}T${e.target.value}:00`).toISOString() : null)} disabled={!d.due_date} />
          </div>
        )}
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea value={d.description} onChange={e => set('description', e.target.value)} />
      </div>
    </Modal>
  )
}

function localTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* =============== Job =============== */
export function JobModal({ job, defaultClientId, onClose, onCreated }: { job?: Job; defaultClientId?: string; onClose: () => void; onCreated?: (job: Job) => void }) {
  const { clients, jobs, insert, update, remove, toast } = useData()
  const [d, setD] = useState(() => ({
    client_id: job?.client_id ?? defaultClientId ?? clients[0]?.id ?? '',
    job_number: job?.job_number ?? suggestJobNumber(jobs),
    name: job?.name ?? '', description: job?.description ?? '', address: job?.address ?? '',
    status: (job?.status ?? 'active') as JobStatus,
    fee: job?.fee ?? null as number | null,
    queued_date: job?.queued_date ?? null as string | null,
    start_date: job?.start_date ?? null as string | null,
    due_date: job?.due_date ?? null as string | null,
  }))
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))

  async function save() {
    if (!d.name.trim() || !d.client_id) { toast('A job needs a name and a client', 'error'); return }
    setSaving(true)
    if (job) { await update('jobs', job.id, { ...d, name: d.name.trim() }); onClose() }
    else {
      const maxPriority = Math.max(0, ...jobs.filter(j => j.status === 'active').map(j => j.priority))
      const created = await insert('jobs', { ...d, name: d.name.trim(), priority: maxPriority + 1 })
      if (created) { toast('Job created with its phases (starts in Bidding)'); onCreated?.(created) }
      onClose()
    }
    setSaving(false)
  }
  async function del() {
    if (!job || !confirm(`Delete "${job.name}" and everything in it (phases, tasks, hours, invoices)? This cannot be undone.`)) return
    await remove('jobs', job.id); onClose()
  }

  return (
    <Modal title={job ? 'Edit job' : 'New job'} onClose={onClose} footer={<>
      {job && <button className="btn danger left" onClick={del}>Delete job</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={saving}>{job ? 'Save' : 'Create job'}</button>
    </>}>
      <div className="row">
        <div className="field" style={{ flex: '0 1 120px' }}>
          <label>Job #</label>
          <input value={d.job_number} onChange={e => set('job_number', e.target.value)} />
        </div>
        <div className="field">
          <label>Job name</label>
          <input autoFocus value={d.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Smith Residence — Addition" />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Client</label>
          <select value={d.client_id} onChange={e => set('client_id', e.target.value)}>
            {clients.length === 0 && <option value="">Add a client first</option>}
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select value={d.status} onChange={e => set('status', e.target.value as JobStatus)}>
            {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map(s => <option key={s} value={s}>{JOB_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Site address</label>
        <input value={d.address} onChange={e => set('address', e.target.value)} />
      </div>
      <div className="row">
        <div className="field">
          <label>Entered queue</label>
          <input type="date" value={d.queued_date ?? ''} onChange={e => set('queued_date', e.target.value || null)} />
        </div>
        <div className="field">
          <label>Start date</label>
          <input type="date" value={d.start_date ?? ''} onChange={e => set('start_date', e.target.value || null)} />
        </div>
        <div className="field">
          <label>Overall due date</label>
          <input type="date" value={d.due_date ?? ''} onChange={e => set('due_date', e.target.value || null)} />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: '0 1 200px' }}>
          <label>Fee ($)</label>
          <input type="number" min="0" step="50" value={d.fee ?? ''} onChange={e => set('fee', e.target.value === '' ? null : Number(e.target.value))} />
        </div>
      </div>
      <div className="field">
        <label>Description</label>
        <textarea value={d.description} onChange={e => set('description', e.target.value)} placeholder="Scope, structure type, and other job details" />
      </div>
      {!job && <p className="small muted">The standard phases (Bidding, Queued, Original design, County / plan-check comments, Construction changes, Client-requested changes) are added automatically. New jobs start in Bidding.</p>}
    </Modal>
  )
}

function suggestJobNumber(jobs: Job[]): string {
  const yy = String(new Date().getFullYear()).slice(2)
  const nums = jobs.map(j => j.job_number).filter(n => n.startsWith(yy + '-')).map(n => parseInt(n.slice(3), 10)).filter(n => !isNaN(n))
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `${yy}-${String(next).padStart(3, '0')}`
}

/* =============== Client =============== */
export function ClientModal({ client, onClose, onCreated }: { client?: Client; onClose: () => void; onCreated?: (c: Client) => void }) {
  const { insert, update, remove, toast } = useData()
  const [d, setD] = useState({
    name: client?.name ?? '', contact_name: client?.contact_name ?? '', email: client?.email ?? '', phone: client?.phone ?? '',
    address: client?.address ?? '', notes: client?.notes ?? '',
  })
  const set = <K extends keyof typeof d>(k: K, v: string) => setD(x => ({ ...x, [k]: v }))
  async function save() {
    if (!d.name.trim()) { toast('Client needs a name', 'error'); return }
    if (client) await update('clients', client.id, d)
    else { const c = await insert('clients', d); if (c) onCreated?.(c) }
    onClose()
  }
  async function del() {
    if (!client || !confirm(`Delete "${client.name}" and ALL of their jobs? This cannot be undone.`)) return
    await remove('clients', client.id); onClose()
  }
  return (
    <Modal title={client ? 'Edit client' : 'New client'} onClose={onClose} footer={<>
      {client && <button className="btn danger left" onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save}>{client ? 'Save' : 'Add client'}</button>
    </>}>
      <div className="field"><label>Client / company name</label><input autoFocus value={d.name} onChange={e => set('name', e.target.value)} /></div>
      <div className="row">
        <div className="field"><label>Contact person</label><input value={d.contact_name} onChange={e => set('contact_name', e.target.value)} /></div>
        <div className="field"><label>Phone</label><input type="tel" value={d.phone} onChange={e => set('phone', e.target.value)} /></div>
      </div>
      <div className="field"><label>Email</label><input type="email" value={d.email} onChange={e => set('email', e.target.value)} /></div>
      <div className="field"><label>Address</label><input value={d.address} onChange={e => set('address', e.target.value)} /></div>
      <div className="field"><label>Notes</label><textarea value={d.notes} onChange={e => set('notes', e.target.value)} /></div>
    </Modal>
  )
}

/* =============== Time entry =============== */
export function TimeModal({ entry, defaults, onClose }: { entry?: TimeEntry; defaults?: Partial<TimeEntry>; onClose: () => void }) {
  const { jobs, phases, tasks, timeEntries, clients, me, profiles, settings, insert, update, remove, toast } = useData()
  const activeJobs = jobs.filter(j => j.status !== 'archived')
  const personRate = (uid: string) => rateFor(profiles.find(p => p.id === uid), settings.default_rate)
  const [d, setD] = useState({
    job_id: entry?.job_id ?? defaults?.job_id ?? activeJobs[0]?.id ?? '',
    phase_id: entry?.phase_id ?? defaults?.phase_id ?? null as string | null,
    task_id: entry?.task_id ?? defaults?.task_id ?? null as string | null,
    user_id: entry?.user_id ?? me?.id ?? '',
    date: entry?.date ?? defaults?.date ?? todayISO(),
    hours: entry?.hours ?? defaults?.hours ?? null as number | null,
    notes: entry?.notes ?? defaults?.notes ?? '',
    rate: entry ? entry.rate : personRate(me?.id ?? '') as number | null,
    billable: entry ? entry.billable !== false : defaults?.billable !== false,
  })
  const currentEntry = entry ? timeEntries.find(e => e.id === entry.id) ?? entry : undefined
  const billingLocked = Boolean(currentEntry?.billed || currentEntry?.invoice_id || (currentEntry?.deposit_applied ?? 0) > 0)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const jobPhases = phases.filter(p => p.job_id === d.job_id)
  const jobTasks = tasks.filter(t => t.job_id === d.job_id && (!d.phase_id || t.phase_id === d.phase_id))
  useEffect(() => { if (!jobPhases.some(p => p.id === d.phase_id)) setD(x => ({ ...x, phase_id: workPhase(phases, d.job_id)?.id ?? null })) }, [d.job_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (busy.current) return
    if (!d.job_id || d.hours == null || d.hours <= 0) { toast('Enter the job and the hours', 'error'); return }
    if (!d.billable && billingLocked) { toast('Unbill these hours in Billing before making them nonbillable.', 'error'); return }
    const credit = currentEntry?.billed ? currentEntry.deposit_applied ?? 0 : 0
    if (currentEntry && credit > 0 && (d.job_id !== currentEntry.job_id || d.hours * (d.rate ?? personRate(d.user_id)) < credit)) {
      toast('Unbill these hours before moving them to another job or reducing their value below the applied deposit.', 'error'); return
    }
    busy.current = true; setSaving(true)
    try {
      if (entry) { if (!await update('time_entries', entry.id, { ...d, started_at: null })) return }
      else if (!await insert('time_entries', { ...d, started_at: null })) return
      onClose()
    } finally { busy.current = false; setSaving(false) }
  }
  async function del() { if (entry && confirm('Delete this time entry?')) { await remove('time_entries', entry.id); onClose() } }

  return (
    <Modal title={entry ? 'Edit hours' : 'Log hours'} onClose={onClose} footer={<>
      {entry && <button className="btn danger left" onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </>}>
      <div className="row">
        <div className="field">
          <label>Job</label>
          <select value={d.job_id} onChange={e => { set('job_id', e.target.value); set('task_id', null) }}>
            {activeJobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `${j.job_number} · ` : ''}{j.name} ({clients.find(c => c.id === j.client_id)?.name})</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>Phase</label>
          <select value={d.phase_id ?? ''} onChange={e => { set('phase_id', e.target.value || null); set('task_id', null) }}>
            <option value="">General</option>
            {jobPhases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Task (optional)</label>
          <select value={d.task_id ?? ''} onChange={e => set('task_id', e.target.value || null)}>
            <option value="">—</option>
            {jobTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div className="field"><label>Date</label><input type="date" value={d.date} onChange={e => set('date', e.target.value)} /></div>
        <div className="field"><label>Hours</label><input autoFocus type="number" step="0.25" min="0" value={d.hours ?? ''} onChange={e => set('hours', e.target.value === '' ? null : Number(e.target.value))} /></div>
      </div>
      <div className="field time-billability">
        <label className="chip"><input type="checkbox" checked={d.billable} disabled={billingLocked} onChange={e => set('billable', e.target.checked)} /> Billable</label>
        <p className="small muted">{d.billable ? 'Eligible for invoices and deposit coverage.' : 'Nonbillable — counts toward job hours and effective hourly rate, excluded from invoices.'}</p>
        {billingLocked && <p className="small muted">Unbill these hours in <Link to={`/billing?job=${currentEntry?.job_id}`} onClick={onClose}>Billing</Link> before changing this.</p>}
      </div>
      <div className="row">
        <div className="field" style={{ flex: '0 1 140px' }}><label>Rate ($/hour)</label><input type="number" min="0" step="5" value={d.rate ?? ''} onChange={e => set('rate', e.target.value === '' ? null : Number(e.target.value))} /></div>
        <div className="field"><label>Notes</label><input value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="What did you work on?" /></div>
      </div>
      {d.hours != null && d.rate != null && <p className="small muted">{d.billable ? `Billable value: ${fmtMoney(d.hours * d.rate)}.` : `Work value: ${fmtMoney(d.hours * d.rate)}. This time will not be invoiced.`}</p>}
      {currentEntry?.billed && <p className="small muted">These hours are already on an invoice. Changing them won't change the invoice amount.</p>}
    </Modal>
  )
}

/* =============== Invoice =============== */
export function InvoiceModal({ invoice, jobId, entryIds, itemIds, defaultAmount, onClose }: { invoice?: Invoice; jobId: string; entryIds?: string[]; itemIds?: string[]; defaultAmount?: number; onClose: () => void }) {
  const store = useData()
  const { invoices, recordInvoice, update, remove, toast } = store
  const [selection] = useState(() => {
    try { return { links: invoiceWorkLinks(store, jobId, entryIds ?? [], itemIds ?? []), error: null } }
    catch (e) { return { links: [], error: (e as Error).message } }
  })
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [d, setD] = useState({
    number: invoice?.number ?? suggestInvoiceNumber(invoices),
    amount: invoice?.amount ?? Math.round(defaultAmount ?? 0),
    issued_date: invoice?.issued_date ?? todayISO(),
    paid_date: invoice?.paid_date ?? null as string | null,
    notes: invoice?.notes ?? '',
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  async function save() {
    if (busy.current) return
    busy.current = true; setSaving(true)
    try {
      if (invoice) {
        if (!await update('invoices', invoice.id, d)) return
      } else {
        if (selection.error) { toast(selection.error, 'error'); return }
        // The database validates these opening values and saves the invoice
        // and every selected row together, or rolls the whole operation back.
        if (!await recordInvoice({ ...d, job_id: jobId }, selection.links)) return
        if (selection.links.length) toast('Selected hours and charges marked as billed')
      }
      onClose()
    } catch (e) { toast((e as Error).message, 'error') }
    finally { busy.current = false; setSaving(false) }
  }
  async function del() {
    if (!invoice || !confirm('Delete this invoice? Hours on it will become unbilled again.')) return
    if (await remove('invoices', invoice.id)) onClose()
  }
  return (
    <Modal title={invoice ? 'Edit invoice' : 'Record invoice'} onClose={onClose} footer={<>
      {invoice && <button className="btn danger left" onClick={del} disabled={saving}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </>}>
      {((entryIds?.length ?? 0) + (itemIds?.length ?? 0)) > 0 && <p className="small muted">{[entryIds?.length ? `${entryIds.length} time entr${entryIds.length === 1 ? 'y' : 'ies'}` : '', itemIds?.length ? `${itemIds.length} charge${itemIds.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')} will be marked as billed on this invoice.</p>}
      <div className="row">
        <div className="field"><label>Invoice #</label><input value={d.number} onChange={e => set('number', e.target.value)} /></div>
        <div className="field"><label>Amount ($)</label><input autoFocus type="number" min="0" step="1" value={d.amount} onChange={e => set('amount', Number(e.target.value))} /></div>
      </div>
      <div className="row">
        <div className="field"><label>Issued</label><input type="date" value={d.issued_date} onChange={e => set('issued_date', e.target.value)} /></div>
        <div className="field"><label>Paid on (blank = outstanding)</label><input type="date" value={d.paid_date ?? ''} onChange={e => set('paid_date', e.target.value || null)} /></div>
      </div>
      <div className="field"><label>Notes</label><input value={d.notes} onChange={e => set('notes', e.target.value)} /></div>
    </Modal>
  )
}

function suggestInvoiceNumber(invoices: Invoice[]): string {
  const nums = invoices.map(i => parseInt(i.number.replace(/\D/g, ''), 10)).filter(n => !isNaN(n))
  return `INV-${String((nums.length ? Math.max(...nums) : 1000) + 1).padStart(4, '0')}`
}

/* =============== Deposit =============== */
export function DepositModal({ deposit, jobId, onClose }: { deposit?: Deposit; jobId?: string; onClose: () => void }) {
  const { jobs, clients, insert, update, remove, toast } = useData()
  const openJobs = jobs.filter(j => j.status !== 'archived')
  const [d, setD] = useState({
    job_id: deposit?.job_id ?? jobId ?? openJobs[0]?.id ?? '',
    amount: deposit?.amount ?? (null as number | null),
    received_date: deposit?.received_date ?? todayISO(),
    method: deposit?.method ?? 'Check',
    notes: deposit?.notes ?? '',
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  async function save() {
    if (!d.job_id || !d.amount || d.amount <= 0) { toast('Enter the job and the amount', 'error'); return }
    if (deposit) await update('deposits', deposit.id, { ...d, amount: d.amount })
    else { await insert('deposits', { ...d, amount: d.amount }); toast('Deposit recorded') }
    onClose()
  }
  async function del() { if (deposit && confirm('Delete this deposit?')) { await remove('deposits', deposit.id); onClose() } }
  return (
    <Modal title={deposit ? 'Edit deposit' : 'Record deposit'} onClose={onClose} footer={<>
      {deposit && <button className="btn danger left" onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save}>Save</button>
    </>}>
      <div className="field">
        <label>Job</label>
        <select value={d.job_id} onChange={e => set('job_id', e.target.value)} disabled={Boolean(jobId && !deposit)}>
          {openJobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `${j.job_number} · ` : ''}{j.name} ({clients.find(c => c.id === j.client_id)?.name})</option>)}
        </select>
      </div>
      <div className="row">
        <div className="field"><label>Amount ($)</label><input autoFocus type="number" min="0" step="50" value={d.amount ?? ''} onChange={e => set('amount', e.target.value === '' ? null : Number(e.target.value))} /></div>
        <div className="field"><label>Received</label><input type="date" value={d.received_date} onChange={e => set('received_date', e.target.value)} /></div>
        <div className="field">
          <label>How paid</label>
          <select value={d.method} onChange={e => set('method', e.target.value)}>
            {['Check', 'ACH / transfer', 'Credit card', 'Cash', 'Other'].map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>Notes</label><input value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Retainer at signing, check #1043" /></div>
      <p className="small muted">The deposit pays for hours on this job as they are logged, oldest first. Once it is used up, new hours show as "Not billed" until you send an invoice.</p>
    </Modal>
  )
}

/* =============== Charge (billable item other than hours) =============== */
export function ItemModal({ item, jobId, onClose }: { item?: JobItem; jobId?: string; onClose: () => void }) {
  const { jobs, clients, me, insert, update, remove, toast } = useData()
  const openJobs = jobs.filter(j => j.status !== 'archived')
  const [d, setD] = useState({
    job_id: item?.job_id ?? jobId ?? openJobs[0]?.id ?? '',
    date: item?.date ?? todayISO(),
    category: item?.category ?? 'Expense',
    description: item?.description ?? '',
    quantity: item?.quantity ?? 1 as number | null,
    unit_price: item?.unit_price ?? (null as number | null),
  })
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const amount = (d.quantity ?? 0) * (d.unit_price ?? 0)
  const miles = d.category === 'Mileage'
  async function save() {
    if (!d.job_id || !d.unit_price || !d.quantity) { toast('Enter the amount', 'error'); return }
    const credit = item?.billed ? item.deposit_applied ?? 0 : 0
    if (item && credit > 0 && (d.job_id !== item.job_id || amount < credit)) {
      toast('Unbill this charge before moving it to another job or reducing its value below the applied deposit.', 'error'); return
    }
    const row = { ...d, quantity: d.quantity, unit_price: d.unit_price, description: d.description.trim() }
    if (item) { if (!await update('job_items', item.id, row)) return }
    else { if (!await insert('job_items', { ...row, created_by: me?.id ?? null })) return; toast('Charge added') }
    onClose()
  }
  async function del() { if (item && confirm('Delete this charge?')) { await remove('job_items', item.id); onClose() } }
  return (
    <Modal title={item ? 'Edit charge' : 'Add charge'} onClose={onClose} footer={<>
      {item && <button className="btn danger left" onClick={del}>Delete</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save}>Save {amount > 0 ? fmtMoney(amount) : ''}</button>
    </>}>
      <div className="field">
        <label>Job</label>
        <select value={d.job_id} onChange={e => set('job_id', e.target.value)} disabled={Boolean(jobId && !item)}>
          {openJobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `${j.job_number} · ` : ''}{j.name} ({clients.find(c => c.id === j.client_id)?.name})</option>)}
        </select>
      </div>
      <div className="row">
        <div className="field">
          <label>Type</label>
          <select value={d.category} onChange={e => set('category', e.target.value)}>
            {ITEM_CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="field"><label>Date</label><input type="date" value={d.date} onChange={e => set('date', e.target.value)} /></div>
      </div>
      <div className="field"><label>Description</label><input autoFocus value={d.description} onChange={e => set('description', e.target.value)} placeholder={miles ? 'e.g. Site visit round trip' : 'e.g. County plan-check fee, plotting 24x36 sets'} /></div>
      <div className="row">
        <div className="field"><label>{miles ? 'Miles' : 'Quantity'}</label><input type="number" min="0" step={miles ? '1' : '0.5'} value={d.quantity ?? ''} onChange={e => set('quantity', e.target.value === '' ? null : Number(e.target.value))} /></div>
        <div className="field"><label>{miles ? '$ per mile' : 'Price each ($)'}</label><input type="number" min="0" step="0.01" value={d.unit_price ?? ''} onChange={e => set('unit_price', e.target.value === '' ? null : Number(e.target.value))} /></div>
        <div className="field"><label>Amount</label><input readOnly value={fmtMoney(amount)} /></div>
      </div>
      {item?.billed && <p className="small muted">This charge is already on an invoice. Changing it won't change the invoice amount.</p>}
      <p className="small muted">Charges count against the job balance like hours do: a deposit pays for them first, otherwise they show as "Not billed" until you put them on an invoice.</p>
    </Modal>
  )
}
