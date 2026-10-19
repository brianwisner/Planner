import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData, type TableName } from '../lib/store'
import { allHours, balanceHistory, depositUsage, entryRate, HOUR_STATUS_LABEL, jobBilling, jobCharges, type HourStatus, type JobBilling } from '../lib/calc'
import { billingJobRows, canInvoice, filterBillingJobs, invoiceSelection, matchesBillingText, matchesWork, parseBillingQuery, WORK_FILTERS, workAmount, workRows, writeBillingQuery, type BillingJobRow, type BillingQuery, type BillingWork } from '../lib/billingView'
import type { Deposit, Invoice, JobItem, TimeEntry } from '../lib/types'
import { JOB_STATUS_LABEL } from '../lib/types'
import { downloadCSV, fmtDate, fmtHourlyRate, fmtHours, fmtMoney, fmtSigned, sum, todayISO } from '../lib/utils'
import { DepositModal, InvoiceModal, ItemModal, TimeModal } from '../components/editors'
import { BalanceChart, FeesSummary, WorkStatusBar } from '../components/MoneyCharts'
import { Empty, Icon } from '../components/ui'
import './Billing.css'

const round2 = (value: number) => Math.round(value * 100) / 100
const csvText = (value: string) => /^\s*[=+\-@]/.test(value) ? `'${value}` : value
const moneyBasis = 'Balance = deposits + invoices − all completed work and charges. Nonbillable time counts once in work value; it cannot consume deposits or be invoiced.'
function useBillingQuery() {
  const [params, setParams] = useSearchParams()
  return { query: parseBillingQuery(params), params,
    patch: (values: Partial<BillingQuery>, replace = false) => setParams(current => writeBillingQuery(current, values), { replace }) }
}
function phaseName(phases: { id: string; name: string }[], id: string | null) { return phases.find(phase => phase.id === id)?.name ?? 'General' }

export function Billing() {
  const { query } = useBillingQuery()
  return query.job ? <JobMoney key={query.job} jobId={query.job} /> : <BillingOverview />
}

function BillingOverview() {
  const store = useData()
  const { query, patch } = useBillingQuery()
  const allRows = useMemo(() => billingJobRows(store), [store])
  const rows = filterBillingJobs(allRows, query)
  const ids = new Set(rows.map(row => row.job.id))
  const [newDeposit, setNewDeposit] = useState(false)
  const [editingTime, setEditingTime] = useState<TimeEntry | null>(null)
  const [editingDeposit, setEditingDeposit] = useState<Deposit | null>(null)
  const jobOptions = filterBillingJobs(allRows, { ...query, q: '', scope: '', focus: 'all' })
  const invoices = filterInvoices(store.invoices.filter(invoice => ids.has(invoice.job_id)), query.payment, query.detail)
  const deposits = store.deposits.filter(deposit => ids.has(deposit.job_id) && matchesBillingText([deposit.method, deposit.notes, deposit.received_date].join(' '), query.detail))
    .sort((a, b) => b.received_date.localeCompare(a.received_date) || a.id.localeCompare(b.id))
  const hours = [...allHours(store).values()].filter(row => ids.has(row.entry.job_id) && matchesWork(row, query.work) &&
    matchesBillingText([row.entry.notes, phaseName(store.phases, row.entry.phase_id), row.entry.date].join(' '), query.detail))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || a.entry.id.localeCompare(b.entry.id))
  const usage = new Map<string, number>()
  for (const jobId of ids) for (const [id, amount] of depositUsage(store, jobId)) usage.set(id, amount)

  function exportRows() {
    if (query.tab === 'jobs') downloadCSV('billing-jobs.csv', ['Job #', 'Job', 'Client', 'Status', 'Completed hours', 'Nonbillable hours', 'Work value $', 'Deposits $', 'Unused deposits $', 'Invoiced $', 'Awaiting payment $', 'Ready to bill $', 'Balance $', 'Recorded fees $', 'Effective hourly rate $'], rows.map(({ job, clientName, billing: b }) => [csvText(job.job_number), csvText(job.name), csvText(clientName), JOB_STATUS_LABEL[job.status], round2(b.loggedHours), round2(b.nonBillableHours), round2(b.workValue), round2(b.deposits), round2(b.depositRemaining), round2(b.invoiced), round2(b.outstanding), round2(b.unbilledAmount), round2(b.balance), round2(b.feeRevenue), b.effectiveHourlyRate == null ? null : round2(b.effectiveHourlyRate)]))
    else if (query.tab === 'invoices') downloadCSV('billing-invoices.csv', ['Invoice', 'Job', 'Client', 'Issued', 'Paid', 'Amount $', 'Notes'], invoices.map(invoice => { const row = rows.find(row => row.job.id === invoice.job_id)!; return [csvText(invoice.number), csvText(row.job.name), csvText(row.clientName), invoice.issued_date, invoice.paid_date, round2(invoice.amount), csvText(invoice.notes)] }))
    else if (query.tab === 'deposits') downloadCSV('billing-deposits.csv', ['Received', 'Job', 'Client', 'Amount $', 'Used $', 'Left $', 'Method', 'Notes'], deposits.map(deposit => { const row = rows.find(row => row.job.id === deposit.job_id)!; return [deposit.received_date, csvText(row.job.name), csvText(row.clientName), round2(deposit.amount), round2(usage.get(deposit.id) ?? 0), round2(Math.max(0, deposit.amount - (usage.get(deposit.id) ?? 0))), csvText(deposit.method), csvText(deposit.notes)] }))
    else downloadCSV(`billing-hours-${query.work}.csv`, ['Date', 'Job', 'Client', 'Phase', 'Hours', 'Billable', 'Saved rate $', 'Displayed billing amount $', 'Deposit coverage $', 'Status', 'Notes'], hours.map(row => { const job = rows.find(job => job.job.id === row.entry.job_id)!; return [row.entry.date, csvText(job.job.name), csvText(job.clientName), csvText(phaseName(store.phases, row.entry.phase_id)), row.entry.hours, row.entry.billable !== false ? 'Yes' : 'No', entryRate(store, row.entry), round2(workAmount(row, query.work)), round2(row.covered), HOUR_STATUS_LABEL[row.status], csvText(row.entry.notes)] }))
  }

  return <div className="billing-page">
    <div className="page-header billing-header"><div><h1>Billing</h1><p className="muted small">Invoice work, follow up on payments, and keep deposits in view.</p></div><button className="btn primary" onClick={() => setNewDeposit(true)}><Icon name="plus" size={15} /> Record deposit</button></div>
    <MoneyTotals rows={rows.map(row => row.billing)} />
    <nav className="billing-tabs" aria-label="Billing views">{(['jobs', 'invoices', 'deposits', 'hours'] as const).map(tab => <button key={tab} aria-pressed={query.tab === tab} onClick={() => patch({ tab, detail: '' })}>{tab === 'jobs' ? 'Jobs' : tab === 'invoices' ? 'Invoices' : tab === 'deposits' ? 'Deposits' : 'Hours'}</button>)}</nav>
    <section className="card billing-filters" aria-label="Billing filters"><div className="billing-filter-grid">
      <label>Search jobs or clients<input type="search" aria-label="Search billing jobs" value={query.q} placeholder="Name, job number or address…" onChange={event => patch({ q: event.target.value }, true)} /></label>
      <label>Client<select aria-label="Billing client" value={query.client} onChange={event => patch({ client: event.target.value, scope: '' })}><option value="">All clients</option>{query.client && !store.clients.some(client => client.id === query.client) && <option value={query.client}>Unavailable client — clear this filter</option>}{store.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label>Job status<select aria-label="Billing job status" value={query.status} onChange={event => patch({ status: event.target.value as BillingQuery['status'], scope: '' })}><option value="nonarchived">All except archived</option><option value="all">All job history</option><option value="open">Active &amp; on hold</option>{Object.entries(JOB_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Job<select aria-label="Billing job filter" value={query.scope} onChange={event => patch({ scope: event.target.value })}><option value="">All matched jobs</option>{query.scope && !jobOptions.some(row => row.job.id === query.scope) && <option value={query.scope}>Selected job outside these filters</option>}{jobOptions.map(row => <option key={row.job.id} value={row.job.id}>{row.job.job_number ? `${row.job.job_number} · ` : ''}{row.job.name}</option>)}</select></label>
      <label>Follow-up<select aria-label="Billing follow-up" value={query.focus} onChange={event => patch({ focus: event.target.value as BillingQuery['focus'] })}><option value="all">All matched jobs</option><option value="unbilled">Ready to bill</option><option value="outstanding">Awaiting payment</option></select></label>
    </div><div className="billing-filter-footer"><span role="status">{rows.length} matched {rows.length === 1 ? 'job' : 'jobs'} · summaries follow these filters</span><button className="btn ghost" onClick={() => patch({ q: '', client: '', scope: '', status: 'nonarchived', focus: 'all', detail: '' })}>Reset filters</button><button className="btn" onClick={exportRows}><Icon name="download" size={14} /> Export visible CSV</button></div></section>
    {query.tab === 'jobs' ? <section className="card"><div className="billing-section-heading"><h2>Job money</h2><span className="small muted">Lowest balance first</span></div><p className="tiny muted">{moneyBasis}</p>{rows.length ? <div className="billing-job-list">{rows.map(({ job, clientName, billing: b }) => <article key={job.id} className="billing-job-row"><div><Link className="bold" to={`/billing?job=${job.id}`}>{job.name} →</Link><div className="tiny muted">{job.job_number} · {clientName} · {JOB_STATUS_LABEL[job.status]}</div><div className="tiny muted">{fmtHours(b.loggedHours)} completed · {fmtHours(b.nonBillableHours)} nonbillable · {fmtHourlyRate(b.effectiveHourlyRate)}</div></div><div><span className="tiny muted">Ready to bill</span><Link to={`/billing?job=${job.id}`}>{fmtMoney(b.unbilledAmount)}</Link></div><div><span className="tiny muted">Awaiting payment</span><Link to={`/billing?job=${job.id}&section=invoices`}>{fmtMoney(b.outstanding)}</Link></div><div><span className="tiny muted">Job balance</span><b className={b.balance < 0 ? 'money-neg' : 'money-pos'}>{fmtSigned(b.balance)}</b></div></article>)}</div> : <Empty>No jobs match these filters. Reset filters to see other jobs.</Empty>}</section> : <>
      <div className="billing-list-controls"><label>Search this list<input type="search" aria-label="Search billing list" value={query.detail} placeholder={query.tab === 'invoices' ? 'Invoice number or note…' : query.tab === 'deposits' ? 'Method, date or note…' : 'Phase, date or note…'} onChange={event => patch({ detail: event.target.value }, true)} /></label>{query.tab === 'invoices' && <PaymentFilter value={query.payment} onChange={payment => patch({ payment })} />}{query.tab === 'hours' && <WorkFilter value={query.work} onChange={work => patch({ work })} />}</div>
      {query.tab === 'invoices' && <InvoiceList invoices={invoices} jobs={rows} />}
      {query.tab === 'deposits' && <DepositList deposits={deposits} jobs={rows} usage={usage} onEdit={setEditingDeposit} />}
      {query.tab === 'hours' && <section className="card"><h2>Completed hours</h2><p className="tiny muted">Running timers join Billing when stopped. Nonbillable amounts are $0 here; their effort and saved work value remain in each job's balance.</p><div className="billing-work-list">{hours.map(row => { const job = rows.find(job => job.job.id === row.entry.job_id)!; return <article className="billing-hour-row" key={row.entry.id}><div><Link className="bold" to={`/billing?job=${job.job.id}`}>{job.job.name}</Link><div className="small">{fmtDate(row.entry.date)} · {phaseName(store.phases, row.entry.phase_id)} · {fmtHours(row.entry.hours)}</div><div className="tiny muted">{row.entry.notes}</div><StatusBadge h={row} /></div><b>{fmtMoney(workAmount(row, query.work))}</b><button className="btn" aria-label={`Edit hours: ${row.entry.notes || row.entry.date}`} onClick={() => setEditingTime(row.entry)}>Edit hours</button></article> })}</div>{!hours.length && <Empty>No completed hours match this list.</Empty>}<p className="billing-list-total">{hours.length} visible entries · {fmtHours(sum(hours.map(row => row.entry.hours ?? 0)))} · {fmtMoney(sum(hours.map(row => workAmount(row, query.work))))} {query.work === 'paid' ? 'paid' : query.work === 'unbilled' ? 'ready to bill' : query.work === 'nonbillable' ? 'invoiceable' : 'billing amount'}</p></section>}
    </>}
    {newDeposit && <DepositModal jobId={query.scope || undefined} onClose={() => setNewDeposit(false)} />}{editingDeposit && <DepositModal deposit={editingDeposit} onClose={() => setEditingDeposit(null)} />}{editingTime && <TimeModal entry={editingTime} onClose={() => setEditingTime(null)} />}
  </div>
}

function MoneyTotals({ rows }: { rows: JobBilling[] }) {
  const stats = [
    { label: 'Ready to bill', amount: sum(rows.map(row => row.unbilledAmount)), caption: 'Billable work after deposits' },
    { label: 'Awaiting payment', amount: sum(rows.map(row => row.outstanding)), caption: 'Invoices with no paid date' },
    { label: 'Unused deposits', amount: sum(rows.map(row => row.depositRemaining)), caption: 'Received, not yet used by work' },
    { label: 'Collected', amount: sum(rows.map(row => row.collected)), caption: 'Deposits + paid invoices' },
  ]
  return <div className="stats billing-stats">{stats.map(stat => <div className="stat" key={stat.label}><div className="label">{stat.label}</div><div className="value">{fmtMoney(stat.amount)}</div><div className="sub">{stat.caption}</div></div>)}</div>
}
function WorkFilter({ value, onChange }: { value: BillingQuery['work']; onChange: (value: BillingQuery['work']) => void }) {
  return <label>Work status<select aria-label="Work status" value={value} onChange={event => onChange(event.target.value as BillingQuery['work'])}>{WORK_FILTERS.map(filter => <option key={filter.key} value={filter.key}>{filter.label}</option>)}</select></label>
}
function PaymentFilter({ value, onChange }: { value: BillingQuery['payment']; onChange: (value: BillingQuery['payment']) => void }) {
  return <label>Invoice status<select aria-label="Invoice status" value={value} onChange={event => onChange(event.target.value as BillingQuery['payment'])}><option value="unpaid">Awaiting payment</option><option value="all">All invoices</option><option value="paid">Paid invoices</option></select></label>
}
function filterInvoices(invoices: Invoice[], payment: BillingQuery['payment'], search: string) {
  return invoices.filter(invoice => (payment === 'all' || (payment === 'paid' ? Boolean(invoice.paid_date) : !invoice.paid_date && invoice.amount > 0.005)) && matchesBillingText([invoice.number, invoice.notes, invoice.issued_date].join(' '), search))
    .sort((a, b) => b.issued_date.localeCompare(a.issued_date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
}
function useMoneyActions() {
  const { update, refresh, toast } = useData()
  const locked = useRef(new Set<string>())
  const [pending, setPending] = useState(new Set<string>())
  const [error, setError] = useState('')
  async function run(key: string, table: TableName, id: string, patch: Record<string, unknown>, message: string) {
    if (locked.current.has(key)) return
    locked.current.add(key); setPending(new Set(locked.current)); setError('')
    try {
      if (!await update(table, id, patch)) { await refresh(table); setError('The change was not saved. The records were refreshed; check them before trying again.'); return }
      toast(message)
    } catch { await refresh(table); setError('Could not confirm the change. The records were refreshed; check them before trying again.') }
    finally { locked.current.delete(key); setPending(new Set(locked.current)) }
  }
  return { pending, error, run, isBusy: (key: string) => locked.current.has(key) }
}
function InvoiceList({ invoices, jobs, onNew }: { invoices: Invoice[]; jobs: BillingJobRow[]; onNew?: () => void }) {
  const [editing, setEditing] = useState<Invoice | null>(null)
  const { pending, error, run } = useMoneyActions()
  return <section className="card billing-invoices"><div className="billing-section-heading"><h2>Invoices</h2>{onNew && <button className="btn primary" onClick={onNew}>Record invoice</button>}</div>{error && <p role="alert" className="billing-error">{error}</p>}{invoices.length ? <div className="billing-invoice-list">{invoices.map(invoice => { const row = jobs.find(row => row.job.id === invoice.job_id); return <article className="billing-invoice-row" key={invoice.id}><div><button className="billing-text-button bold" disabled={pending.has(invoice.id)} onClick={() => setEditing(invoice)} aria-label={`Edit invoice ${invoice.number}`}>{invoice.number || 'Invoice'}</button><div className="small"><Link to={`/billing?job=${invoice.job_id}`}>{row?.job.name ?? 'Job'}</Link> · {row?.clientName}</div><div className="tiny muted">Issued {fmtDate(invoice.issued_date)}{invoice.notes && ` · ${invoice.notes}`}</div></div><div><b>{fmtMoney(invoice.amount)}</b><div className="tiny muted">{invoice.paid_date ? `Paid ${fmtDate(invoice.paid_date)}` : invoice.amount > 0.005 ? 'Awaiting payment' : 'No payment due'}</div></div><div className="billing-row-actions"><button className="btn" disabled={pending.has(invoice.id)} onClick={() => setEditing(invoice)} aria-label={`Edit invoice ${invoice.number} details`}>Edit</button>{!invoice.paid_date && invoice.amount > 0.005 && <button className="btn" disabled={pending.has(invoice.id)} onClick={() => void run(invoice.id, 'invoices', invoice.id, { paid_date: todayISO() }, `Invoice ${invoice.number} marked paid`)} aria-label={`Mark invoice ${invoice.number} paid`}>{pending.has(invoice.id) ? 'Saving…' : 'Mark paid'}</button>}</div></article> })}</div> : <Empty>No invoices match this list.</Empty>}<p className="billing-list-total">{invoices.length} visible invoices · {fmtMoney(sum(invoices.map(invoice => invoice.amount)))}</p>{editing && <InvoiceModal invoice={editing} jobId={editing.job_id} onClose={() => setEditing(null)} />}</section>
}
function DepositList({ deposits, jobs, usage, onEdit }: { deposits: Deposit[]; jobs: BillingJobRow[]; usage: Map<string, number>; onEdit: (deposit: Deposit) => void }) {
  return <section className="card"><h2>Deposits</h2><p className="tiny muted">Deposits fund billable hours and charges oldest first. Saved credits on invoiced work remain reserved. Nonbillable time does not use deposits.</p>{deposits.length ? <div className="billing-deposit-list">{deposits.map(deposit => { const row = jobs.find(row => row.job.id === deposit.job_id); const used = usage.get(deposit.id) ?? 0; return <article className="billing-deposit-row" key={deposit.id}><div><Link className="bold" to={`/billing?job=${deposit.job_id}`}>{row?.job.name ?? 'Job'}</Link><div className="small">{fmtDate(deposit.received_date)} · {deposit.method}</div><div className="tiny muted">{row?.clientName}{deposit.notes && ` · ${deposit.notes}`}</div></div><div><b>{fmtMoney(deposit.amount)}</b><div className="tiny muted">{fmtMoney(used)} used · {fmtMoney(Math.max(0, deposit.amount - used))} left</div></div><button className="btn" onClick={() => onEdit(deposit)} aria-label={`Edit deposit received ${deposit.received_date} for ${row?.job.name}`}>Edit</button></article> })}</div> : <Empty>No deposits match this list.</Empty>}<p className="billing-list-total">{deposits.length} visible deposits · {fmtMoney(sum(deposits.map(deposit => deposit.amount)))} received · {fmtMoney(sum(deposits.map(deposit => Math.max(0, deposit.amount - (usage.get(deposit.id) ?? 0)))))} left</p></section>
}

export function StatusBadge({ h }: { h: { status: HourStatus; amount: number; covered: number; entry?: TimeEntry; item?: JobItem } }) {
  const { invoices } = useData()
  const invoice = invoices.find(invoice => invoice.id === (h.entry?.invoice_id ?? h.item?.invoice_id))
  const label = h.status === 'nonbillable' ? 'Nonbillable' : h.status === 'partial' ? `${fmtMoney(Math.max(0, h.amount - h.covered))} ready to bill` : h.status === 'billed' && h.covered > 0 ? `${fmtMoney(Math.max(0, h.amount - h.covered))} billed, not paid` : HOUR_STATUS_LABEL[h.status]
  return <span className={`badge h-${h.status}`} title={h.covered > 0 ? `Deposit covers ${fmtMoney(h.covered)} of ${fmtMoney(h.amount)}` : undefined}>{label}{invoice && (h.status === 'billed' || h.status === 'paid') ? ` · ${invoice.number}` : ''}</span>
}

function JobMoney({ jobId }: { jobId: string }) {
  const store = useData()
  const { query, patch, params } = useBillingQuery()
  const job = store.jobs.find(job => job.id === jobId)
  const billing = useMemo(() => job ? jobBilling(store, job) : null, [store, job])
  const charges = useMemo(() => jobCharges(store, jobId), [store, jobId])
  const work = useMemo(() => workRows(charges), [charges])
  const [selected, setSelected] = useState(new Set<string>())
  const [invoiceModal, setInvoiceModal] = useState<{ entryIds?: string[]; itemIds?: string[]; amount?: number } | null>(null)
  const [depositModal, setDepositModal] = useState<{ deposit?: Deposit } | null>(null)
  const [itemModal, setItemModal] = useState<{ item?: JobItem } | null>(null)
  const [timeModal, setTimeModal] = useState<{ entry?: TimeEntry } | null>(null)
  const { pending, error, run, isBusy } = useMoneyActions()
  const visible = work.filter(row => matchesWork(row, query.work) && matchesBillingText(row.kind === 'hours' ? [row.entry.notes, row.entry.date, phaseName(store.phases, row.entry.phase_id)].join(' ') : [row.item.description, row.item.category, row.item.date].join(' '), query.detail))
  const visibleIds = new Set(visible.map(row => row.id))
  const selection = invoiceSelection(work.filter(row => !pending.has(row.id)), selected, visibleIds)
  const eligibleKey = selection.eligible.map(row => row.id).join('|')
  useEffect(() => {
    // Realtime writes can bill, move, delete, or reclassify selected work. Forget
    // those IDs so a later reversal cannot silently reselect them for invoicing.
    const eligibleIds = new Set(eligibleKey ? eligibleKey.split('|') : [])
    setSelected(previous => { const next = new Set([...previous].filter(id => eligibleIds.has(id))); return next.size === previous.size ? previous : next })
  }, [eligibleKey])
  if (!job || !billing) return <div className="billing-page card"><Empty>{store.loading ? 'Loading job…' : 'Job not found.'} <Link to="/billing">Back to Billing</Link></Empty></div>
  const clientName = store.clients.find(client => client.id === job.client_id)?.name ?? ''
  const jobs = [{ job, clientName, billing }]
  const invoices = filterInvoices(store.invoices.filter(invoice => invoice.job_id === jobId), query.payment, query.detail)
  const deposits = store.deposits.filter(deposit => deposit.job_id === jobId && matchesBillingText([deposit.notes, deposit.method, deposit.received_date].join(' '), query.detail)).sort((a, b) => b.received_date.localeCompare(a.received_date) || a.id.localeCompare(b.id))
  const back = writeBillingQuery(params, { job: '', section: 'work', detail: '' })
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const readyVisible = visible.filter(row => canInvoice(row) && !pending.has(row.id))
  function invoiceSelected() {
    if (selection.chosen.length) setInvoiceModal({ entryIds: selection.entryIds, itemIds: selection.itemIds, amount: selection.amount })
  }
  function unbill(row: BillingWork) {
    if (isBusy(row.id) || !confirm('Remove this work from its invoice? The invoice amount stays unchanged.')) return
    void run(row.id, row.kind === 'hours' ? 'time_entries' : 'job_items', row.kind === 'hours' ? row.entry.id : row.item.id,
      { billed: false, invoice_id: null, deposit_applied: null }, 'Work removed from its invoice')
  }
  return <div className="billing-page billing-job-money">
    <div className="page-header billing-header"><div><div className="small muted"><Link to={`/billing${back.size ? `?${back}` : ''}`}>Billing</Link> › {clientName}</div><h1>{job.name}</h1><div className="small muted">{job.job_number} · {JOB_STATUS_LABEL[job.status]} · <Link to={`/jobs/${jobId}`}>Open job →</Link></div></div><div className="billing-row-actions"><button className="btn" onClick={() => setDepositModal({})}>Record deposit</button><button className="btn primary" onClick={() => setInvoiceModal({})}>Record invoice</button></div></div>
    <MoneyTotals rows={[billing]} />
    <nav className="billing-tabs" aria-label="Job billing sections">{(['work', 'invoices', 'deposits', 'overview'] as const).map(section => <button key={section} aria-pressed={query.section === section} onClick={() => patch({ section, detail: '' })}>{section === 'work' ? 'Work to invoice' : section === 'invoices' ? 'Invoices' : section === 'deposits' ? 'Deposits' : 'Overview'}</button>)}</nav>
    {query.section === 'work' && <section className="card billing-job-work"><div className="billing-section-heading"><h2>Hours &amp; charges</h2><div className="billing-row-actions"><button className="btn" onClick={() => setTimeModal({})}>Log hours</button><button className="btn" onClick={() => setItemModal({})}>Add charge</button></div></div><p className="tiny muted">Select completed billable work that still needs an invoice. Deposits are deducted from the amount to invoice. Nonbillable time stays in job effort and balance.</p>
      <div className="billing-list-controls"><WorkFilter value={query.work} onChange={work => patch({ work })} /><label>Search work<input type="search" aria-label="Search job billing work" value={query.detail} placeholder="Notes, phase or charge…" onChange={event => patch({ detail: event.target.value }, true)} /></label></div>
      <div className="billing-selection"><div><b>{selection.chosen.length} selected · {fmtMoney(selection.amount)} to invoice</b>{selection.hidden > 0 && <p className="small" role="status">{selection.hidden} selected {selection.hidden === 1 ? 'row is' : 'rows are'} hidden by these filters. Invoice selected includes them.</p>}</div><div className="billing-row-actions"><button className="btn" disabled={!readyVisible.length} onClick={() => setSelected(previous => new Set([...previous, ...readyVisible.map(row => row.id)]))}>Select visible ready work</button><button className="btn" disabled={!selection.eligible.length} onClick={() => setSelected(new Set(selection.eligible.map(row => row.id)))}>Select all ready work on job</button>{selection.chosen.length > 0 && <button className="btn ghost" onClick={() => setSelected(new Set())}>Clear selection</button>}{selection.hidden > 0 && <button className="btn ghost" onClick={() => setSelected(previous => new Set([...previous].filter(id => visibleIds.has(id))))}>Clear hidden selection</button>}<button className="btn primary" disabled={!selection.chosen.length} onClick={invoiceSelected}>Invoice selected</button></div></div>
      {error && <p role="alert" className="billing-error">{error}</p>}{visible.length ? <div className="billing-work-list">{visible.map(row => { const source = row.kind === 'hours' ? row.entry : row.item; const title = row.kind === 'hours' ? row.entry.notes || 'Completed time' : row.item.description || row.item.category; return <article className={`billing-work-row ${selected.has(row.id) && canInvoice(row) ? 'is-selected' : ''}`} key={row.id}>
        <div className="billing-select-cell">{canInvoice(row) ? <label className="billing-work-checkbox"><input type="checkbox" aria-label={`Select ${row.kind === 'hours' ? 'hours' : 'charge'}: ${title}`} checked={selected.has(row.id)} disabled={pending.has(row.id)} onChange={() => toggle(row.id)} /><span className="sr-only">Select {title}</span></label> : <span aria-hidden="true">—</span>}</div><div><b>{title}</b><div className="small muted">{fmtDate(source.date)} · {row.kind === 'hours' ? `${phaseName(store.phases, row.entry.phase_id)} · ${fmtHours(row.entry.hours)} × ${fmtMoney(entryRate(store, row.entry))}/h` : `${row.item.category} · ${row.item.quantity} × ${fmtMoney(row.item.unit_price)}`}</div><StatusBadge h={row} />{row.covered > 0 && <div className="tiny muted">{fmtMoney(row.covered)} covered by deposit</div>}{row.status === 'nonbillable' && <div className="tiny muted">{fmtMoney(row.amount)} work value retained in balance</div>}</div><div className="billing-work-amount"><b>{fmtMoney(workAmount(row, query.work))}</b><span className="tiny muted">{query.work === 'paid' ? 'paid' : query.work === 'unbilled' ? 'to invoice' : 'billing amount'}</span></div><div className="billing-row-actions"><button className="btn" disabled={pending.has(row.id)} aria-label={`Edit ${row.kind === 'hours' ? 'hours' : 'charge'}: ${title}`} onClick={() => row.kind === 'hours' ? setTimeModal({ entry: row.entry }) : setItemModal({ item: row.item })}>Edit</button>{(row.status === 'billed' || row.status === 'paid') && <button className="btn ghost" aria-label={`Unbill ${row.kind === 'hours' ? 'hours' : 'charge'}: ${title}`} disabled={pending.has(row.id)} onClick={() => unbill(row)}>{pending.has(row.id) ? 'Saving…' : 'Unbill'}</button>}</div></article> })}</div> : <Empty>No work matches these filters. Choose All work to see billed or nonbillable history.</Empty>}<p className="billing-list-total">{visible.length} visible rows · {fmtMoney(sum(visible.map(row => workAmount(row, query.work))))} {query.work === 'unbilled' ? 'ready to invoice' : query.work === 'paid' ? 'paid' : 'billing amount'} · {fmtHours(sum(visible.filter(row => row.kind === 'hours').map(row => row.entry.hours ?? 0)))} completed hours shown</p>
    </section>}
    {query.section === 'invoices' && <><div className="billing-list-controls"><PaymentFilter value={query.payment} onChange={payment => patch({ payment })} /><label>Search invoices<input type="search" aria-label="Search job invoices" value={query.detail} onChange={event => patch({ detail: event.target.value }, true)} /></label></div><InvoiceList invoices={invoices} jobs={jobs} onNew={() => setInvoiceModal({})} /></>}
    {query.section === 'deposits' && <><div className="billing-list-controls"><label>Search deposits<input type="search" aria-label="Search job deposits" value={query.detail} onChange={event => patch({ detail: event.target.value }, true)} /></label></div><DepositList deposits={deposits} jobs={jobs} usage={depositUsage(store, jobId)} onEdit={deposit => setDepositModal({ deposit })} /></>}
    {query.section === 'overview' && <div className="billing-overview-grid"><FeesSummary b={billing} /><section className="card"><h2>Job balance</h2><div className={`billing-balance ${billing.balance < 0 ? 'money-neg' : 'money-pos'}`}>{fmtSigned(billing.balance)}</div><p className="small muted">{moneyBasis}</p><dl className="billing-facts"><div><dt>Completed work &amp; charges</dt><dd>{fmtMoney(billing.workValue)}</dd></div><div><dt>Deposits received</dt><dd>{fmtMoney(billing.deposits)}</dd></div><div><dt>Invoices recorded</dt><dd>{fmtMoney(billing.invoiced)}</dd></div></dl><WorkStatusBar b={billing} /></section><section className="card billing-balance-chart"><h2>Balance over time</h2><BalanceChart points={balanceHistory(store, jobId)} /></section></div>}
    {invoiceModal && <InvoiceModal jobId={jobId} entryIds={invoiceModal.entryIds} itemIds={invoiceModal.itemIds} defaultAmount={invoiceModal.amount} onClose={() => setInvoiceModal(null)} />}{depositModal && <DepositModal jobId={jobId} deposit={depositModal.deposit} onClose={() => setDepositModal(null)} />}{itemModal && <ItemModal jobId={jobId} item={itemModal.item} onClose={() => setItemModal(null)} />}{timeModal && <TimeModal entry={timeModal.entry} defaults={{ job_id: jobId }} onClose={() => setTimeModal(null)} />}
  </div>
}
