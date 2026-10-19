// Money: what's ready to bill, what's owed, deposits on hand, and reports.
// The tab and filters live in the address bar so links (and Back) keep them.
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns'
import { ArrowRight, BarChart3, CircleDollarSign, Download, HandCoins, PiggyBank, Plus, Receipt, Send, Wallet } from 'lucide-react'
import { useData } from '../lib/store'
import { useEditors } from '../components/editors'
import { Empty, Segmented } from '../components/ui'
import { depositUsage, entryAmount, entryHours, hoursForPhase, isBillable, jobBilling, type JobBilling } from '../lib/calc'
import { isWorkflowPhase } from '../lib/phases'
import { PHASE_KIND_LABEL, type Invoice, type Job, type PhaseKind } from '../lib/types'
import { downloadCSV, fmtDate, fmtHourlyRate, fmtHours, fmtMoney, sum, todayISO } from '../lib/utils'
import './money.css'

type Tab = 'overview' | 'unbilled' | 'invoices' | 'deposits' | 'reports'
const TABS: [Tab, string][] = [['overview', 'Overview'], ['unbilled', 'Ready to bill'], ['invoices', 'Invoices'], ['deposits', 'Deposits'], ['reports', 'Reports']]

const daysSince = (iso: string, today: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(iso)) / 86400000))

interface Row { job: Job; client: string; b: JobBilling }

export function Money() {
  const store = useData()
  const edit = useEditors()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some(([t]) => t === params.get('tab')) ? params.get('tab') : 'overview') as Tab
  const patch = (next: Record<string, string | null>) => setParams(p => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(next)) { if (v == null || v === '') n.delete(k); else n.set(k, v) }
    return n
  }, { replace: true })

  // Financial totals keep every job that isn't archived, including complete and cancelled ones.
  const rows = useMemo<Row[]>(() => store.jobs.filter(j => j.status !== 'archived').map(job => ({
    job, client: store.clients.find(c => c.id === job.client_id)?.name ?? '', b: jobBilling(store, job),
  })), [store])
  const today = todayISO()
  const unpaid = store.invoices.filter(i => !i.paid_date).sort((a, b) => a.issued_date.localeCompare(b.issued_date))
  const ready = rows.filter(r => r.b.unbilledAmount > 0.5).sort((a, b) => b.b.unbilledAmount - a.b.unbilledAmount)

  return <div className="money-page">
    <div className="page-head">
      <div className="titles">
        <h1>Money</h1>
        <p className="lede">Bill your work, follow up on what's owed, and see how the business is doing.</p>
      </div>
      <div className="actions hide-sm">
        <button className="btn" onClick={() => edit.deposit()}><Wallet size={16} /> Record deposit</button>
        <button className="btn primary" onClick={() => edit.charge()}><Plus size={16} /> Add charge</button>
      </div>
    </div>

    <div className="tabs" role="tablist">
      {TABS.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })}>
        {label}
        {t === 'unbilled' && ready.length > 0 && <span className="count">{ready.length}</span>}
        {t === 'invoices' && unpaid.length > 0 && <span className="count">{unpaid.length}</span>}
      </button>)}
    </div>

    <div className="money-body">
      {tab === 'overview' && <Overview rows={rows} ready={ready} unpaid={unpaid} today={today} />}
      {tab === 'unbilled' && <Unbilled ready={ready} />}
      {tab === 'invoices' && <Invoices filter={(params.get('filter') as InvoiceFilter) || 'unpaid'} setFilter={f => patch({ filter: f === 'unpaid' ? null : f })} today={today} />}
      {tab === 'deposits' && <Deposits />}
      {tab === 'reports' && <Reports range={(params.get('range') as RangeKey) || 'this_month'} from={params.get('from') ?? ''} to={params.get('to') ?? ''} patch={patch} />}
    </div>
  </div>
}

/* ---------------- Overview ---------------- */

function Overview({ rows, ready, unpaid, today }: { rows: Row[]; ready: Row[]; unpaid: Invoice[]; today: string }) {
  const store = useData()
  const edit = useEditors()
  const year = today.slice(0, 4)
  const readyTotal = sum(ready.map(r => r.b.unbilledAmount))
  const unpaidTotal = sum(unpaid.map(i => i.amount))
  const oldest = unpaid[0] ? daysSince(unpaid[0].issued_date, today) : 0
  const unused = sum(rows.map(r => r.b.depositRemaining))
  const collected = sum(store.deposits.filter(d => d.received_date.startsWith(year)).map(d => d.amount)) + sum(store.invoices.filter(i => i.paid_date?.startsWith(year)).map(i => i.amount))
  const jobName = (id: string) => store.jobs.find(j => j.id === id)?.name ?? 'Job'
  const recent = [
    ...store.invoices.filter(i => i.paid_date).map(i => ({ key: `i-${i.id}`, date: i.paid_date!, label: `${i.number} paid`, job: jobName(i.job_id), amount: i.amount, to: `/money/invoice/${i.id}`, kind: 'invoice' as const })),
    ...store.deposits.map(d => ({ key: `d-${d.id}`, date: d.received_date, label: `Deposit${d.method ? ` · ${d.method}` : ''}`, job: jobName(d.job_id), amount: d.amount, to: `/jobs/${d.job_id}?tab=billing`, kind: 'deposit' as const })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6)

  return <div className="stack loose">
    <div className="stats">
      <Link className="stat" to="/money?tab=unbilled">
        <span className="label"><CircleDollarSign size={15} /> Ready to bill</span>
        <span className="value">{fmtMoney(readyTotal)}</span>
        <span className="sub">{ready.length} job{ready.length === 1 ? '' : 's'} with unbilled work</span>
      </Link>
      <Link className={`stat ${oldest > 30 ? 'danger' : ''}`} to="/money?tab=invoices">
        <span className="label"><Send size={15} /> Awaiting payment</span>
        <span className="value">{fmtMoney(unpaidTotal)}</span>
        <span className="sub">{unpaid.length ? `${unpaid.length} invoice${unpaid.length === 1 ? '' : 's'} · oldest ${oldest} day${oldest === 1 ? '' : 's'}` : 'Nothing owed right now'}</span>
      </Link>
      <Link className="stat" to="/money?tab=deposits">
        <span className="label"><PiggyBank size={15} /> Unused deposits</span>
        <span className="value">{fmtMoney(unused)}</span>
        <span className="sub">Paid up front, not yet worked off</span>
      </Link>
      <Link className="stat ok" to="/money?tab=reports&range=this_year">
        <span className="label"><HandCoins size={15} /> Collected in {year}</span>
        <span className="value">{fmtMoney(collected)}</span>
        <span className="sub">Deposits + paid invoices</span>
      </Link>
    </div>

    <div className="money-two">
      <section className="card">
        <div className="card-head"><h2>Ready to bill <span className="sub">{fmtMoney(readyTotal)}</span></h2><Link className="small" to="/money?tab=unbilled">See all <ArrowRight size={13} className="inline-ico" /></Link></div>
        {ready.length === 0 ? <Empty compact icon={<CircleDollarSign size={20} />} title="Nothing to bill">All billable work is invoiced or covered by deposits.</Empty> :
          <ul className="list">{ready.slice(0, 6).map(r => <li key={r.job.id} className="list-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <Link to={`/jobs/${r.job.id}?tab=billing`} className="title clamp-2" style={{ color: 'var(--text)' }}>{r.job.name}</Link>
              <div className="meta">{r.client} · {fmtHours(r.b.unbilledHours)} not billed{r.b.unbilledItems > 0.5 ? ` + ${fmtMoney(r.b.unbilledItems)} charges` : ''}</div>
            </div>
            <strong className="num">{fmtMoney(r.b.unbilledAmount)}</strong>
            <button className="btn sm soft invoice-btn" onClick={() => edit.invoice(r.job.id)} aria-label={`Invoice ${r.job.name}`}><Receipt size={14} /><span className="hide-sm">Invoice</span></button>
          </li>)}</ul>}
      </section>

      <section className="card">
        <div className="card-head"><h2>Awaiting payment <span className="sub">{fmtMoney(unpaidTotal)}</span></h2><Link className="small" to="/money?tab=invoices">All invoices <ArrowRight size={13} className="inline-ico" /></Link></div>
        {unpaid.length === 0 ? <Empty compact icon={<Send size={20} />} title="No unpaid invoices">Every invoice you've sent has been paid.</Empty> :
          <ul className="list">{unpaid.slice(0, 6).map(i => { const age = daysSince(i.issued_date, today); const client = store.clients.find(c => c.id === store.jobs.find(j => j.id === i.job_id)?.client_id); return <li key={i.id} className="list-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <Link to={`/money/invoice/${i.id}`} className="title">{i.number}</Link> <span className="small muted">· {jobName(i.job_id)}</span>
              <div className={`meta ${age > 30 ? 'danger-text' : ''}`}>Sent {fmtDate(i.issued_date)} · {age} day{age === 1 ? '' : 's'} ago{client ? ` · ${client.name}` : ''}</div>
            </div>
            <strong className="num">{fmtMoney(i.amount)}</strong>
            <button className="btn sm" onClick={() => edit.paid(i)}>Paid</button>
          </li> })}</ul>}
      </section>
    </div>

    <section className="card">
      <div className="card-head"><h2>Recent payments</h2><span className="sub">Deposits and paid invoices</span></div>
      {recent.length === 0 ? <Empty compact icon={<HandCoins size={20} />} title="No payments yet">Deposits and paid invoices will show up here.</Empty> :
        <div className="list">{recent.map(p => <Link key={p.key} to={p.to} className="list-row link">
          <span className={`pay-ico ${p.kind}`}>{p.kind === 'deposit' ? <Wallet size={15} /> : <Receipt size={15} />}</span>
          <div className="grow" style={{ minWidth: 0 }}><div className="title truncate">{p.label}</div><div className="meta truncate">{p.job}</div></div>
          <span className="small muted nowrap hide-sm">{fmtDate(p.date, 'long')}</span>
          <span className="small muted nowrap show-sm">{fmtDate(p.date)}</span>
          <strong className="num ok-text">+{fmtMoney(p.amount)}</strong>
        </Link>)}</div>}
    </section>
  </div>
}

/* ---------------- Ready to bill ---------------- */

function Unbilled({ ready }: { ready: Row[] }) {
  const edit = useEditors()
  const navigate = useNavigate()
  if (!ready.length) return <div className="card"><Empty icon={<CircleDollarSign size={22} />} title="Nothing waiting to be billed">When you log billable hours or add charges that a deposit doesn't cover, they show up here.</Empty></div>
  return <section className="card">
    <div className="card-head"><h2>Jobs with unbilled work</h2><span className="sub">After deposits are applied</span></div>
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Job</th><th className="hide-sm">Client</th><th className="num hide-sm">Hours</th><th className="num hide-sm">Charges</th><th className="num">To bill</th><th className="num hide-sm">Deposit left</th><th /></tr></thead>
      <tbody>{ready.map(r => <tr key={r.job.id} className="clickable" onClick={() => navigate(`/jobs/${r.job.id}?tab=billing`)}>
        <td><span className="strong">{r.job.name}</span><div className="tiny muted">{[r.job.job_number, r.client].filter(Boolean).join(' · ')}</div></td>
        <td className="hide-sm soft">{r.client}</td>
        <td className="num hide-sm">{fmtHours(r.b.unbilledHours)}</td>
        <td className="num hide-sm">{r.b.unbilledItems > 0.5 ? fmtMoney(r.b.unbilledItems) : <span className="muted">—</span>}</td>
        <td className="num strong">{fmtMoney(r.b.unbilledAmount)}</td>
        <td className="num hide-sm">{r.b.depositRemaining > 0.5 ? fmtMoney(r.b.depositRemaining) : <span className="muted">—</span>}</td>
        <td className="right" onClick={e => e.stopPropagation()}><button className="btn sm soft" onClick={() => edit.invoice(r.job.id)}><Receipt size={14} /> Invoice</button></td>
      </tr>)}</tbody>
      <tfoot><tr>
        <td>Total</td><td className="hide-sm" />
        <td className="num hide-sm">{fmtHours(sum(ready.map(r => r.b.unbilledHours)))}</td>
        <td className="num hide-sm">{fmtMoney(sum(ready.map(r => r.b.unbilledItems)))}</td>
        <td className="num">{fmtMoney(sum(ready.map(r => r.b.unbilledAmount)))}</td>
        <td className="num hide-sm">{fmtMoney(sum(ready.map(r => r.b.depositRemaining)))}</td><td />
      </tr></tfoot>
    </table></div>
  </section>
}

/* ---------------- Invoices ---------------- */

type InvoiceFilter = 'unpaid' | 'paid' | 'all'

function Invoices({ filter, setFilter, today }: { filter: InvoiceFilter; setFilter: (f: InvoiceFilter) => void; today: string }) {
  const store = useData()
  const edit = useEditors()
  const navigate = useNavigate()
  const list = store.invoices
    .filter(i => filter === 'all' || (filter === 'paid') === Boolean(i.paid_date))
    .sort((a, b) => filter === 'unpaid' ? a.issued_date.localeCompare(b.issued_date) : b.issued_date.localeCompare(a.issued_date))
  const job = (i: Invoice) => store.jobs.find(j => j.id === i.job_id)
  const client = (i: Invoice) => store.clients.find(c => c.id === job(i)?.client_id)?.name ?? ''
  const exportCsv = () => downloadCSV('invoices.csv', ['Invoice #', 'Job #', 'Job', 'Client', 'Issued', 'Paid', 'Amount', 'Notes'],
    list.map(i => [i.number, job(i)?.job_number ?? '', job(i)?.name ?? '', client(i), i.issued_date, i.paid_date ?? '', Math.round(i.amount * 100) / 100, i.notes]))

  return <section className="card">
    <div className="card-head">
      <Segmented size="sm" label="Which invoices" value={filter} onChange={setFilter} options={[
        { value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' },
      ]} />
      <div className="row"><span className="small muted hide-sm">{list.length} · {fmtMoney(sum(list.map(i => i.amount)))}</span>{list.length > 0 && <button className="btn sm" onClick={exportCsv}><Download size={14} /> CSV</button>}</div>
    </div>
    {list.length === 0 ? <Empty compact icon={<Receipt size={20} />} title={filter === 'unpaid' ? 'No unpaid invoices' : 'No invoices here'}>{filter === 'unpaid' ? 'Everything you’ve invoiced has been paid.' : 'Create invoices from a job’s Billing tab or the Ready to bill list.'}</Empty> :
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Invoice</th><th>Job</th><th className="hide-sm">Issued</th><th>Status</th><th className="num">Amount</th><th className="hide-sm" /></tr></thead>
        <tbody>{list.map(i => { const age = daysSince(i.issued_date, today); const j = job(i); return <tr key={i.id} className="clickable" onClick={() => navigate(`/money/invoice/${i.id}`)}>
          <td className="strong nowrap">{i.number}</td>
          <td><span className="truncate" style={{ display: 'block', maxWidth: 280 }}>{j?.name ?? '—'}</span><div className="tiny muted">{client(i)}</div></td>
          <td className="hide-sm nowrap">{fmtDate(i.issued_date)}</td>
          <td>{i.paid_date ? <span className="badge ok">Paid {fmtDate(i.paid_date)}</span> : <span className={`badge ${age > 30 ? 'danger' : 'warn'}`}>Unpaid · {age}d</span>}</td>
          <td className="num strong">{fmtMoney(i.amount)}</td>
          <td className="hide-sm right nowrap" onClick={e => e.stopPropagation()}>
            {!i.paid_date && <button className="btn xs" onClick={() => edit.paid(i)}>Paid</button>}{' '}
            {j && <button className="btn ghost xs" onClick={() => edit.invoice(j.id, i)}>Edit</button>}
          </td>
        </tr> })}</tbody>
      </table></div>}
  </section>
}

/* ---------------- Deposits ---------------- */

function Deposits() {
  const store = useData()
  const edit = useEditors()
  const usage = useMemo(() => {
    const out = new Map<string, number>()
    for (const jobId of new Set(store.deposits.map(d => d.job_id))) for (const [id, used] of depositUsage(store, jobId)) out.set(id, used)
    return out
  }, [store])
  const list = [...store.deposits].sort((a, b) => b.received_date.localeCompare(a.received_date))
  const total = sum(list.map(d => d.amount)), used = sum(list.map(d => usage.get(d.id) ?? 0))
  return <section className="card">
    <div className="card-head">
      <h2>Deposits <span className="sub">{fmtMoney(total)} received · {fmtMoney(Math.max(0, total - used))} not used yet</span></h2>
      <button className="btn sm primary" onClick={() => edit.deposit()}><Wallet size={15} /> Record deposit</button>
    </div>
    {list.length === 0 ? <Empty compact icon={<Wallet size={20} />} title="No deposits yet">Record a retainer when a client pays up front. It pays for that job's work automatically, oldest first.</Empty> :
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Received</th><th>Job</th><th className="hide-sm">How paid</th><th className="num">Amount</th><th className="dep-use-col">Used</th></tr></thead>
        <tbody>{list.map(d => { const j = store.jobs.find(x => x.id === d.job_id); const u = usage.get(d.id) ?? 0; return <tr key={d.id} className="clickable" onClick={() => edit.deposit(d)}>
          <td className="nowrap">{fmtDate(d.received_date)}</td>
          <td><span className="truncate" style={{ display: 'block', maxWidth: 280 }}>{j?.name ?? '—'}</span>{d.notes && <div className="tiny muted truncate" style={{ maxWidth: 280 }}>{d.notes}</div>}</td>
          <td className="hide-sm soft">{d.method || '—'}</td>
          <td className="num strong">{fmtMoney(d.amount)}</td>
          <td className="dep-use-col"><div className="progress ok"><span style={{ width: `${d.amount ? Math.min(100, u / d.amount * 100) : 0}%` }} /></div><div className="tiny muted" style={{ marginTop: 4 }}>{fmtMoney(u)} used · {fmtMoney(Math.max(0, d.amount - u))} left</div></td>
        </tr> })}</tbody>
      </table></div>}
  </section>
}

/* ---------------- Reports ---------------- */

type RangeKey = 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom'
const RANGE_LABEL: Record<RangeKey, string> = { this_month: 'This month', last_month: 'Last month', this_year: 'This year', last_year: 'Last year', custom: 'Custom' }
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

function rangeDates(key: RangeKey, from: string, to: string): [string, string] {
  const now = new Date()
  switch (key) {
    case 'last_month': { const m = subMonths(now, 1); return [iso(startOfMonth(m)), iso(endOfMonth(m))] }
    case 'this_year': return [iso(startOfYear(now)), iso(endOfYear(now))]
    case 'last_year': { const y = subYears(now, 1); return [iso(startOfYear(y)), iso(endOfYear(y))] }
    case 'custom': return [/^\d{4}-\d{2}-\d{2}$/.test(from) ? from : iso(startOfMonth(now)), /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : iso(now)]
    default: return [iso(startOfMonth(now)), iso(endOfMonth(now))]
  }
}

interface HourGroup { key: string; name: string; sub?: string; billable: number; nonbillable: number; value: number }

function Reports({ range, from, to, patch }: { range: RangeKey; from: string; to: string; patch: (n: Record<string, string | null>) => void }) {
  const store = useData()
  const key: RangeKey = range in RANGE_LABEL ? range : 'this_month'
  const [start, end] = rangeDates(key, from, to)

  const data = useMemo(() => {
    const inRange = (d: string | null | undefined) => Boolean(d && d >= start && d <= end)
    const entries = store.timeEntries.filter(e => e.hours != null && inRange(e.date))
    const byJob = new Map<string, HourGroup>(), byClient = new Map<string, HourGroup>()
    for (const e of entries) {
      const job = store.jobs.find(j => j.id === e.job_id)
      const client = store.clients.find(c => c.id === job?.client_id)
      const h = entryHours(e), v = entryAmount(store, e), bill = isBillable(e)
      const add = (map: Map<string, HourGroup>, k: string, name: string, sub?: string) => {
        const g = map.get(k) ?? { key: k, name, sub, billable: 0, nonbillable: 0, value: 0 }
        if (bill) g.billable += h; else g.nonbillable += h
        g.value += v
        map.set(k, g)
      }
      add(byJob, e.job_id, job?.name ?? 'Deleted job', [job?.job_number, client?.name].filter(Boolean).join(' · '))
      add(byClient, client?.id ?? 'none', client?.name ?? 'No client')
    }
    const order = (m: Map<string, HourGroup>) => [...m.values()].sort((a, b) => (b.billable + b.nonbillable) - (a.billable + a.nonbillable))
    const hours = sum(entries.map(entryHours))
    const billable = sum(entries.filter(isBillable).map(entryHours))
    const deposits = sum(store.deposits.filter(d => inRange(d.received_date)).map(d => d.amount))
    const invoiced = sum(store.invoices.filter(i => inRange(i.issued_date)).map(i => i.amount))
    const paid = sum(store.invoices.filter(i => inRange(i.paid_date)).map(i => i.amount))
    // Estimate vs actual, all time, for jobs that are not archived or cancelled.
    const jobIds = new Set(store.jobs.filter(j => j.status !== 'archived' && j.status !== 'cancelled').map(j => j.id))
    const kinds = new Map<PhaseKind, { estimate: number; actual: number; phases: number }>()
    for (const p of store.phases) {
      if (!isWorkflowPhase(p) || !jobIds.has(p.job_id)) continue
      const actual = hoursForPhase(store.timeEntries, p.id)
      if (!p.estimate_hours && !actual) continue
      const k = kinds.get(p.kind) ?? { estimate: 0, actual: 0, phases: 0 }
      k.estimate += p.estimate_hours; k.actual += actual; k.phases++
      kinds.set(p.kind, k)
    }
    const order2: PhaseKind[] = ['bidding', 'design', 'plan_check', 'construction', 'client_changes']
    return {
      jobs: order(byJob), clients: order(byClient), hours, billable, deposits, invoiced, paid,
      rate: hours > 0 ? (deposits + invoiced) / hours : null,
      phaseKinds: order2.filter(k => kinds.has(k)).map(k => ({ kind: k, ...kinds.get(k)! })),
    }
  }, [store, start, end])

  const exportCsv = () => downloadCSV(`hours-${start}-to-${end}.csv`, ['Job', 'Job # · Client', 'Billable hours', 'Non-billable hours', 'Total hours', 'Value at saved rates'],
    data.jobs.map(g => [g.name, g.sub ?? '', round2(g.billable), round2(g.nonbillable), round2(g.billable + g.nonbillable), round2(g.value)]))

  return <div className="stack loose">
    <div className="report-range card card-pad">
      <Segmented size="sm" label="Date range" value={key} onChange={v => patch({ range: v === 'this_month' ? null : v, from: v === 'custom' ? start : null, to: v === 'custom' ? end : null })}
        options={(Object.keys(RANGE_LABEL) as RangeKey[]).map(k => ({ value: k, label: RANGE_LABEL[k] }))} />
      {key === 'custom'
        ? <div className="row wrap">
          <label className="small muted" htmlFor="rep-from">From</label><input id="rep-from" className="input sm" type="date" value={start} onChange={e => patch({ from: e.target.value })} style={{ width: 'auto' }} />
          <label className="small muted" htmlFor="rep-to">to</label><input id="rep-to" className="input sm" type="date" value={end} onChange={e => patch({ to: e.target.value })} style={{ width: 'auto' }} />
        </div>
        : <span className="small muted">{fmtDate(start, 'long')} – {fmtDate(end, 'long')}</span>}
    </div>

    <div className="stats">
      <div className="stat"><span className="label">Hours worked</span><span className="value">{fmtHours(data.hours)}</span><span className="sub">{fmtHours(data.billable)} billable · {fmtHours(data.hours - data.billable)} non-billable</span></div>
      <div className="stat"><span className="label">Fees recorded</span><span className="value">{fmtMoney(data.deposits + data.invoiced)}</span><span className="sub">{fmtMoney(data.deposits)} deposits + {fmtMoney(data.invoiced)} invoiced</span></div>
      <div className="stat ok"><span className="label">Money collected</span><span className="value">{fmtMoney(data.deposits + data.paid)}</span><span className="sub">Deposits + invoices paid in this range</span></div>
      <div className="stat"><span className="label">Earned per hour</span><span className="value">{fmtHourlyRate(data.rate)}</span><span className="sub">Fees recorded ÷ hours worked, before overhead and tax</span></div>
    </div>

    <div className="money-two">
      <section className="card">
        <div className="card-head"><h2>Hours by client</h2><Legend /></div>
        <div className="card-body"><HourBars groups={data.clients} /></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Estimate vs. actual</h2><span className="sub">By phase · all time</span></div>
        <div className="card-body">
          {data.phaseKinds.length === 0 ? <p className="small muted">Add hour estimates to job phases to compare them with the hours you actually log.</p> :
            <ul className="est-list">{data.phaseKinds.map(k => { const max = Math.max(k.estimate, k.actual, 1); const over = k.estimate > 0 && k.actual > k.estimate; return <li key={k.kind}>
              <div className="row between"><span className="strong small">{PHASE_KIND_LABEL[k.kind]} <span className="tiny muted" style={{ fontWeight: 450 }}>· {k.phases} phase{k.phases === 1 ? '' : 's'}</span></span><span className={`small num ${over ? 'danger-text' : 'muted'}`}>{fmtHours(k.actual)} of {fmtHours(k.estimate)}{k.estimate > 0 ? ` · ${Math.round(k.actual / k.estimate * 100)}%` : ''}</span></div>
              <div className="est-track" aria-hidden="true">
                <span className="est-est" style={{ width: `${k.estimate / max * 100}%` }} />
                <span className={`est-act ${over ? 'over' : ''}`} style={{ width: `${k.actual / max * 100}%` }} />
              </div>
            </li> })}</ul>}
          {data.phaseKinds.length > 0 && <div className="report-legend"><span><i className="est-key est" />Estimated</span><span><i className="est-key act" />Actual</span><span><i className="est-key over" />Over estimate</span></div>}
        </div>
      </section>
    </div>

    <section className="card">
      <div className="card-head"><h2>Hours by job</h2><div className="row"><Legend />{data.jobs.length > 0 && <button className="btn sm" onClick={exportCsv}><Download size={14} /> CSV</button>}</div></div>
      {data.jobs.length === 0 ? <Empty compact icon={<BarChart3 size={20} />} title="No hours in this range">Pick a different date range, or log some time.</Empty> :
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Job</th><th className="hide-sm bar-col">Hours</th><th className="num">Billable</th><th className="num hide-sm">Non-billable</th><th className="num">Total</th><th className="num hide-sm">Value</th></tr></thead>
          <tbody>{data.jobs.map(g => <tr key={g.key}>
            <td><span className="strong">{g.name}</span>{g.sub && <div className="tiny muted">{g.sub}</div>}</td>
            <td className="hide-sm bar-col"><Bar g={g} max={data.jobs[0].billable + data.jobs[0].nonbillable} /></td>
            <td className="num">{fmtHours(g.billable)}</td>
            <td className="num hide-sm">{g.nonbillable ? fmtHours(g.nonbillable) : <span className="muted">—</span>}</td>
            <td className="num strong">{fmtHours(g.billable + g.nonbillable)}</td>
            <td className="num hide-sm">{fmtMoney(g.value)}</td>
          </tr>)}</tbody>
          <tfoot><tr><td>Total</td><td className="hide-sm" /><td className="num">{fmtHours(data.billable)}</td><td className="num hide-sm">{fmtHours(data.hours - data.billable)}</td><td className="num">{fmtHours(data.hours)}</td><td className="num hide-sm">{fmtMoney(sum(data.jobs.map(g => g.value)))}</td></tr></tfoot>
        </table></div>}
    </section>
  </div>
}

function Legend() {
  return <span className="report-legend hide-sm"><span><i className="bar-key bill" />Billable</span><span><i className="bar-key non" />Non-billable</span></span>
}

function Bar({ g, max }: { g: HourGroup; max: number }) {
  const m = Math.max(max, 0.01)
  return <div className="hbar" aria-hidden="true">
    <span className="hbar-bill" style={{ width: `${g.billable / m * 100}%` }} />
    <span className="hbar-non" style={{ width: `${g.nonbillable / m * 100}%` }} />
  </div>
}

function HourBars({ groups }: { groups: HourGroup[] }) {
  if (!groups.length) return <p className="small muted">No hours logged in this range.</p>
  const max = groups[0].billable + groups[0].nonbillable
  return <ul className="hbar-list">{groups.slice(0, 10).map(g => <li key={g.key}>
    <div className="row between"><span className="small strong truncate">{g.name}</span><span className="small num"><strong>{fmtHours(g.billable + g.nonbillable)}</strong><span className="muted"> · {fmtMoney(g.value)}</span></span></div>
    <Bar g={g} max={max} />
  </li>)}</ul>
}

const round2 = (n: number) => Math.round(n * 100) / 100
