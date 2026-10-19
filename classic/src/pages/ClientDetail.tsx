import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { clientRows } from '../lib/clients'
import { jobTaskDate } from '../lib/jobDetail'
import { filterJobRows, type JobsFocus, type JobsStatus } from '../lib/jobs'
import type { Client, Task } from '../lib/types'
import { JOB_STATUS_LABEL, TASK_STATUS_LABEL } from '../lib/types'
import { daysUntil, fmtDate, fmtHours, fmtHourlyRate, fmtMoney, fmtSigned } from '../lib/utils'
import { JobsTable } from '../views/JobsTable'
import { ClientModal, JobModal, TaskModal, TimeModal } from '../components/editors'
import { DueBadge, Empty, Icon } from '../components/ui'

type Section = 'jobs' | 'billing' | 'details'
const statuses: JobsStatus[] = ['all', 'open', 'active', 'on_hold', 'complete', 'cancelled', 'archived']
const focuses: JobsFocus[] = ['all', 'due', 'waiting', 'billing']
const basis = 'All job history, including archived jobs. Recorded deposits and invoices counted once, less funded separate charges, divided by all completed hours including nonbillable time. Includes unused deposits; before overhead and tax.'

function ClientContact({ client }: { client: Client }) {
  return <div className="client-contact-links">{client.contact_name && <span>{client.contact_name}</span>}{client.phone.trim() && <a href={`tel:${client.phone.trim()}`}>{client.phone}</a>}{client.email.trim() && <a href={`mailto:${client.email.trim()}`}>{client.email}</a>}</div>
}

export function ClientDetail() {
  const { id = '' } = useParams()
  return <ClientWorkspace key={id} id={id} />
}

function ClientWorkspace({ id }: { id: string }) {
  const store = useData()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [now, setNow] = useState(() => new Date())
  const row = useMemo(() => clientRows(store, now).find(row => row.client.id === id), [store, id, now])
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [newJob, setNewJob] = useState(false)
  const [taskModal, setTaskModal] = useState<{ jobId: string; phaseId: string | null } | null>(null)
  const [timeModal, setTimeModal] = useState<{ jobId: string; phaseId: string | null } | null>(null)
  const section: Section = params.get('tab') === 'billing' ? 'billing' : params.get('tab') === 'details' ? 'details' : 'jobs'
  const status = statuses.includes(params.get('status') as JobsStatus) ? params.get('status') as JobsStatus : 'all'
  const focus = focuses.includes(params.get('focus') as JobsFocus) ? params.get('focus') as JobsFocus : 'all'
  const search = params.get('q') ?? ''
  const invoiceFilter = params.get('invoices') === 'all' ? 'all' : params.get('invoices') === 'paid' ? 'paid' : 'unpaid'

  useEffect(() => {
    const refreshClock = () => setNow(new Date())
    const timer = window.setInterval(refreshClock, 60_000)
    window.addEventListener('focus', refreshClock)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshClock) }
  }, [])

  function patchQuery(patch: Record<string, string>, replace = false) {
    setParams(current => {
      const next = new URLSearchParams(current)
      for (const [key, value] of Object.entries(patch)) {
        if (!value.trim() || key === 'tab' && value === 'jobs' || key === 'status' && value === 'all' || key === 'focus' && value === 'all' || key === 'invoices' && value === 'unpaid') next.delete(key)
        else next.set(key, value)
      }
      return next
    }, { replace })
  }
  function linkTo(nextSection: Section, query: Record<string, string> = {}) {
    const next = new URLSearchParams(query)
    if (nextSection !== 'jobs') next.set('tab', nextSection)
    return `/clients/${id}${next.size ? `?${next}` : ''}`
  }
  const clientEditor = editingClient && <ClientModal client={editingClient} onClose={() => setEditingClient(null)} onDeleted={() => nav('/clients', { replace: true })} />
  // Keep the editing snapshot mounted during an optimistic delete. Only the
  // modal's confirmed success callback navigates away from the client.
  if (!row) return <><div className="card"><Empty>{store.loading ? 'Loading client…' : <>Client not found. <Link to="/clients">Back to clients</Link></>}</Empty></div>{clientEditor}</>
  const { client, billing } = row
  const visibleJobs = filterJobRows(row.jobs, { status, client: id, q: search, focus }, now)
  const readyJobs = row.jobs.filter(job => job.billing.unbilledAmount > 0.005)
  const invoices = invoiceFilter === 'unpaid' ? row.unpaidInvoices : invoiceFilter === 'paid' ? row.invoices.filter(invoice => Boolean(invoice.paid_date)) : row.invoices
  const tasks = row.openJobs.filter(job => job.nextTask).map(job => ({ job: job.job, task: job.nextTask! })).sort((a, b) => (jobTaskDate(a.task) ?? '9999').localeCompare(jobTaskDate(b.task) ?? '9999') || a.job.priority - b.job.priority)
  const timeline = `/jobs?${new URLSearchParams({ view: 'gantt', status: 'all', client: id })}`
  const defaultPhase = (jobId: string) => row.jobs.find(job => job.job.id === jobId)?.workPhase?.id ?? null
  const activeFilters = status !== 'all' || focus !== 'all' || search.trim() !== ''

  return <><div className="client-detail">
    <div className="page-header client-detail-header"><div className="client-detail-title"><div className="small muted"><Link to="/clients">Clients</Link></div><h1>{client.name}</h1><ClientContact client={client} /></div><div className="actions client-detail-actions"><button className="btn primary" onClick={() => setNewJob(true)}><Icon name="plus" size={15} /> New job</button><button className="btn" onClick={() => setEditingClient(client)}><Icon name="edit" size={14} /> Edit client</button></div></div>

    <div className="stats client-detail-stats">
      <Link className="stat client-linked-stat" to={linkTo('jobs', { status: 'open' })}><div className="label">Open jobs <span aria-hidden="true">→</span></div><div className="value">{row.openJobs.length}<span className="client-stat-denominator"> / {row.jobs.length}</span></div><div className="sub">{row.activeCount} active · {row.onHoldCount} on hold</div></Link>
      <Link className="stat client-linked-stat" to={linkTo('billing')}><div className="label">Ready to bill <span aria-hidden="true">→</span></div><div className="value">{fmtMoney(billing.unbilledAmount)}</div><div className="sub">{readyJobs.length} job{readyJobs.length === 1 ? '' : 's'} · all job history</div></Link>
      <Link className="stat client-linked-stat" to={linkTo('billing')}><div className="label">Awaiting payment <span aria-hidden="true">→</span></div><div className="value">{fmtMoney(billing.outstanding)}</div><div className="sub">{row.unpaidInvoices.length} unpaid invoice{row.unpaidInvoices.length === 1 ? '' : 's'}</div></Link>
      <Link className="stat client-linked-stat" to={linkTo('billing')} title={basis}><div className="label">Effective hourly rate <span aria-hidden="true">→</span></div><div className="value">{fmtHourlyRate(row.effectiveHourlyRate)}</div><div className="sub">{fmtMoney(row.feeRevenue)} fees / {fmtHours(row.completedHours)} completed</div></Link>
    </div>
    <p className="tiny muted client-history-basis">Financial totals cover all job history, including archived jobs. Completed hours include nonbillable time.</p>

    <nav className="client-section-tabs" aria-label="Client sections">{([['jobs', 'Jobs'], ['billing', 'Billing'], ['details', 'Details']] as const).map(([value, label]) => <button key={value} aria-label={label} aria-pressed={section === value} className={section === value ? 'active' : ''} onClick={() => patchQuery({ tab: value })}>{label}</button>)}</nav>
    <div className={`client-detail-grid ${section === 'jobs' ? 'client-jobs-layout' : ''}`}><div className="client-detail-main">
      {section === 'jobs' && <section className="card client-jobs-section" aria-labelledby="client-jobs-title"><div className="client-section-heading"><h2 id="client-jobs-title">Jobs</h2><Link to={`/jobs?${new URLSearchParams({ status: 'all', client: id })}`}>Open jobs workspace →</Link></div>
        <div className="client-job-filters"><input type="search" aria-label="Search client jobs" placeholder="Search jobs, numbers or addresses…" value={search} onChange={event => patchQuery({ q: event.target.value }, true)} /><select aria-label="Job status" value={status} onChange={event => patchQuery({ status: event.target.value })}><option value="all">All job history</option><option value="open">Open jobs</option>{Object.entries(JOB_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select aria-label="Job focus" value={focus} onChange={event => patchQuery({ focus: event.target.value })}><option value="all">All work</option><option value="due">Due soon</option><option value="waiting">Waiting</option><option value="billing">Billing follow-up</option></select></div>
        <div className="client-job-summary small muted"><span>{visibleJobs.length} of {row.jobs.length} jobs</span>{activeFilters && <button className="btn sm ghost" onClick={() => patchQuery({ status: 'all', q: '', focus: 'all' })}>Clear job filters</button>}</div>
        {visibleJobs.length ? <JobsTable jobs={visibleJobs.map(row => row.job)} showExport={false} allowReorder={false} onLogHours={jobId => setTimeModal({ jobId, phaseId: defaultPhase(jobId) })} onAddTask={jobId => setTaskModal({ jobId, phaseId: defaultPhase(jobId) })} /> : <p className="client-empty-message">{row.jobs.length ? 'No jobs match these filters. Clear the filters to see all job history.' : 'No jobs yet. Create the first job for this client.'}</p>}
      </section>}

      {section === 'billing' && <>
        <section className="card client-billing-jobs" aria-labelledby="client-ready-title"><h2 id="client-ready-title">Ready to bill</h2><p className="small muted">Hours and charges ready for an invoice across all of this client's jobs.</p>{readyJobs.length ? <ul className="client-context-list">{readyJobs.map(row => <li className="client-billing-job" key={row.job.id}><div><Link to={`/billing?job=${row.job.id}`} className="bold">{row.job.name}</Link><div className="tiny muted">{row.job.job_number && `${row.job.job_number} · `}{JOB_STATUS_LABEL[row.job.status]}</div></div><Link to={`/billing?job=${row.job.id}`} className="nowrap">{fmtMoney(row.billing.unbilledAmount)} ready →</Link></li>)}</ul> : <p className="client-empty-message">No hours or charges are ready to bill.</p>}</section>
        <section className="card" aria-labelledby="client-invoices-title"><div className="client-section-heading"><h2 id="client-invoices-title">Invoices</h2><label className="client-invoice-filter">Invoice status<select aria-label="Invoice status" value={invoiceFilter} onChange={event => patchQuery({ invoices: event.target.value })}><option value="unpaid">Unpaid</option><option value="all">All invoices</option><option value="paid">Paid</option></select></label></div>
          {invoices.length ? <div className="table-wrap"><table className="client-invoice-table"><thead><tr><th>Invoice / job</th><th>Issued</th><th>Status</th><th className="num">Amount</th></tr></thead><tbody>{invoices.map(invoice => { const job = row.jobs.find(row => row.job.id === invoice.job_id)?.job; const age = -(daysUntil(invoice.issued_date) ?? 0); return <tr key={invoice.id}><td><Link className="bold" to={`/billing?job=${invoice.job_id}`}>{invoice.number || 'Invoice'}</Link><div className="small"><Link to={`/jobs/${invoice.job_id}`}>{job?.name ?? 'Job history'}</Link></div></td><td><span>{fmtDate(invoice.issued_date, 'long')}</span><div className="tiny muted">{age === 0 ? 'Issued today' : age > 0 ? `Issued ${age}d ago` : `Dated ${fmtDate(invoice.issued_date)}`}</div></td><td className="client-invoice-status">{invoice.paid_date ? <span className="badge complete">Paid {fmtDate(invoice.paid_date)}</span> : invoice.amount > 0.005 ? <span className="badge soon">Awaiting payment</span> : <span className="badge">No payment due</span>}</td><td className="num nowrap">{fmtMoney(invoice.amount)}</td></tr> })}</tbody></table></div> : <p className="client-empty-message">{row.invoices.length ? invoiceFilter === 'unpaid' ? 'No unpaid invoices awaiting payment.' : 'No invoices match this status.' : 'No invoices yet.'}</p>}
          {row.invoices.length > 0 && <p className="tiny muted client-invoice-count">{invoices.length} of {row.invoices.length} invoices · newest issued first</p>}
        </section>
        <section className="card client-fee-basis" aria-labelledby="client-fees-title"><h2 id="client-fees-title">Recorded fees &amp; time</h2><dl className="client-detail-facts"><div><dt>Fees recorded</dt><dd>{fmtMoney(row.feeRevenue)}</dd></div><div><dt>Completed hours</dt><dd>{fmtHours(row.completedHours)}</dd></div><div><dt>Billable hours</dt><dd>{fmtHours(row.billableHours)}</dd></div><div><dt>Nonbillable hours</dt><dd>{fmtHours(row.nonBillableHours)}</dd></div><div><dt>Nonbillable value</dt><dd>{fmtMoney(billing.nonBillableValue)}</dd></div><div><dt>Effective hourly rate</dt><dd>{fmtHourlyRate(row.effectiveHourlyRate)}</dd></div><div><dt>Job balance total</dt><dd>{fmtSigned(billing.balance)}</dd></div><div><dt>Unused deposits</dt><dd>{fmtMoney(billing.depositRemaining)}</dd></div></dl><p className="small muted">{basis}</p></section>
      </>}

      {section === 'details' && <section className="card client-details-card" aria-labelledby="client-details-title"><div className="client-section-heading"><h2 id="client-details-title">Client details</h2><button className="btn" onClick={() => setEditingClient(client)}><Icon name="edit" size={14} /> Edit client details</button></div><dl className="client-detail-facts"><div><dt>Client / company</dt><dd>{client.name}</dd></div><div><dt>Contact person</dt><dd>{client.contact_name || 'Not set'}</dd></div><div><dt>Email</dt><dd>{client.email.trim() ? <a href={`mailto:${client.email.trim()}`}>{client.email}</a> : 'Not set'}</dd></div><div><dt>Phone</dt><dd>{client.phone.trim() ? <a href={`tel:${client.phone.trim()}`}>{client.phone}</a> : 'Not set'}</dd></div><div><dt>Address</dt><dd>{client.address || 'Not set'}</dd></div></dl><h3>Client notes</h3><p className="client-notes">{client.notes || 'No client notes yet. Add contact preferences or background details with Edit client.'}</p></section>}
    </div>

    <aside className="client-detail-aside" aria-label="Client context">
      {section !== 'details' && <section className="card client-contact-card"><div className="client-section-heading"><h2>Contact</h2><Link to={linkTo('details')}>Details →</Link></div><ClientContact client={client} />{client.address && <p className="small client-address">{client.address}</p>}{row.contactMissing && <p className="small muted">No phone or email saved. Add contact details with Edit client.</p>}{client.notes && <p className="client-notes small">{client.notes}</p>}</section>}
      {section === 'jobs' && <section className="card"><h2>Next dates</h2>{row.deadlines.length ? <ul className="client-context-list">{row.deadlines.slice(0, 4).map(date => <li key={date.id}><div><Link to={date.link}>{date.title}</Link><div className="tiny muted">{date.jobName} · {fmtDate(date.date)}</div></div><DueBadge date={date.date} /></li>)}</ul> : <p className="small muted">No pending dates on open jobs.</p>}</section>}
      {section === 'jobs' && tasks.length > 0 && <section className="card"><h2>Next tasks</h2><ul className="client-context-list">{tasks.slice(0, 3).map(({ job, task }: { job: typeof row.jobs[number]['job']; task: Task }) => <li key={task.id}><div><Link to={`/jobs/${job.id}?task=${task.id}`}>{task.title}</Link><div className="tiny muted">{job.name}</div></div><span className={`badge ${task.status}`}>{TASK_STATUS_LABEL[task.status]}</span></li>)}</ul></section>}
      <section className="card"><h2>All job history</h2><dl className="client-detail-facts"><div><dt>Active</dt><dd>{row.activeCount}</dd></div><div><dt>On hold</dt><dd>{row.onHoldCount}</dd></div><div><dt>Complete</dt><dd>{row.completeCount}</dd></div><div><dt>Cancelled</dt><dd>{row.cancelledCount}</dd></div><div><dt>Archived</dt><dd>{row.archivedCount}</dd></div></dl><Link className="client-aside-link" to={timeline}>Open client timeline →</Link></section>
    </aside></div>

    {newJob && <JobModal defaultClientId={client.id} onClose={() => setNewJob(false)} onCreated={job => nav(`/jobs/${job.id}`)} />}
    {taskModal && <TaskModal defaults={{ job_id: taskModal.jobId, phase_id: taskModal.phaseId }} onClose={() => setTaskModal(null)} />}
    {timeModal && <TimeModal defaults={{ job_id: timeModal.jobId, phase_id: timeModal.phaseId }} onClose={() => setTimeModal(null)} />}
  </div>{clientEditor}</>
}
