import { useEffect, useRef, useState } from 'react'
import { addDays, format } from 'date-fns'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { usePlanning } from '../lib/planningStore'
import type { DailyReview, FollowUp, ReviewPriority } from '../lib/planningTypes'
import { carryPriorities, priorReview, reviewActivity } from '../lib/review'
import { validPlanningDate } from '../lib/followUps'
import { calendarItems } from '../lib/calendar'
import { jobRows } from '../lib/jobs'
import { dayCapacity } from '../lib/planningCapacity'
import { fmtDate, fmtDateTime, fmtHours, fmtMoney, sum, todayISO } from '../lib/utils'
import { Icon } from '../components/ui'
import { FollowUpEditor } from '../components/FollowUpEditor'
import './MorningReview.css'

export function MorningReview() {
  const planning = usePlanning()
  const [params, setParams] = useSearchParams(), [defaultDate, setDefaultDate] = useState(todayISO)
  const requested = params.get('date') ?? defaultDate
  const date = validPlanningDate(requested) && requested <= todayISO() ? requested : defaultDate
  return <div className="morning-review-page">
    <div className="page-header"><div><h1>Morning review</h1><p className="small muted">Agree on the day, record decisions, and carry the next steps forward.</p></div><div className="actions"><label className="morning-review-date">Review date<input type="date" aria-label="Review date" max={todayISO()} value={date} onChange={event => { if (validPlanningDate(event.target.value) && event.target.value <= todayISO()) { const value = event.target.value; if (value === todayISO()) setDefaultDate(value); setParams(current => { const next = new URLSearchParams(current); if (value === todayISO()) next.delete('date'); else next.set('date', value); return next }) } }} /></label><button type="button" className="btn" onClick={() => { setDefaultDate(todayISO()); setParams(current => { const next = new URLSearchParams(current); next.delete('date'); return next }) }}>Today</button></div></div>
    {planning.error && <div className="card review-error" role="alert"><p>Shared planning records could not be loaded: {planning.error}</p><button type="button" className="btn" onClick={() => { void planning.refresh().catch(() => {}) }}>Retry loading</button></div>}
    {planning.loading ? <p className="card" role="status">Loading the shared review…</p> : <ReviewWorkspace key={date} date={date} />}
  </div>
}

function ReviewWorkspace({ date }: { date: string }) {
  const store = useData(), planning = usePlanning()
  const [saved, setSaved] = useState(() => planning.reviews.find(review => review.review_date === date))
  const [id, setId] = useState(() => saved?.id ?? crypto.randomUUID())
  const [priorities, setPriorities] = useState<ReviewPriority[]>(() => saved?.priorities.map(priority => ({ ...priority })) ?? Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), title: '', job_id: null, done: false })))
  const [notes, setNotes] = useState(saved?.notes ?? '')
  const [editing, setEditing] = useState(() => date === todayISO() && !saved?.completed_at)
  const [dirty, setDirty] = useState(false), [pending, setPending] = useState<'save' | 'complete' | null>(null), busy = useRef(false)
  const [error, setError] = useState(''), [now, setNow] = useState(() => new Date()), [showAllActivity, setShowAllActivity] = useState(false)
  const [followUp, setFollowUp] = useState<FollowUp | null>(null)
  useEffect(() => { const update = () => setNow(new Date()); const timer = window.setInterval(update, 60_000); window.addEventListener('focus', update); return () => { window.clearInterval(timer); window.removeEventListener('focus', update) } }, [])
  const latest = planning.reviews.find(review => review.review_date === date)
  const sharedChanged = Boolean(latest ? latest.id !== saved?.id || latest.revision !== saved?.revision : saved)
  const previous = priorReview(planning.reviews, date)
  const cutoff = saved?.checkpoint_at ?? now.toISOString()
  const since = previous?.checkpoint_at ?? new Date(`${date}T00:00:00`).toISOString()
  const activity = reviewActivity(store, planning.events, since, cutoff)
  const shownActivity = showAllActivity ? activity : activity.slice(0, 8)
  const carryCount = previous?.priorities.filter(priority => !priority.done && priority.title.trim() && !priorities.some(current => (current.source_id ?? current.id) === (priority.source_id ?? priority.id))).length ?? 0
  const operationalIds = new Set(store.jobs.filter(job => job.status === 'active' || job.status === 'on_hold').map(job => job.id))
  const deadlines = calendarItems({ ...store, jobs: store.jobs.filter(job => operationalIds.has(job.id)) }).filter(item => !item.done && item.date <= date)
  const dueFollowUps = planning.followUps.filter(row => row.status === 'open' && row.next_follow_up_date && row.next_follow_up_date <= date).sort((a, b) => a.next_follow_up_date!.localeCompare(b.next_follow_up_date!))
  const billingRows = jobRows(store, now).filter(row => row.job.status !== 'archived')
  const ready = sum(billingRows.map(row => row.billing.unbilledAmount)), unpaid = sum(billingRows.map(row => row.billing.outstanding))
  const capacity = dayCapacity(store, planning, date)
  const decisions = planning.decisions.filter(decision => decision.recorded_date <= date && (decision.approval === 'needed' || decision.kind === 'scope_change' && decision.billing_treatment === 'undecided')).sort((a, b) => b.recorded_date.localeCompare(a.recorded_date))
  const targetEnd = format(addDays(new Date(`${date}T12:00:00`), 6), 'yyyy-MM-dd')
  const targets = planning.jobPlanning.filter(plan => operationalIds.has(plan.job_id)).flatMap(plan => [
    ...(plan.client_commitment_date ? [{ id: `${plan.id}-client`, jobId: plan.job_id, date: plan.client_commitment_date, label: 'Client commitment' }] : []),
    ...(plan.internal_target_date ? [{ id: `${plan.id}-internal`, jobId: plan.job_id, date: plan.internal_target_date, label: 'Internal target' }] : []),
  ]).filter(target => target.date <= targetEnd).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
  const noHistoricalReview = date < todayISO() && !saved && !latest
  const jobName = (jobId: string | null) => store.jobs.find(job => job.id === jobId)?.name ?? (jobId ? 'Saved job' : 'General business')

  function load(row: DailyReview) {
    if (busy.current) return
    setSaved(row); setId(row.id); setPriorities(row.priorities.map(priority => ({ ...priority }))); setNotes(row.notes); setDirty(false); setError(''); setEditing(true)
  }
  function updatePriority(priorityId: string, patch: Partial<ReviewPriority>) { setPriorities(previous => previous.map(priority => priority.id === priorityId ? { ...priority, ...patch } : priority)); setDirty(true) }
  async function save(complete: boolean) {
    if (busy.current || noHistoricalReview) return
    if (planning.loading || planning.error) { setError('Shared reviews are unavailable. Your draft is kept; retry loading before saving.'); return }
    if (sharedChanged) { setError('The shared review changed. Your draft is still here. Load the saved version before editing it again.'); return }
    busy.current = true; setPending(complete ? 'complete' : 'save'); setError('')
    const clean = priorities.filter(priority => priority.title.trim()).map(priority => ({ ...priority, title: priority.title.trim() }))
    try {
      const confirmed = await planning.save('daily_reviews', { id, review_date: date, notes, priorities: clean, completed_at: complete ? new Date().toISOString() : saved?.completed_at ?? null, ...(saved ? { checkpoint_at: saved.checkpoint_at } : {}) }, saved?.revision)
      if (!confirmed) { setError('The review was not saved. Your draft is still here; check for a shared update before retrying.'); return }
      setSaved(confirmed); setId(confirmed.id); setPriorities(confirmed.priorities.map(priority => ({ ...priority }))); setNotes(confirmed.notes); setDirty(false)
      if (complete) setEditing(false)
      store.toast(complete ? 'Morning review completed' : 'Review saved')
    } catch { setError('Could not confirm the review save. Your draft is still here; check the shared review before retrying.') }
    finally { busy.current = false; setPending(null) }
  }

  return <div className="morning-review-grid">
    <div className="morning-review-main">
      <section className="card review-priorities" aria-labelledby="review-priorities-title"><div className="review-section-heading"><div><h2 id="review-priorities-title">Agreed priorities</h2><p className="small muted">Aim for 3–5 clear outcomes. Add more when you need them.</p></div>{saved?.completed_at && <span className="badge done">Review completed</span>}</div>
        {noHistoricalReview ? <p className="review-empty">No review was saved on this date. Choose another date to read its history.</p> : <>
          {sharedChanged && <div className="review-shared-warning" role="status"><p>This review changed elsewhere. Your unsaved draft has been kept.</p>{latest && <button type="button" className="btn sm" disabled={pending !== null} onClick={() => load(latest)}>Load saved version (replaces draft)</button>}</div>}
          {!editing && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit saved review</button>}
          {editing && previous && <div className="review-carry"><span className="small muted">Last review: {fmtDate(previous.review_date)}</span><button type="button" className="btn sm" disabled={pending !== null || carryCount === 0} onClick={() => { setPriorities(current => carryPriorities(current.filter(priority => priority.title.trim()), previous.priorities)); setDirty(true) }}>Carry unfinished ({carryCount})</button></div>}
          {editing ? <fieldset className="editor-fields" disabled={pending !== null}><ol className="review-priority-list">{priorities.map((priority, index) => <li key={priority.id}><label className="review-priority-check"><input type="checkbox" aria-label={`Priority ${index + 1} done`} checked={priority.done} onChange={event => updatePriority(priority.id, { done: event.target.checked })} /></label><div className="review-priority-fields"><input aria-label={`Priority ${index + 1}`} value={priority.title} placeholder={`Outcome ${index + 1}`} onChange={event => updatePriority(priority.id, { title: event.target.value })} /><select aria-label={`Job for priority ${index + 1}`} value={priority.job_id ?? ''} onChange={event => updatePriority(priority.id, { job_id: event.target.value || null })}><option value="">General business</option>{priority.job_id && !store.jobs.some(job => job.id === priority.job_id) && <option value={priority.job_id}>Unavailable job</option>}{store.jobs.filter(job => operationalIds.has(job.id) || job.id === priority.job_id).map(job => <option key={job.id} value={job.id}>{job.name}</option>)}</select></div><button type="button" className="btn ghost icon" aria-label={`Remove priority ${index + 1}`} onClick={() => { setPriorities(current => current.filter(row => row.id !== priority.id)); setDirty(true) }}><Icon name="close" size={15} /></button></li>)}</ol><button type="button" className="btn sm" onClick={() => { setPriorities(current => [...current, { id: crypto.randomUUID(), title: '', job_id: null, done: false }]); setDirty(true) }}><Icon name="plus" size={14} /> Add priority</button><label className="review-notes">Decisions &amp; meeting notes<textarea aria-label="Review notes" rows={4} value={notes} onChange={event => { setNotes(event.target.value); setDirty(true) }} placeholder="What did you agree? What changed, and why?" /></label></fieldset> : <><ol className="review-saved-priorities">{priorities.filter(priority => priority.title.trim()).map(priority => <li key={priority.id}><span aria-label={priority.done ? 'Done' : 'Open'}>{priority.done ? '✓' : '○'}</span><div>{priority.title}{priority.job_id && <Link to={`/jobs/${priority.job_id}`}>{jobName(priority.job_id)}</Link>}</div></li>)}</ol>{notes && <p className="review-saved-notes">{notes}</p>}{!priorities.length && !notes && <p className="review-empty">No priorities or meeting notes were recorded.</p>}</>}
          {error && <p className="review-error" role="alert">{error}</p>}
          {editing && <div className="review-save-bar"><span className="small muted">{pending ? 'Saving shared review…' : dirty ? 'Unsaved changes' : saved ? 'Saved shared review' : 'Draft · not shared yet'}</span><button type="button" className="btn" disabled={pending !== null || Boolean(planning.error)} onClick={() => void save(false)}>{pending === 'save' ? 'Saving…' : 'Save review'}</button><button type="button" className="btn primary" disabled={pending !== null || Boolean(planning.error)} onClick={() => void save(true)}>{pending === 'complete' ? 'Completing…' : 'Complete review'}</button></div>}
        </>}
      </section>
      <section className="card review-activity" aria-labelledby="review-activity-title"><div className="review-section-heading"><h2 id="review-activity-title">Since the last review</h2><span className="small muted">{activity.length} change{activity.length === 1 ? '' : 's'}</span></div><p className="small muted">{previous ? `After the ${fmtDate(previous.review_date)} review checkpoint` : `Recorded activity on ${fmtDate(date)}`} through {saved ? `the saved checkpoint (${fmtDateTime(cutoff)})` : 'now'}.</p>{activity.length ? <ul className="review-activity-list">{shownActivity.map(item => <li key={item.id}><Link to={item.link}>{item.title}</Link><span className="tiny muted">{jobName(item.jobId)} · {item.dateOnly ? `${fmtDate(item.at)} · date only; time within the day is unknown` : fmtDateTime(item.at)}{item.source === 'recorded' && !item.dateOnly ? ' · saved record date' : ''}</span></li>)}</ul> : <p className="review-empty">No recorded changes in this window.</p>}{activity.length > 8 && <button type="button" className="btn sm" onClick={() => setShowAllActivity(value => !value)}>{showAllActivity ? 'Show fewer changes' : `Show all ${activity.length} changes`}</button>}<p className="tiny muted">Older activity uses saved creation and completion dates where available. Payment dates include the boundary days and may fall before a checkpoint within that day. Edits before change tracking began may be absent. Logged hours show effort, not job progress.</p>{saved && <p className="tiny muted">Changes after this checkpoint stay available for the next review, including changes made during this meeting.</p>}</section>
    </div>
    <aside className="morning-review-agenda" aria-label="Review agenda">
      {date < todayISO() && <p className="tiny muted">The agenda below uses current saved job and billing records. The review notes and activity cutoff above retain this day’s saved review.</p>}
      <section className="card"><div className="review-section-heading"><h2>Today’s plan</h2><Link to={`/availability?date=${date}`}>Plan day →</Link></div><p><b>{fmtHours(capacity.availableHours)}</b> available · <b>{fmtHours(capacity.plannedHours)}</b> planned</p><p className={`small ${capacity.overHours > 0 ? 'review-error' : 'muted'}`}>{capacity.overHours > 0 ? `${fmtHours(capacity.overHours)} over available time` : `${fmtHours(capacity.freeHours)} unplanned`}{capacity.blockedHours > 0 ? ` · ${fmtHours(capacity.blockedHours)} set aside` : ''}</p><Link className="review-agenda-link" to="/jobs?view=gantt">Move planned work →</Link></section>
      <section className="card"><div className="review-section-heading"><h2>Dates to discuss</h2><Link to="/calendar">Calendar →</Link></div>{deadlines.length ? <ul className="review-agenda-list">{deadlines.slice(0, 4).map(item => <li key={item.id}><Link to={item.link}>{item.title}</Link><span>{fmtDate(item.date)} · {item.jobName}</span></li>)}</ul> : <p className="review-empty">No open deadlines through this review date.</p>}{deadlines.length > 4 && <p className="tiny muted">{deadlines.length} dates through this review date; open Calendar for the full list.</p>}</section>
      {targets.length > 0 && <section className="card"><h2>Promises &amp; targets</h2><p className="tiny muted">Past due and the next 7 days. Internal targets stay separate from client commitments.</p><ul className="review-agenda-list">{targets.slice(0, 4).map(target => <li key={target.id}><Link to={`/jobs/${target.jobId}#job-planning`}>{jobName(target.jobId)}</Link><span>{target.label} · {fmtDate(target.date)}</span></li>)}</ul>{targets.length > 4 && <details><summary>Show {targets.length - 4} more dates</summary><ul className="review-agenda-list">{targets.slice(4).map(target => <li key={target.id}><Link to={`/jobs/${target.jobId}#job-planning`}>{jobName(target.jobId)}</Link><span>{target.label} · {fmtDate(target.date)}</span></li>)}</ul></details>}</section>}
      <section className="card"><div className="review-section-heading"><h2>Follow up</h2><Link to="/follow-ups">All follow-ups →</Link></div>{dueFollowUps.length ? <ul className="review-agenda-list">{dueFollowUps.slice(0, 4).map(row => <li key={row.id}><button type="button" className="review-text-button" onClick={() => setFollowUp(row)}>{row.title}</button><span>{row.waiting_on || jobName(row.job_id)} · check {fmtDate(row.next_follow_up_date)}</span></li>)}</ul> : <p className="review-empty">No open follow-ups due through this date.</p>}</section>
      <section className="card"><div className="review-section-heading"><h2>Billing</h2><Link to="/billing">Review billing →</Link></div><dl className="review-money"><div><dt>Ready to bill</dt><dd>{fmtMoney(ready)}</dd></div><div><dt>Awaiting payment</dt><dd>{fmtMoney(unpaid)}</dd></div></dl></section>
      {decisions.length > 0 && <section className="card"><h2>Decisions still open</h2><ul className="review-agenda-list">{decisions.slice(0, 3).map(decision => <li key={decision.id}>{decision.job_id ? <Link to={`/jobs/${decision.job_id}#job-planning`}>{decision.title}</Link> : <b>{decision.title}</b>}<span>{decision.approval === 'needed' ? 'Approval needed' : 'Billing treatment undecided'} · {jobName(decision.job_id)}</span></li>)}</ul></section>}
    </aside>
    {followUp && <FollowUpEditor followUp={followUp} onClose={() => setFollowUp(null)} />}
  </div>
}
