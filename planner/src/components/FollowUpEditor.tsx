import { useId, useRef, useState } from 'react'
import { useData } from '../lib/store'
import { usePlanning } from '../lib/planningStore'
import type { FollowUp } from '../lib/planningTypes'
import { validPlanningDate } from '../lib/followUps'
import { fmtDate, fmtMoney, todayISO } from '../lib/utils'
import { Modal } from './ui'
import './FollowUpEditor.css'

export interface FollowUpEditorProps {
  followUp?: FollowUp
  defaults?: { job_id?: string | null; invoice_id?: string | null; title?: string }
  onClose: () => void
}
type Draft = Pick<FollowUp, 'job_id' | 'invoice_id' | 'title' | 'waiting_on' | 'reason' | 'status' | 'next_follow_up_date' | 'promised_date' | 'invoice_due_date' | 'contact_log' | 'notes'>

export function FollowUpEditor(props: FollowUpEditorProps) {
  const planning = usePlanning()
  const [source, setSource] = useState(() => props.followUp ?? planning.followUps.find(row => Boolean(props.defaults?.invoice_id) && row.invoice_id === props.defaults?.invoice_id))
  const [generation, setGeneration] = useState(0)
  return <FollowUpForm key={generation} source={source} defaults={props.defaults} onClose={props.onClose} onReload={row => { setSource(row); setGeneration(value => value + 1) }} />
}

function FollowUpForm({ source, defaults, onClose, onReload }: { source?: FollowUp; defaults?: FollowUpEditorProps['defaults']; onClose: () => void; onReload: (row: FollowUp) => void }) {
  const store = useData(), planning = usePlanning()
  const formId = useId(), busy = useRef(false)
  const [id] = useState(() => source?.id ?? crypto.randomUUID())
  const [draft, setDraft] = useState<Draft>(() => {
    const invoice = store.invoices.find(invoice => invoice.id === defaults?.invoice_id)
    return source ? { job_id: source.job_id, invoice_id: source.invoice_id, title: source.title, waiting_on: source.waiting_on, reason: source.reason, status: source.status, next_follow_up_date: source.next_follow_up_date, promised_date: source.promised_date, invoice_due_date: source.invoice_due_date, contact_log: [...source.contact_log], notes: source.notes } : {
      job_id: invoice?.job_id ?? defaults?.job_id ?? null, invoice_id: defaults?.invoice_id ?? null, title: defaults?.title ?? '', waiting_on: '', reason: '', status: 'open', next_follow_up_date: todayISO(), promised_date: null, invoice_due_date: null, contact_log: [], notes: '',
    }
  })
  const [contactDate, setContactDate] = useState(todayISO), [contactNote, setContactNote] = useState(''), [contactPromise, setContactPromise] = useState('')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [key]: value }))
  const current = planning.followUps.find(row => row.id === id)
  const duplicate = draft.invoice_id ? planning.followUps.find(row => row.invoice_id === draft.invoice_id && row.id !== id) : undefined
  const sharedChanged = Boolean(source && (!current || current.revision !== source.revision))
  const reloadable = duplicate ?? current
  const availableJobs = store.jobs.filter(job => job.status === 'active' || job.status === 'on_hold' || job.id === source?.job_id || store.invoices.some(invoice => invoice.job_id === job.id && !invoice.paid_date && invoice.amount > 0.005))
  const invoices = store.invoices.filter(invoice => (!draft.job_id || invoice.job_id === draft.job_id) && (invoice.amount > 0.005 && !invoice.paid_date || invoice.id === draft.invoice_id))
  const invoice = store.invoices.find(invoice => invoice.id === draft.invoice_id)
  const close = () => { if (!busy.current) onClose() }

  function addContact(): Draft | null {
    if (!contactNote.trim()) { setError('Enter a contact note before adding it.'); return null }
    if (!validPlanningDate(contactDate) || contactDate > todayISO() || contactPromise && !validPlanningDate(contactPromise)) { setError('Use a valid contact date through today and a valid promised date.'); return null }
    const next = { ...draft, contact_log: [...draft.contact_log, { id: crypto.randomUUID(), date: contactDate, note: contactNote.trim(), promised_date: contactPromise || null }], ...(contactPromise ? { promised_date: contactPromise } : {}) }
    setDraft(next); setContactNote(''); setContactPromise(''); setError('')
    return next
  }
  async function save() {
    if (busy.current) return
    setError('')
    if (planning.loading || planning.error) { setError('Shared follow-ups are unavailable. Your draft is kept; retry loading before saving.'); return }
    if (sharedChanged || duplicate) { setError('The shared follow-up changed. Your draft is still here. Load the saved version before editing it again.'); return }
    if (!draft.title.trim()) { setError('Give this follow-up a title.'); return }
    if (draft.job_id && !store.jobs.some(job => job.id === draft.job_id)) { setError('Choose an available job or General business.'); return }
    if (draft.invoice_id && (!invoice || invoice.job_id !== draft.job_id)) { setError('Choose an invoice that belongs to the selected job.'); return }
    if ([draft.next_follow_up_date, draft.promised_date, draft.invoice_due_date].some(date => date && !validPlanningDate(date))) { setError('Enter valid follow-up, promised, and invoice due dates.'); return }
    if (contactPromise && !contactNote.trim()) { setError('Add a contact note to record the new promise.'); return }
    const row = contactNote.trim() ? addContact() : draft
    if (!row) return
    busy.current = true; setSaving(true)
    try {
      const saved = await planning.save('follow_ups', { ...row, id, title: row.title.trim(), waiting_on: row.waiting_on.trim(), reason: row.reason.trim() }, source?.revision)
      if (saved) onClose()
      else setError('The follow-up was not saved. Your draft is still here; check for a shared update before retrying.')
    } catch { setError('Could not confirm the save. Your draft is still here; check the saved follow-ups before retrying.') }
    finally { busy.current = false; setSaving(false) }
  }

  return <Modal title={source ? 'Edit follow-up' : 'New follow-up'} className="follow-up-editor" onClose={close} footer={<><button type="button" className="btn" disabled={saving} onClick={close}>Cancel</button><button type="submit" form={formId} className="btn primary" disabled={saving || planning.loading || Boolean(planning.error)}>{saving ? 'Saving…' : 'Save follow-up'}</button></>}>
    {planning.error && <div className="follow-up-editor-warning" role="alert"><p>Shared follow-ups are unavailable. Your draft is kept. {planning.error}</p><button type="button" className="btn sm" disabled={saving} onClick={() => { void planning.refresh().catch(() => {}) }}>Retry loading follow-ups</button></div>}
    {(sharedChanged || duplicate) && <div className="follow-up-editor-warning" role="status"><p>{duplicate ? 'This invoice already has a shared follow-up.' : 'This follow-up changed elsewhere. Your draft has been kept.'}</p>{reloadable && <button type="button" className="btn sm" disabled={saving} onClick={() => onReload(reloadable)}>Load saved version (replaces draft)</button>}</div>}
    {error && <p className="follow-up-editor-error" role="alert">{error}</p>}
    <form id={formId} noValidate onSubmit={event => { event.preventDefault(); void save() }}><fieldset className="editor-fields" disabled={saving}>
      <label>Follow-up title<input autoFocus aria-label="Follow-up title" value={draft.title} onChange={event => set('title', event.target.value)} placeholder="e.g. Get the missing dimensions" /></label>
      <div className="follow-up-editor-grid"><label>Job<select aria-label="Follow-up job" value={draft.job_id ?? ''} onChange={event => setDraft(previous => ({ ...previous, job_id: event.target.value || null, invoice_id: null }))}><option value="">General business</option>{draft.job_id && !availableJobs.some(job => job.id === draft.job_id) && <option value={draft.job_id}>Saved job</option>}{availableJobs.map(job => <option key={job.id} value={job.id}>{job.job_number ? `${job.job_number} · ` : ''}{job.name}{job.status === 'active' ? '' : ` (${job.status.replace('_', ' ')})`}</option>)}</select></label><label>Invoice (optional)<select aria-label="Follow-up invoice" value={draft.invoice_id ?? ''} onChange={event => { const selected = store.invoices.find(invoice => invoice.id === event.target.value); setDraft(previous => ({ ...previous, invoice_id: selected?.id ?? null, job_id: selected?.job_id ?? previous.job_id })) }}><option value="">No invoice</option>{draft.invoice_id && !invoices.some(invoice => invoice.id === draft.invoice_id) && <option value={draft.invoice_id}>Saved / unavailable invoice</option>}{invoices.map(invoice => <option key={invoice.id} value={invoice.id}>{invoice.number || 'Unnumbered invoice'} · {fmtMoney(invoice.amount)}{invoice.paid_date ? ' · paid' : ''}</option>)}</select></label></div>
      {invoice?.paid_date && <p className="small muted">This invoice is recorded as paid. Mark the follow-up Done if there is nothing left to resolve.</p>}
      <div className="follow-up-editor-grid"><label>Waiting on<input aria-label="Waiting on" value={draft.waiting_on} onChange={event => set('waiting_on', event.target.value)} placeholder="Client, county, architect…" /></label><label>Status<select aria-label="Follow-up status" value={draft.status} onChange={event => set('status', event.target.value as FollowUp['status'])}><option value="open">Open</option><option value="done">Done</option></select></label></div>
      <label>What is needed?<textarea aria-label="Follow-up reason" rows={2} value={draft.reason} onChange={event => set('reason', event.target.value)} /></label>
      <div className="follow-up-editor-grid"><label>Next follow-up<input aria-label="Next follow-up date" type="date" value={draft.next_follow_up_date ?? ''} onChange={event => set('next_follow_up_date', event.target.value || null)} /></label><label>Promised date<input aria-label="Promised date" type="date" value={draft.promised_date ?? ''} onChange={event => set('promised_date', event.target.value || null)} /></label><label>Invoice due date<input aria-label="Invoice due date" type="date" value={draft.invoice_due_date ?? ''} onChange={event => set('invoice_due_date', event.target.value || null)} /></label></div>
      <p className="tiny muted">A follow-up date is when you will check in. A promised or invoice due date records what was agreed.</p>
      <label>Notes<textarea aria-label="Follow-up notes" rows={2} value={draft.notes} onChange={event => set('notes', event.target.value)} /></label>
      <section className="follow-up-contact-section" aria-label="Contact history"><h3>Contact history</h3>{draft.contact_log.length ? <ol>{[...draft.contact_log].sort((a, b) => b.date.localeCompare(a.date)).map(contact => <li key={contact.id}><b>{fmtDate(contact.date)}</b> · {contact.note}{contact.promised_date && <span className="small muted"> · promised {fmtDate(contact.promised_date)}</span>}</li>)}</ol> : <p className="small muted">No contact recorded yet.</p>}
        <div className="follow-up-editor-grid"><label>Contact date<input aria-label="Contact date" type="date" max={todayISO()} value={contactDate} onChange={event => setContactDate(event.target.value)} /></label><label>New promise (optional)<input aria-label="Contact promised date" type="date" value={contactPromise} onChange={event => setContactPromise(event.target.value)} /></label></div><label>Contact note<textarea aria-label="Contact note" rows={2} value={contactNote} onChange={event => setContactNote(event.target.value)} placeholder="Called, emailed, or agreed…" /></label><button type="button" className="btn sm" onClick={() => { addContact() }}>Add contact to draft</button><p className="tiny muted">Contact notes are shared when you save this follow-up.</p>
      </section>
    </fieldset></form>
  </Modal>
}
