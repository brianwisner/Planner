import { useState } from 'react'
import { Link } from 'react-router-dom'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { usePlanning } from '../lib/planningStore'
import type { FollowUp } from '../lib/planningTypes'
import type { Invoice } from '../lib/types'
import type { BillingJobRow } from '../lib/billingView'
import { fmtDate, fmtMoney, todayISO } from '../lib/utils'
import { FollowUpEditor } from './FollowUpEditor'
import './BillingFollowUps.css'

/** Invoice dates are separate from collection notes; opening this panel never writes. */
export function BillingFollowUps({ jobs, invoices, showReady = true }: { jobs: BillingJobRow[]; invoices: Invoice[]; showReady?: boolean }) {
  const planning = usePlanning()
  const [editing, setEditing] = useState<{ invoice: Invoice; followUp?: FollowUp } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const ids = new Set(jobs.map(row => row.job.id)), today = todayISO()
  const rows = invoices.filter(invoice => ids.has(invoice.job_id) && !invoice.paid_date && invoice.amount > 0.005)
    .map(invoice => ({ invoice, tracker: planning.followUps.find(row => row.invoice_id === invoice.id) }))
    .sort((a, b) => (a.tracker?.next_follow_up_date ?? '9999').localeCompare(b.tracker?.next_follow_up_date ?? '9999') ||
      (a.tracker?.invoice_due_date ?? '9999').localeCompare(b.tracker?.invoice_due_date ?? '9999') || a.invoice.issued_date.localeCompare(b.invoice.issued_date) || a.invoice.id.localeCompare(b.invoice.id))
  const ready = showReady ? jobs.filter(row => row.billing.unbilledAmount > 0.005) : []
  const visible = expanded ? rows : rows.slice(0, 5)
  return <section className="card billing-follow-ups" aria-labelledby="billing-follow-ups-title">
    <div className="billing-follow-ups-heading"><h2 id="billing-follow-ups-title">Next billing actions</h2><Link to="/follow-ups">All follow-ups →</Link></div>
    {planning.error && <p role="alert">Follow-up records are unavailable. {planning.error}</p>}
    {planning.loading && <p className="small muted" role="status">Loading follow-up records…</p>}
    {ready.length > 0 && <details className="billing-ready-actions"><summary>{ready.length} {ready.length === 1 ? 'job has' : 'jobs have'} work ready to bill</summary><div>{ready.map(({ job, billing }) => <Link key={job.id} to={`/billing?job=${job.id}`}><span>{job.name}</span><b>{fmtMoney(billing.unbilledAmount)} →</b></Link>)}</div></details>}
    <p className="tiny muted">Collection actions follow the matched jobs and invoice list. Invoice age is time since issue; an invoice is overdue only when you enter its due date. Follow-up notes do not change invoices or balances.</p>
    {visible.length ? <div className="billing-collection-list">{visible.map(({ invoice, tracker }) => {
      const job = jobs.find(row => row.job.id === invoice.job_id)!
      const age = differenceInCalendarDays(parseISO(today), parseISO(invoice.issued_date))
      const lastContact = tracker?.contact_log.map(entry => entry.date).sort().at(-1)
      const due = tracker?.invoice_due_date
      return <article key={invoice.id} className="billing-collection-row">
        <div><b>{invoice.number || 'Invoice'} · {fmtMoney(invoice.amount)}</b><div className="small"><Link to={`/billing?job=${invoice.job_id}&section=invoices`}>{job.job.name}</Link></div><div className="tiny muted">Issued {fmtDate(invoice.issued_date)} · {age < 0 ? 'Future issue date' : `${age} ${age === 1 ? 'day' : 'days'} since issue`}</div>
          <div className="billing-collection-dates small">{due ? <span className={due < today ? 'billing-follow-overdue' : ''}>{due < today ? `Overdue · due ${fmtDate(due)}` : due === today ? 'Payment due today' : `Payment due ${fmtDate(due)}`}</span> : <span className="muted">Payment due date not recorded</span>}{tracker?.next_follow_up_date && <span>{tracker.status === 'done' ? 'Recorded follow-up' : 'Follow up'} {fmtDate(tracker.next_follow_up_date)}{tracker.status === 'open' && (tracker.next_follow_up_date < today ? ' · follow-up overdue' : tracker.next_follow_up_date === today ? ' · today' : '')}</span>}{lastContact && <span>Last contact {fmtDate(lastContact)}</span>}{tracker?.promised_date && <span>Promised {fmtDate(tracker.promised_date)}</span>}{tracker?.status === 'done' && <span className="muted">Tracker marked done · invoice still unpaid</span>}</div>
        </div>
        <button className="btn" disabled={planning.loading || Boolean(planning.error)} aria-label={`${tracker ? 'Edit' : 'Set'} follow-up for invoice ${invoice.number || invoice.id}`} onClick={() => setEditing({ invoice, followUp: tracker })}>{tracker ? 'Edit follow-up' : 'Set follow-up'}</button>
      </article>
    })}</div> : <p className="small muted">No positive unpaid invoices in this selection.</p>}
    {rows.length > 5 && <button className="btn" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer invoices' : `Show all ${rows.length} unpaid invoices`}</button>}
    {editing && <FollowUpEditor followUp={editing.followUp} defaults={{ job_id: editing.invoice.job_id, invoice_id: editing.invoice.id, title: `Payment for ${editing.invoice.number || 'invoice'}` }} onClose={() => setEditing(null)} />}
  </section>
}
