import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { clientRows, filterClientRows, parseClientsQuery, writeClientsQuery, type ClientsFocus, type ClientsQuery, type ClientsSort } from '../lib/clients'
import type { Client } from '../lib/types'
import { downloadCSV, fmtDate, fmtHours, fmtHourlyRate, fmtMoney, fmtSigned, sum } from '../lib/utils'
import { ClientModal, JobModal } from '../components/editors'
import { DueBadge, Icon } from '../components/ui'

// Spreadsheet software should read client/contact text as text, not a formula.
const csvText = (value: string) => /^\s*[=+\-@]/.test(value) ? `'${value}` : value
const round2 = (value: number) => Math.round(value * 100) / 100

export function Clients() {
  const store = useData()
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = parseClientsQuery(params)
  const [now, setNow] = useState(() => new Date())
  const allRows = useMemo(() => clientRows(store, now), [store, now])
  const baseRows = filterClientRows(allRows, { ...query, focus: 'all' }, now)
  const rows = filterClientRows(allRows, query, now)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Client | null>(null)
  const [newJobFor, setNewJobFor] = useState<Client | null>(null)
  const activeFilters = query.q.trim() !== '' || query.focus !== 'all'
  const readyAmount = sum(baseRows.map(row => row.billing.unbilledAmount))
  const waitingAmount = sum(baseRows.map(row => row.billing.outstanding))
  const withOpen = baseRows.filter(row => row.openJobs.length > 0).length
  const readyCount = baseRows.filter(row => row.billing.unbilledAmount > 0.005).length
  const waitingCount = baseRows.filter(row => row.billing.outstanding > 0.005).length

  useEffect(() => {
    const tick = () => setNow(new Date())
    const interval = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', tick) }
  }, [])

  function patch(patch: Partial<ClientsQuery>, replace = false) {
    setParams(current => writeClientsQuery(current, patch), { replace })
  }
  function chooseSort(sort: ClientsSort) {
    patch({ sort, dir: sort === 'name' || sort === 'due' ? 'asc' : 'desc' })
  }
  function headerSort(sort: ClientsSort, text: string) {
    return <button type="button" className="clients-sort-button" onClick={() => query.sort === sort ? patch({ dir: query.dir === 'asc' ? 'desc' : 'asc' }) : chooseSort(sort)} aria-label={`Sort by ${text.toLowerCase()}`}>{text}{query.sort === sort && <span aria-hidden="true">{query.dir === 'asc' ? ' ↑' : ' ↓'}</span>}</button>
  }
  const ariaSort = (sort: ClientsSort) => query.sort !== sort ? 'none' as const : query.dir === 'asc' ? 'ascending' as const : 'descending' as const
  function exportClients() {
    downloadCSV('clients.csv', ['Client', 'Contact', 'Email', 'Phone', 'Address', 'Jobs', 'Active jobs', 'On-hold jobs', 'Worked hours (including running)', 'Completed hours', 'Nonbillable hours', 'Recorded fees $', 'Effective hourly rate $', 'Ready to bill $', 'Awaiting payment $', 'Unused deposits $', 'Balance $'],
      rows.map(row => [csvText(row.client.name), csvText(row.client.contact_name), csvText(row.client.email), csvText(row.client.phone), csvText(row.client.address), row.jobs.length, row.activeCount, row.onHoldCount, round2(row.actualHours), round2(row.completedHours), round2(row.nonBillableHours), round2(row.feeRevenue), row.effectiveHourlyRate == null ? null : round2(row.effectiveHourlyRate), round2(row.billing.unbilledAmount), round2(row.billing.outstanding), round2(row.billing.depositRemaining), round2(row.billing.balance)]))
  }
  function stat(focus: ClientsFocus, label: string, value: string | number, sub: string, icon: string) {
    return <button type="button" className={`stat client-stat ${query.focus === focus ? 'is-selected' : ''}`} aria-pressed={query.focus === focus} onClick={() => patch({ focus })}><div className="label"><Icon name={icon} size={14} />{label}</div><div className="value">{value}</div><div className="sub">{sub}</div></button>
  }

  return <div className="clients-page">
    <div className="page-header clients-header"><div><h1>Clients</h1><p className="clients-subtitle">Find a contact, see their work, and follow up on billing.</p></div><div className="actions"><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> New client</button></div></div>
    <div className="stats clients-stats" aria-label="Quick client filters">
      {stat('all', 'Clients in view', baseRows.length, query.q.trim() ? 'Matching the current search' : 'All saved clients', 'clients')}
      {stat('open', 'With open jobs', withOpen, 'Active or on-hold work', 'jobs')}
      {stat('unbilled', 'Ready to bill', fmtMoney(readyAmount), `${readyCount} ${readyCount === 1 ? 'client' : 'clients'} with unbilled work`, 'billing')}
      {stat('outstanding', 'Awaiting payment', fmtMoney(waitingAmount), `${waitingCount} ${waitingCount === 1 ? 'client' : 'clients'} with unpaid invoices`, 'billing')}
    </div>
    <section className="card clients-controls" aria-label="Client filters">
      <div className="clients-filter-grid"><div className="clients-search-field"><label htmlFor="clients-search">Search</label><div className="clients-search"><Icon name="search" size={16} /><input id="clients-search" type="search" aria-label="Search clients" placeholder="Client, contact, email, phone, or job…" value={query.q} onChange={event => patch({ q: event.target.value }, true)} /></div></div>
        <div><label htmlFor="clients-focus">Show</label><select id="clients-focus" aria-label="Show clients" value={query.focus} onChange={event => patch({ focus: event.target.value as ClientsFocus })}><option value="all">All clients</option><option value="open">With open jobs</option><option value="billing">Billing follow-up</option><option value="unbilled">Ready to bill</option><option value="outstanding">Awaiting payment</option><option value="due">Due soon &amp; overdue</option><option value="no_open">No open jobs</option><option value="missing_contact">Missing phone &amp; email</option></select></div>
        <div><label htmlFor="clients-sort">Sort</label><select id="clients-sort" aria-label="Sort clients" value={query.sort} onChange={event => chooseSort(event.target.value as ClientsSort)}><option value="name">Client name</option><option value="open">Open jobs</option><option value="unbilled">Ready to bill</option><option value="outstanding">Awaiting payment</option><option value="due">Next due</option></select></div>
        <div className="clients-direction"><label>Order</label><button type="button" className="btn" aria-label="Sort direction" onClick={() => patch({ dir: query.dir === 'asc' ? 'desc' : 'asc' })}>{query.dir === 'asc' ? 'Ascending ↑' : 'Descending ↓'}</button></div>
      </div>
      <div className="clients-controls-footer"><span role="status">{rows.length} {rows.length === 1 ? 'client' : 'clients'}{activeFilters ? ` of ${allRows.length}` : ''}</span>{activeFilters && <button className="btn ghost" onClick={() => patch({ q: '', focus: 'all' })}>Reset filters</button>}<span className="grow" /><button className="btn" onClick={exportClients} disabled={rows.length === 0}><Icon name="download" size={14} /> Export CSV</button></div>
    </section>
    <p className="clients-basis tiny muted">Client totals include all job history, including archived jobs. Hourly return uses recorded fees divided by all completed hours, including nonbillable time.</p>
    <div className="card clients-list-card">
      {rows.length === 0 ? <div className="clients-empty"><Icon name="clients" size={28} /><h2>{allRows.length ? 'No clients match these filters' : 'Keep your clients and their work together'}</h2><p>{allRows.length ? 'Try another name, contact detail, or job, or clear the filters.' : 'Add a client to organize their jobs, contact details, and billing.'}</p><button className="btn primary" onClick={() => allRows.length ? patch({ q: '', focus: 'all' }) : setAdding(true)}>{allRows.length ? 'Reset filters' : 'Add your first client'}</button></div> : <div className="table-wrap"><table className="clients-overview-table"><thead><tr><th aria-sort={ariaSort('name')}>{headerSort('name', 'Client')}</th><th aria-sort={ariaSort('open')}>{headerSort('open', 'Open jobs')}</th><th>Hours &amp; return</th><th aria-sort={ariaSort('due')}>{headerSort('due', 'Next due')}</th><th aria-sort={query.sort === 'unbilled' ? ariaSort('unbilled') : ariaSort('outstanding')}><div>{headerSort('unbilled', 'Ready to bill')}</div><div>{headerSort('outstanding', 'Awaiting payment')}</div></th></tr></thead><tbody>
        {rows.map(row => { const { client } = row; const highlightedJob = row.openJobs[0] ?? row.jobs[0]; return <tr key={client.id}>
          <td className="clients-identity"><Link className="clients-name" to={`/clients/${client.id}`}>{client.name}</Link>{client.contact_name && <div className="small">{client.contact_name}</div>}<div className="clients-contact">{client.phone.trim() && <a href={`tel:${client.phone.trim()}`}>{client.phone}</a>}{client.email.trim() && <a href={`mailto:${client.email.trim()}`}>{client.email}</a>}</div>{client.address && <div className="tiny muted clients-address">{client.address}</div>}{row.contactMissing && <span className="clients-contact-missing">No phone or email saved</span>}<div className="clients-row-actions"><button className="btn sm" aria-label={`New job for ${client.name}`} onClick={() => setNewJobFor(client)}><Icon name="plus" size={13} /> Job</button><button className="btn sm ghost" aria-label={`Edit client: ${client.name}`} onClick={() => setEditing(client)}><Icon name="edit" size={13} /> Edit</button></div></td>
          <td className="clients-work"><span className="clients-cell-label">Work</span><Link className="bold" to={`/clients/${client.id}?status=open`}>{row.openJobs.length} open</Link><div className="tiny muted">{row.activeCount} active · {row.onHoldCount} on hold</div><Link className="tiny" to={`/clients/${client.id}`}>{row.jobs.length} total {row.jobs.length === 1 ? 'job' : 'jobs'} →</Link>{highlightedJob && <div className="clients-job-preview"><Link to={`/jobs/${highlightedJob.job.id}`}>{highlightedJob.job.name}</Link></div>}</td>
          <td className="clients-time"><span className="clients-cell-label">Hours &amp; return</span><div className="bold">{fmtHours(row.actualHours)} worked</div><div className="tiny muted">{fmtHours(row.nonBillableHours)} nonbillable{row.runningCount ? ` · ${row.runningCount} running` : ''}</div><Link to={`/clients/${client.id}?tab=billing`}>{fmtHourlyRate(row.effectiveHourlyRate)}<span className="tiny muted"> · fees / completed hours</span></Link></td>
          <td className="clients-deadline"><span className="clients-cell-label">Next due</span>{row.nextDeadline ? <Link to={row.nextDeadline.link}><DueBadge date={row.nextDeadline.date} /><span>{row.nextDeadline.jobName}</span><span className="tiny muted">{fmtDate(row.nextDeadline.date, 'long')}</span></Link> : <span className="tiny muted">No pending date</span>}</td>
          <td className="clients-billing"><span className="clients-cell-label">Billing</span><Link className={row.billing.unbilledAmount > 0.005 ? 'bold' : 'muted'} to={`/clients/${client.id}?tab=billing`}>{fmtMoney(row.billing.unbilledAmount)} ready to bill →</Link><Link className={row.billing.outstanding > 0.005 ? 'warn-text' : 'muted'} to={`/clients/${client.id}?tab=billing`}>{fmtMoney(row.billing.outstanding)} awaiting payment</Link><div className="tiny muted">Balance <span className={row.billing.balance < 0 ? 'money-neg' : 'money-pos'}>{fmtSigned(row.billing.balance)}</span></div></td>
        </tr> })}
      </tbody></table></div>}
    </div>
    {adding && <ClientModal onClose={() => setAdding(false)} onCreated={client => nav(`/clients/${client.id}`)} />}
    {editing && <ClientModal client={editing} onClose={() => setEditing(null)} />}
    {newJobFor && <JobModal defaultClientId={newJobFor.id} onClose={() => setNewJobFor(null)} onCreated={job => nav(`/jobs/${job.id}`)} />}
  </div>
}
