import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import { usePlanning } from '../lib/planningStore'
import type { JobDecision, JobPlanning as SavedPlan } from '../lib/planningTypes'
import { jobBilling } from '../lib/calc'
import { fmtDate, fmtHourlyRate, fmtHours, fmtMoney, todayISO } from '../lib/utils'
import './JobPlanning.css'

const billingLabels = { undecided: 'Undecided', billable: 'Billable extra', included: 'Included in fee', nonbillable: 'Nonbillable' }
const approvalLabels = { not_needed: 'Not needed', needed: 'Approval needed', approved: 'Approved', declined: 'Declined' }
type PlanDraft = { id: string; original?: SavedPlan; status_update: string; next_deliverable: string; remaining_hours: string; internal_target_date: string; client_commitment_date: string }
type DecisionDraft = { id: string; original?: JobDecision; kind: JobDecision['kind']; title: string; notes: string; estimated_hours: string; billing_treatment: JobDecision['billing_treatment']; approval: JobDecision['approval']; recorded_date: string }
const planDraft = (plan?: SavedPlan): PlanDraft => ({ id: plan?.id ?? crypto.randomUUID(), original: plan, status_update: plan?.status_update ?? '', next_deliverable: plan?.next_deliverable ?? '', remaining_hours: plan?.remaining_hours == null ? '' : String(plan.remaining_hours), internal_target_date: plan?.internal_target_date ?? '', client_commitment_date: plan?.client_commitment_date ?? '' })
const decisionDraft = (record?: JobDecision): DecisionDraft => ({ id: record?.id ?? crypto.randomUUID(), original: record, kind: record?.kind ?? 'scope_change', title: record?.title ?? '', notes: record?.notes ?? '', estimated_hours: record?.estimated_hours == null ? '' : String(record.estimated_hours), billing_treatment: record?.billing_treatment ?? 'undecided', approval: record?.approval ?? 'needed', recorded_date: record?.recorded_date ?? todayISO() })
function validDate(value: string) { const date = new Date(`${value}T12:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value }
const validHours = (value: string) => !value.trim() || Number.isFinite(Number(value)) && Number(value) >= 0

/** Planning context is independent of saved phase estimates, time, and billing. */
export function JobPlanning({ jobId }: { jobId: string }) {
  const store = useData(), planning = usePlanning()
  const job = store.jobs.find(job => job.id === jobId)
  const saved = planning.jobPlanning.find(plan => plan.job_id === jobId)
  const decisions = planning.decisions.filter(record => record.job_id === jobId).sort((a, b) => b.recorded_date.localeCompare(a.recorded_date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  const [draft, setDraft] = useState<PlanDraft | null>(null)
  const [decision, setDecision] = useState<DecisionDraft | null>(null)
  const [allDecisions, setAllDecisions] = useState(false)
  const lock = useRef(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  if (!job) return null
  const billing = jobBilling(store, job)
  const unavailable = planning.loading || Boolean(planning.error)
  const newerPlan = draft && (saved?.revision !== draft.original?.revision || saved?.id !== draft.original?.id)
  const currentDecision = decision && planning.decisions.find(record => record.id === decision.id)
  const newerDecision = decision?.original && currentDecision?.revision !== decision.original.revision

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || lock.current || unavailable) return
    if (!validHours(draft.remaining_hours) || [draft.internal_target_date, draft.client_commitment_date].some(date => date && !validDate(date))) { setError('Enter a valid date and a remaining estimate of zero or more hours.'); return }
    if (newerPlan) { setError('The saved plan changed. Your draft is still here. Cancel to review the latest plan before editing again.'); return }
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const result = await planning.save('job_planning', { id: draft.id, job_id: jobId, status_update: draft.status_update, next_deliverable: draft.next_deliverable, remaining_hours: draft.remaining_hours.trim() ? Number(draft.remaining_hours) : null, internal_target_date: draft.internal_target_date || null, client_commitment_date: draft.client_commitment_date || null }, draft.original?.revision)
      if (result) { setDraft(null); setMessage('Job plan saved.') }
      else setError('The plan was not saved. Your draft is still here; review any newer saved version before retrying.')
    } catch { setError('Could not confirm the save. Your draft is still here. Check the saved plan before retrying.') }
    finally { lock.current = false; setBusy(false) }
  }
  async function saveDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!decision || lock.current || unavailable) return
    if (!decision.title.trim() || !validHours(decision.estimated_hours) || !validDate(decision.recorded_date)) { setError('Enter a title, valid recorded date, and an estimate of zero or more hours.'); return }
    if (newerDecision) { setError('This saved record changed. Your draft is still here. Cancel to review the latest record before editing again.'); return }
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const result = await planning.save('job_decisions', { id: decision.id, job_id: jobId, kind: decision.kind, title: decision.title.trim(), notes: decision.notes, estimated_hours: decision.estimated_hours.trim() ? Number(decision.estimated_hours) : null, billing_treatment: decision.billing_treatment, approval: decision.approval, recorded_date: decision.recorded_date }, decision.original?.revision)
      if (result) { setDecision(null); setMessage('Decision record saved. Hours and billing were not changed.') }
      else setError('The record was not saved. Your draft is still here; review any newer saved version before retrying.')
    } catch { setError('Could not confirm the save. Your draft is still here. Check the history before retrying.') }
    finally { lock.current = false; setBusy(false) }
  }
  function closeDraft() { if (!lock.current) { setDraft(null); setDecision(null); setError('') } }
  return <section className="card job-planning" id="job-planning" aria-labelledby="job-planning-title">
    <div className="job-planning-heading"><h2 id="job-planning-title">Progress &amp; next deliverable</h2>{!draft && !decision && <button className="btn" disabled={unavailable} onClick={() => { setDraft(planDraft(saved)); setError(''); setMessage('') }}>Edit plan</button>}</div>
    {planning.loading && <p role="status" className="small muted">Loading saved planning context…</p>}
    {planning.error && <p role="alert">Planning records are unavailable. {planning.error}</p>}
    {error && <p className="job-planning-error" role="alert">{error}</p>}{message && <p role="status" className="small">{message}</p>}
    {draft ? <form onSubmit={savePlan} aria-label="Job plan"><fieldset disabled={busy}>
      {newerPlan && <p role="status" className="job-planning-error">A newer saved plan is available. Your draft has been kept.</p>}
      <label>Status update<textarea aria-label="Status update" value={draft.status_update} onChange={event => setDraft({ ...draft, status_update: event.target.value })} rows={2} /></label>
      <label>Next deliverable<input aria-label="Next deliverable" value={draft.next_deliverable} onChange={event => setDraft({ ...draft, next_deliverable: event.target.value })} /></label>
      <div className="job-planning-fields"><label>Remaining work estimate (hours)<input aria-label="Remaining work estimate (hours)" type="number" min="0" step="0.25" value={draft.remaining_hours} onChange={event => setDraft({ ...draft, remaining_hours: event.target.value })} /></label><label>Internal target date<input aria-label="Internal target date" type="date" value={draft.internal_target_date} onChange={event => setDraft({ ...draft, internal_target_date: event.target.value })} /></label><label>Client commitment date<input aria-label="Client commitment date" type="date" value={draft.client_commitment_date} onChange={event => setDraft({ ...draft, client_commitment_date: event.target.value })} /></label></div>
      <p className="tiny muted">This is your current work estimate. Saving it does not change phase estimates or planned hours. An internal target is separate from a date promised to the client.</p>
      <div className="job-planning-actions"><button className="btn primary" type="submit" disabled={unavailable || Boolean(newerPlan)}>{busy ? 'Saving…' : 'Save plan'}</button><button className="btn" type="button" onClick={closeDraft}>Cancel</button></div>
    </fieldset></form> : <><p className="job-planning-copy">{saved?.status_update || 'No status update recorded.'}</p><dl className="job-planning-facts"><div><dt>Next deliverable</dt><dd>{saved?.next_deliverable || 'Not recorded'}</dd></div><div><dt>Remaining work estimate</dt><dd>{saved?.remaining_hours == null ? 'Not recorded' : fmtHours(saved.remaining_hours)}</dd></div><div><dt>Internal target</dt><dd>{saved?.internal_target_date ? fmtDate(saved.internal_target_date) : 'Not set'}</dd></div><div><dt>Client commitment</dt><dd>{saved?.client_commitment_date ? fmtDate(saved.client_commitment_date) : 'Not set'}</dd></div></dl></>}
    <div className="job-planning-money small"><Link to={`/billing?job=${jobId}&section=overview`}>{fmtHourlyRate(billing.effectiveHourlyRate)} recorded hourly return</Link><span>{fmtHours(billing.loggedHours)} completed, including {fmtHours(billing.nonBillableHours)} nonbillable · {fmtMoney(billing.unbilledAmount)} ready to bill</span><span className="tiny muted">Recorded deposits + invoices, less funded separate charges, divided by all completed hours. Deposits count once; running timers are excluded.</span></div>
    <div className="job-planning-heading job-decisions-heading"><h3>Decisions &amp; scope changes <span className="muted">({decisions.length})</span></h3>{!decision && !draft && <button className="btn" disabled={unavailable} onClick={() => { setDecision(decisionDraft()); setError(''); setMessage('') }}>Record decision or change</button>}</div>
    <p className="tiny muted">Record agreed scope, effort, and billing intent. These records do not add hours, charges, or invoices.</p>
    {decision && <form onSubmit={saveDecision} aria-label="Decision or scope change"><fieldset disabled={busy}>
      {newerDecision && <p role="status" className="job-planning-error">A newer saved record is available. Your draft has been kept.</p>}
      <div className="job-planning-fields"><label>Record type<select aria-label="Record type" value={decision.kind} onChange={event => setDecision({ ...decision, kind: event.target.value as JobDecision['kind'] })}><option value="scope_change">Scope change</option><option value="decision">Decision</option></select></label><label>Recorded date<input aria-label="Recorded date" type="date" required value={decision.recorded_date} onChange={event => setDecision({ ...decision, recorded_date: event.target.value })} /></label></div>
      <label>Title<input aria-label="Title" required value={decision.title} onChange={event => setDecision({ ...decision, title: event.target.value })} /></label><label>Notes<textarea aria-label="Notes" rows={3} value={decision.notes} onChange={event => setDecision({ ...decision, notes: event.target.value })} /></label>
      <div className="job-planning-fields"><label>Estimated effort (hours)<input aria-label="Estimated effort (hours)" type="number" min="0" step="0.25" value={decision.estimated_hours} onChange={event => setDecision({ ...decision, estimated_hours: event.target.value })} /></label><label>Billing treatment<select aria-label="Billing treatment" value={decision.billing_treatment} onChange={event => setDecision({ ...decision, billing_treatment: event.target.value as JobDecision['billing_treatment'] })}>{Object.entries(billingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Approval<select aria-label="Approval" value={decision.approval} onChange={event => setDecision({ ...decision, approval: event.target.value as JobDecision['approval'] })}>{Object.entries(approvalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="job-planning-actions"><button className="btn primary" type="submit" disabled={unavailable || Boolean(newerDecision)}>{busy ? 'Saving…' : 'Save record'}</button><button className="btn" type="button" onClick={closeDraft}>Cancel</button></div>
    </fieldset></form>}
    <div className="job-decision-list">{(allDecisions ? decisions : decisions.slice(0, 5)).map(record => <details key={record.id}><summary><span><b>{record.title}</b><span className="tiny muted">{fmtDate(record.recorded_date)} · {record.kind === 'scope_change' ? 'Scope change' : 'Decision'} · {billingLabels[record.billing_treatment]} · {approvalLabels[record.approval]}</span></span></summary><div className="job-decision-body"><p className="job-planning-copy">{record.notes || 'No notes recorded.'}</p>{record.estimated_hours != null && <p className="small muted">Estimated effort: {fmtHours(record.estimated_hours)}</p>}<button className="btn" disabled={busy || Boolean(draft) || Boolean(decision) || unavailable} aria-label={`Edit record: ${record.title}`} onClick={() => { setDecision(decisionDraft(record)); setError(''); setMessage('') }}>Edit record</button></div></details>)}</div>
    {decisions.length > 5 && <button className="btn" onClick={() => setAllDecisions(!allDecisions)}>{allDecisions ? 'Show recent records' : `Show all ${decisions.length} records`}</button>}
    {!decisions.length && !decision && <p className="small muted">No decisions or scope changes recorded.</p>}
  </section>
}
