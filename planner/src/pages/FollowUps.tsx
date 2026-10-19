import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { usePlanning } from '../lib/planningStore'
import type { FollowUp } from '../lib/planningTypes'
import { filterFollowUps, latestContact, parseFollowUpQuery, writeFollowUpQuery, type FollowUpQuery } from '../lib/followUps'
import { fmtDate } from '../lib/utils'
import { DueBadge, Icon } from '../components/ui'
import { FollowUpEditor } from '../components/FollowUpEditor'
import './FollowUps.css'

export function FollowUps() {
  const store = useData(), planning = usePlanning()
  const [params, setParams] = useSearchParams(), query = parseFollowUpQuery(params)
  const [editor, setEditor] = useState<FollowUp | 'new' | null>(null)
  const [pending, setPending] = useState(() => new Set<string>()), locks = useRef(new Set<string>())
  const [errors, setErrors] = useState<Record<string, string>>({}), [now, setNow] = useState(() => new Date())
  useEffect(() => { const update = () => setNow(new Date()); const timer = window.setInterval(update, 60_000); window.addEventListener('focus', update); return () => { window.clearInterval(timer); window.removeEventListener('focus', update) } }, [])
  const rows = filterFollowUps(planning.followUps, query, store.jobs, now)
  const unavailable = planning.loading || Boolean(planning.error)
  const selectedJob = store.jobs.find(job => job.id === query.job)
  const filtered = Boolean(query.q.trim() || query.job || query.status !== 'open' || query.due !== 'all')
  const change = (patch: Partial<FollowUpQuery>, replace = false) => setParams(current => writeFollowUpQuery(current, patch), { replace })
  const reset = () => change({ q: '', job: '', status: 'open', due: 'all' })
  async function toggle(row: FollowUp) {
    if (locks.current.has(row.id) || unavailable) return
    locks.current.add(row.id); setPending(previous => new Set(previous).add(row.id)); setErrors(previous => ({ ...previous, [row.id]: '' }))
    try {
      if (!await planning.save('follow_ups', { id: row.id, status: row.status === 'open' ? 'done' : 'open' }, row.revision)) setErrors(previous => ({ ...previous, [row.id]: 'The status was not saved. Check the shared follow-up and try again.' }))
    } catch { setErrors(previous => ({ ...previous, [row.id]: 'Could not confirm the status change. Check the shared follow-up before retrying.' })) }
    finally { locks.current.delete(row.id); setPending(previous => { const next = new Set(previous); next.delete(row.id); return next }) }
  }
  return <div className="follow-ups-page">
    <div className="page-header"><div><h1>Follow-ups</h1><p className="small muted">Keep the next contact, the last conversation, and promises together.</p></div><div className="actions"><button type="button" className="btn primary" disabled={planning.loading || Boolean(planning.error)} onClick={() => setEditor('new')}><Icon name="plus" size={15} /> New follow-up</button></div></div>
    <section className="card follow-ups-controls" aria-label="Follow-up filters"><label className="follow-ups-search">Search<input type="search" aria-label="Search follow-ups" value={query.q} placeholder="Title, job, waiting on, or contact notes…" onChange={event => change({ q: event.target.value }, true)} /></label><label>Job<select aria-label="Filter follow-ups by job" value={query.job} onChange={event => change({ job: event.target.value })}><option value="">All jobs &amp; general business</option>{query.job && !selectedJob && <option value={query.job}>Unavailable job (saved filter)</option>}{[...store.jobs].sort((a, b) => a.name.localeCompare(b.name)).map(job => <option key={job.id} value={job.id}>{job.name}</option>)}</select></label><label>Status<select aria-label="Filter follow-ups by status" value={query.status} onChange={event => change({ status: event.target.value as FollowUpQuery['status'] })}><option value="open">Open</option><option value="done">Done</option><option value="all">All</option></select></label><label>Next follow-up<select aria-label="Filter follow-ups by date" value={query.due} onChange={event => change({ due: event.target.value as FollowUpQuery['due'] })}><option value="all">Any date</option><option value="overdue">Past due</option><option value="today">Today</option><option value="week">Next 7 days</option><option value="undated">No date set</option></select></label><div className="follow-ups-filter-footer"><span role="status">{rows.length} matching follow-up{rows.length === 1 ? '' : 's'}</span>{filtered && <button type="button" className="btn sm" onClick={reset}>Reset filters</button>}<Link to="/review">Morning review →</Link></div></section>
    {planning.error && <div className="card follow-ups-error" role="alert"><p>Shared follow-ups could not be loaded: {planning.error}</p><button type="button" className="btn" onClick={() => { void planning.refresh().catch(() => {}) }}>Retry loading</button></div>}
    {planning.loading ? <p className="card" role="status">Loading shared follow-ups…</p> : rows.length ? <section className="card follow-ups-list" aria-label="Matching follow-ups">{rows.map(row => {
      const job = store.jobs.find(job => job.id === row.job_id), invoice = store.invoices.find(invoice => invoice.id === row.invoice_id), contact = latestContact(row.contact_log)
      return <article className={`follow-up-row ${row.status === 'done' ? 'is-done' : ''}`} key={row.id}>
        <div className="follow-up-row-main"><button type="button" className="follow-up-title" disabled={pending.has(row.id)} aria-label={`Edit follow-up: ${row.title}`} onClick={() => setEditor(row)}>{row.title}</button><div className="follow-up-context">{job ? <Link to={`/jobs/${job.id}`}>{job.name}</Link> : row.job_id ? 'Unavailable job' : 'General business'}{row.invoice_id && <span> · {invoice ? <Link to={`/billing?job=${invoice.job_id}&section=invoices`}>{invoice.number || 'Invoice'}</Link> : 'Unavailable invoice'}</span>}<span className={`badge ${row.status}`}>{row.status === 'done' ? 'Done' : 'Open'}</span></div>{row.waiting_on && <p><b>Waiting on:</b> {row.waiting_on}</p>}{row.reason && <p className="follow-up-reason">{row.reason}</p>}{contact ? <p className="follow-up-last-contact"><b>Last contact {fmtDate(contact.date)}:</b> {contact.note}</p> : <p className="small muted">No contact recorded yet.</p>}{errors[row.id] && <p className="follow-ups-error" role="alert">{errors[row.id]}</p>}</div>
        <div className="follow-up-dates">{row.next_follow_up_date ? <div><span>{row.status === 'done' ? 'Recorded follow-up' : 'Next follow-up'}</span><b>{fmtDate(row.next_follow_up_date, 'long')}</b>{row.status === 'open' && <DueBadge date={row.next_follow_up_date} />}</div> : <div><span>Next follow-up</span><b>No date set</b></div>}{row.promised_date && <div><span>Promised</span><b>{fmtDate(row.promised_date)}</b></div>}{row.invoice_due_date && <div><span>Invoice due{invoice?.paid_date ? ' (paid)' : ''}</span><b>{fmtDate(row.invoice_due_date)}</b></div>}</div>
        <div className="follow-up-actions"><button type="button" className="btn" disabled={pending.has(row.id) || unavailable} onClick={() => setEditor(row)} aria-label={`Edit follow-up details: ${row.title}`}>Edit</button><button type="button" className="btn" disabled={pending.has(row.id) || unavailable} onClick={() => void toggle(row)} aria-label={`${row.status === 'done' ? 'Reopen' : 'Mark done'}: ${row.title}`}>{pending.has(row.id) ? 'Saving…' : row.status === 'done' ? 'Reopen' : 'Done'}</button></div>
      </article>
    })}</section> : !planning.error && <section className="card follow-ups-empty"><h2>{planning.followUps.length ? 'No follow-ups match these filters' : 'No follow-ups yet'}</h2><p>{planning.followUps.length ? 'Try another job, date, status, or search.' : 'Record the next check-in when a job, client, or payment needs attention.'}</p>{filtered ? <button type="button" className="btn" onClick={reset}>Reset filters</button> : <button type="button" className="btn primary" onClick={() => setEditor('new')}>Add your first follow-up</button>}</section>}
    {editor && <FollowUpEditor followUp={editor === 'new' ? undefined : editor} defaults={editor === 'new' ? { job_id: selectedJob?.id } : undefined} onClose={() => setEditor(null)} />}
  </div>
}
