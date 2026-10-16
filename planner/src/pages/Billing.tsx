// Billing & job money.
//  Overview tabs:  Jobs (balance per job) · Deposits (all jobs) · Hours (paid / billed / not billed)
//  Job view (?job=<id>): balance, where the work stands, balance over time, deposits,
//  invoices, and every hour with its status. Select "Not billed" hours → record an invoice.
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { allHours, balanceHistory, depositUsage, entryHours, entryRate, HOUR_STATUS_LABEL, jobBilling, jobHours, type HourStatus } from '../lib/calc'
import type { Deposit, Invoice } from '../lib/types'
import { downloadCSV, fmtDate, fmtHours, fmtMoney, fmtSigned, sum } from '../lib/utils'
import { DepositModal, InvoiceModal, TimeModal } from '../components/editors'
import { BalanceChart, WorkStatusBar } from '../components/MoneyCharts'
import { Empty, Icon, Person } from '../components/ui'
import type { TimeEntry } from '../lib/types'

type Tab = 'jobs' | 'deposits' | 'hours'

export function Billing() {
  const [params, setParams] = useSearchParams()
  const jobId = params.get('job')
  const tab = (params.get('tab') as Tab) || 'jobs'
  const [newDeposit, setNewDeposit] = useState(false)
  if (jobId) return <JobMoney jobId={jobId} onBack={() => setParams({})} />
  return (
    <div>
      <div className="page-header">
        <h1>Billing</h1>
        <div className="btn-group">
          {(['jobs', 'deposits', 'hours'] as Tab[]).map(t => (
            <button key={t} className={`btn sm ${tab === t ? 'active' : ''}`} onClick={() => setParams({ tab: t })}>{t === 'jobs' ? 'Jobs' : t === 'deposits' ? 'Deposits' : 'Hours'}</button>
          ))}
        </div>
        <div className="actions"><button className="btn primary" onClick={() => setNewDeposit(true)}><Icon name="plus" size={16} /> Record deposit</button></div>
      </div>
      <Totals />
      {tab === 'jobs' && <JobsTab />}
      {tab === 'deposits' && <DepositsTab />}
      {tab === 'hours' && <HoursTab />}
      {newDeposit && <DepositModal onClose={() => setNewDeposit(false)} />}
    </div>
  )
}

function Totals() {
  const store = useData()
  const rows = useMemo(() => store.jobs.filter(j => j.status !== 'archived').map(j => jobBilling(store, j)), [store])
  return (
    <div className="stats mb">
      <div className="stat"><div className="label">Not billed yet</div><div className={`value ${sum(rows.map(r => r.unbilledAmount)) > 0 ? 'danger-text' : ''}`}>{fmtMoney(sum(rows.map(r => r.unbilledAmount)))}</div><div className="sub">{fmtHours(sum(rows.map(r => r.unbilledHours)))} of work nobody has paid for</div></div>
      <div className="stat"><div className="label">Waiting for payment</div><div className={`value ${sum(rows.map(r => r.outstanding)) > 0 ? 'warn-text' : ''}`}>{fmtMoney(sum(rows.map(r => r.outstanding)))}</div><div className="sub">invoices sent, not paid</div></div>
      <div className="stat"><div className="label">Deposits not used yet</div><div className="value">{fmtMoney(sum(rows.map(r => r.depositRemaining)))}</div><div className="sub">of {fmtMoney(sum(rows.map(r => r.deposits)))} received</div></div>
      <div className="stat"><div className="label">Collected</div><div className="value ok-text">{fmtMoney(sum(rows.map(r => r.collected)))}</div><div className="sub">deposits + paid invoices</div></div>
    </div>
  )
}

function JobsTab() {
  const store = useData()
  const { jobs, clients } = store
  const nav = useNavigate()
  const [showClosed, setShowClosed] = useState(false)
  const rows = useMemo(() => jobs
    .filter(j => showClosed ? j.status !== 'archived' : j.status === 'active' || j.status === 'on_hold')
    .map(j => jobBilling(store, j))
    .sort((a, b) => a.balance - b.balance), [jobs, store, showClosed])
  return (
    <div className="card">
      <div className="filters">
        <span className="small muted">Job balance = deposits + billed − value of hours worked. It drops as you log hours and goes back up when you take a deposit or send an invoice. Jobs most in the red are at the top.</span>
        <span className="grow" />
        <button className={`chip ${showClosed ? 'on' : ''}`} onClick={() => setShowClosed(!showClosed)}>Include complete jobs</button>
        <button className="btn sm" onClick={() => downloadCSV('job-balances.csv', ['Job #', 'Job', 'Client', 'Fee', 'Hours', 'Work done $', 'Deposits $', 'Deposit left $', 'Billed $', 'Paid $', 'Waiting $', 'Not billed $', 'Balance $'],
          rows.map(r => [r.job.job_number, r.job.name, clients.find(c => c.id === r.job.client_id)?.name, r.fee, round2(r.loggedHours), Math.round(r.workValue), r.deposits, Math.round(r.depositRemaining), r.invoiced, r.paid, r.outstanding, Math.round(r.unbilledAmount), Math.round(r.balance)]))}><Icon name="download" size={14} /> CSV</button>
      </div>
      {rows.length === 0 && <Empty>No jobs.</Empty>}
      {rows.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>Job</th><th className="num hide-mobile">Work done</th><th className="num hide-mobile">Deposits</th><th className="num hide-mobile">Billed</th><th className="num">Not billed</th><th className="num">Balance</th><th className="hide-mobile" style={{ width: '22%' }}>Where the work stands</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.job.id} className="clickable" onClick={() => nav(`/billing?job=${r.job.id}`)}>
              <td><div className="bold">{r.job.name}</div><div className="tiny muted">{r.job.job_number} · {clients.find(c => c.id === r.job.client_id)?.name}</div></td>
              <td className="num hide-mobile">{fmtMoney(r.workValue)}<div className="tiny muted">{fmtHours(r.loggedHours)}</div></td>
              <td className="num hide-mobile">{r.deposits > 0 ? <>{fmtMoney(r.deposits)}<div className="tiny muted">{fmtMoney(r.depositRemaining)} left</div></> : <span className="muted">–</span>}</td>
              <td className="num hide-mobile">{r.invoiced > 0 ? <>{fmtMoney(r.invoiced)}{r.outstanding > 0 && <div className="tiny warn-text">{fmtMoney(r.outstanding)} unpaid</div>}</> : <span className="muted">–</span>}</td>
              <td className="num">{r.unbilledAmount > 0.5 ? <b className="danger-text">{fmtMoney(r.unbilledAmount)}</b> : <span className="muted">–</span>}</td>
              <td className={`num bold ${r.balance < 0 ? 'money-neg' : 'money-pos'}`}>{fmtSigned(r.balance)}</td>
              <td className="hide-mobile"><WorkStatusBar b={r} compact /></td>
            </tr>
          ))}
        </tbody>
      </table></div>}
      <div className="wsb-legend small">
        <span className="wsb-key"><i style={{ background: '#0ca30c' }} />Paid</span>
        <span className="wsb-key"><i style={{ background: '#fab219' }} />Billed, waiting for payment</span>
        <span className="wsb-key"><i style={{ background: '#d03b3b' }} />Not billed yet</span>
        <span className="wsb-key"><i className="dashed" style={{ borderColor: '#0ca30c' }} />Deposit not used yet</span>
      </div>
    </div>
  )
}

function DepositsTab() {
  const store = useData()
  const { deposits, jobs, clients } = store
  const [editing, setEditing] = useState<Deposit | null>(null)
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const id of new Set(deposits.map(d => d.job_id))) for (const [k, v] of depositUsage(store, id)) m.set(k, v)
    return m
  }, [store, deposits])
  const rows = [...deposits].reverse()
  const job = (id: string) => jobs.find(j => j.id === id)
  return (
    <div className="card">
      <div className="filters">
        <span className="small muted">Each deposit pays for that job's hours as they're logged, oldest first. "Left" is what hasn't been worked against yet.</span>
        <span className="grow" />
        <button className="btn sm" onClick={() => downloadCSV('deposits.csv', ['Received', 'Job #', 'Job', 'Client', 'Amount $', 'Used $', 'Left $', 'How paid', 'Notes'],
          rows.map(d => { const j = job(d.job_id); const u = usage.get(d.id) ?? 0; return [d.received_date, j?.job_number, j?.name, clients.find(c => c.id === j?.client_id)?.name, d.amount, Math.round(u), Math.round(d.amount - u), d.method, d.notes] }))}><Icon name="download" size={14} /> CSV</button>
      </div>
      {rows.length === 0 && <Empty>No deposits yet. Click "Record deposit" when a client pays a retainer.</Empty>}
      {rows.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>Received</th><th>Job</th><th className="hide-mobile">How paid</th><th className="num">Amount</th><th className="num">Used</th><th className="num">Left</th><th className="hide-mobile" style={{ width: '18%' }}></th></tr></thead>
        <tbody>
          {rows.map(d => {
            const u = usage.get(d.id) ?? 0
            const j = job(d.job_id)
            return (
              <tr key={d.id} className="clickable" onClick={() => setEditing(d)}>
                <td className="nowrap">{fmtDate(d.received_date)}</td>
                <td><Link to={`/billing?job=${d.job_id}`} onClick={e => e.stopPropagation()} className="bold">{j?.name}</Link><div className="tiny muted">{clients.find(c => c.id === j?.client_id)?.name}{d.notes && ` · ${d.notes}`}</div></td>
                <td className="hide-mobile small">{d.method}</td>
                <td className="num">{fmtMoney(d.amount)}</td>
                <td className="num">{fmtMoney(u)}</td>
                <td className={`num bold ${d.amount - u > 0.5 ? 'money-pos' : 'muted'}`}>{fmtMoney(d.amount - u)}</td>
                <td className="hide-mobile"><div className="bar"><span style={{ width: `${d.amount ? Math.min(100, u / d.amount * 100) : 0}%`, background: '#0ca30c' }} /></div><span className="tiny muted">{d.amount ? Math.round(u / d.amount * 100) : 0}% used</span></td>
              </tr>
            )
          })}
        </tbody>
        <tfoot><tr><td colSpan={3}>Total</td><td className="num">{fmtMoney(sum(rows.map(d => d.amount)))}</td><td className="num">{fmtMoney(sum(rows.map(d => usage.get(d.id) ?? 0)))}</td><td className="num">{fmtMoney(sum(rows.map(d => d.amount - (usage.get(d.id) ?? 0))))}</td><td className="hide-mobile" /></tr></tfoot>
      </table></div>}
      {editing && <DepositModal deposit={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const FILTERS: { key: 'all' | 'unbilled' | 'billed' | 'paid'; label: string; match: (s: HourStatus) => boolean }[] = [
  { key: 'all', label: 'All hours', match: () => true },
  { key: 'unbilled', label: 'Not billed', match: s => s === 'unbilled' || s === 'partial' },
  { key: 'billed', label: 'Billed, not paid', match: s => s === 'billed' },
  { key: 'paid', label: 'Paid', match: s => s === 'paid' || s === 'deposit' || s === 'partial' },
]

function HoursTab() {
  const store = useData()
  const { jobs, phases, profiles, clients } = store
  const nav = useNavigate()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('unbilled')
  const [who, setWho] = useState('')
  const [jobId, setJobId] = useState('')
  const map = useMemo(() => allHours(store), [store])
  const base = [...map.values()].filter(h => (!who || h.entry.user_id === who) && (!jobId || h.entry.job_id === jobId))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date))
  const f = FILTERS.find(x => x.key === filter)!
  const rows = base.filter(h => f.match(h.status))
  const owed = (h: (typeof rows)[number]) => h.status === 'partial' ? h.amount - h.covered : h.amount
  const totalFor = (k: (typeof FILTERS)[number]['key']) => { const m = FILTERS.find(x => x.key === k)!; return sum(base.filter(h => m.match(h.status)).map(h => k === 'unbilled' ? owed(h) : h.status === 'partial' && k === 'paid' ? h.covered : h.amount)) }
  return (
    <div className="card">
      <div className="filters">
        {FILTERS.map(x => <button key={x.key} className={`chip ${filter === x.key ? 'on' : ''}`} onClick={() => setFilter(x.key)}>{x.label} · {fmtMoney(totalFor(x.key))}</button>)}
        <select value={jobId} onChange={e => setJobId(e.target.value)}><option value="">All jobs</option>{jobs.filter(j => j.status !== 'archived').map(j => <option key={j.id} value={j.id}>{j.name}</option>)}</select>
        <select value={who} onChange={e => setWho(e.target.value)}><option value="">Everyone</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
        <span className="grow" />
        <button className="btn sm" onClick={() => downloadCSV(`hours-${filter}.csv`, ['Date', 'Person', 'Client', 'Job #', 'Job', 'Phase', 'Hours', 'Rate', 'Amount $', 'Status', 'Paid by deposit $', 'Invoice', 'Notes'],
          rows.map(h => { const j = jobs.find(j => j.id === h.entry.job_id); return [h.entry.date, profiles.find(p => p.id === h.entry.user_id)?.full_name, clients.find(c => c.id === j?.client_id)?.name, j?.job_number, j?.name, phases.find(p => p.id === h.entry.phase_id)?.name ?? 'General', entryHours(h.entry), entryRate(store, h.entry), round2(h.amount), HOUR_STATUS_LABEL[h.status], round2(h.covered), store.invoices.find(i => i.id === h.entry.invoice_id)?.number ?? '', h.entry.notes] }))}><Icon name="download" size={14} /> CSV</button>
      </div>
      {rows.length === 0 && <Empty>No hours in this list.</Empty>}
      {rows.length > 0 && <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Who</th><th>Job</th><th className="num hide-mobile">Hours × rate</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {rows.slice(0, 400).map(h => {
            const j = jobs.find(j => j.id === h.entry.job_id)
            return (
              <tr key={h.entry.id} className="clickable" onClick={() => nav(`/billing?job=${h.entry.job_id}`)}>
                <td className="nowrap">{fmtDate(h.entry.date)}</td>
                <td><Person userId={h.entry.user_id} hideName /></td>
                <td>{j?.name}<div className="tiny muted">{phases.find(p => p.id === h.entry.phase_id)?.name ?? 'General'}{h.entry.notes && ` · ${h.entry.notes}`}</div></td>
                <td className="num hide-mobile nowrap">{fmtHours(h.entry.hours)} × ${entryRate(store, h.entry)}</td>
                <td className="num">{fmtMoney(h.amount)}</td>
                <td><StatusBadge h={h} /></td>
              </tr>
            )
          })}
        </tbody>
        <tfoot><tr><td colSpan={3}>{rows.length} entries{filter === 'unbilled' ? ' · amount not billed' : filter === 'paid' ? ' · amount paid' : ''}</td><td className="num hide-mobile">{fmtHours(sum(rows.map(h => entryHours(h.entry))))}</td><td className="num">{fmtMoney(totalFor(filter))}</td><td /></tr></tfoot>
      </table></div>}
    </div>
  )
}

export function StatusBadge({ h }: { h: { status: HourStatus; amount: number; covered: number; entry: TimeEntry } }) {
  const { invoices } = useData()
  const inv = invoices.find(i => i.id === h.entry.invoice_id)
  const label = h.status === 'partial' ? `${fmtMoney(h.amount - h.covered)} not billed` : HOUR_STATUS_LABEL[h.status]
  return (
    <span className={`badge h-${h.status}`} title={h.status === 'partial' ? `Deposit covers ${fmtMoney(h.covered)} of ${fmtMoney(h.amount)}` : undefined}>
      {label}{inv && (h.status === 'billed' || h.status === 'paid') ? ` · ${inv.number}` : ''}
    </span>
  )
}

function JobMoney({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const store = useData()
  const { jobs, clients, invoices, deposits, phases, update } = store
  const job = jobs.find(j => j.id === jobId)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [invoiceModal, setInvoiceModal] = useState<{ invoice?: Invoice; entryIds?: string[]; amount?: number } | null>(null)
  const [depositModal, setDepositModal] = useState<{ deposit?: Deposit } | null>(null)
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const b = useMemo(() => job ? jobBilling(store, job) : null, [store, job])
  const hours = useMemo(() => jobHours(store, jobId), [store, jobId])
  const history = useMemo(() => balanceHistory(store, jobId), [store, jobId])
  const usage = useMemo(() => depositUsage(store, jobId), [store, jobId])
  if (!job || !b) return <Empty>Job not found.</Empty>
  const jobDeposits = deposits.filter(d => d.job_id === job.id)
  const jobInv = invoices.filter(i => i.job_id === job.id)
  const f = FILTERS.find(x => x.key === filter)!
  const list = [...hours].reverse().filter(h => f.match(h.status))
  const selectable = (s: HourStatus) => s === 'unbilled' || s === 'partial'
  const owedSel = sum(hours.filter(h => sel.has(h.entry.id)).map(h => h.amount - h.covered))
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const unbilledIds = hours.filter(h => selectable(h.status)).map(h => h.entry.id)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="small muted"><a href="#" onClick={e => { e.preventDefault(); onBack() }}>Billing</a> › <Link to={`/jobs/${job.id}`}>{job.name}</Link></div>
          <h1>{job.name}</h1>
          <div className="small muted">{clients.find(c => c.id === job.client_id)?.name}{job.fee ? ` · fee ${fmtMoney(job.fee)} · work done is ${Math.round(b.workValue / job.fee * 100)}% of fee` : ''}</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setDepositModal({})}><Icon name="plus" size={16} /> Record deposit</button>
          <button className="btn primary" onClick={() => setInvoiceModal({ entryIds: unbilledIds, amount: b.unbilledAmount })} disabled={unbilledIds.length === 0} title="Invoice all hours that aren't billed yet">Bill unbilled hours</button>
        </div>
      </div>

      <div className="stats mb">
        <div className="stat">
          <div className="label">Job balance</div>
          <div className={`value ${b.balance < 0 ? 'money-neg' : 'money-pos'}`}>{fmtSigned(b.balance)}</div>
          <div className="sub">{b.balance < 0 ? 'Work done beyond deposits + billing' : 'Ahead: deposits + billing exceed work done'}</div>
        </div>
        <div className="stat"><div className="label">Work done</div><div className="value">{fmtMoney(b.workValue)}</div><div className="sub">{fmtHours(b.loggedHours)} at billing rates</div></div>
        <div className="stat"><div className="label">Deposits</div><div className="value">{fmtMoney(b.deposits)}</div><div className="sub">{fmtMoney(b.depositRemaining)} not used yet</div></div>
        <div className="stat"><div className="label">Billed</div><div className="value">{fmtMoney(b.invoiced)}</div><div className="sub">{fmtMoney(b.paid)} paid{b.outstanding > 0 ? <> · <span className="warn-text">{fmtMoney(b.outstanding)} waiting</span></> : ''}</div></div>
      </div>

      <div className="card">
        <h2>Where the work stands</h2>
        <p className="small muted">Every dollar of time logged on this job, by whether it's been paid for.</p>
        <WorkStatusBar b={b} />
      </div>

      <div className="card">
        <h2>Job balance over time</h2>
        <p className="small muted">Steps down as hours are logged, jumps up when a deposit comes in or an invoice goes out. Hover or tap for details.</p>
        <BalanceChart points={history} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Deposits <span className="actions"><button className="btn sm" onClick={() => setDepositModal({})}>+ Deposit</button></span></h2>
          {jobDeposits.length === 0 && <p className="small muted">No deposits on this job.</p>}
          {jobDeposits.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>Received</th><th className="num">Amount</th><th className="num">Left</th></tr></thead>
            <tbody>{jobDeposits.map(d => (
              <tr key={d.id} className="clickable" onClick={() => setDepositModal({ deposit: d })}>
                <td className="nowrap">{fmtDate(d.received_date)}<div className="tiny muted">{[d.method, d.notes].filter(Boolean).join(' · ')}</div></td>
                <td className="num">{fmtMoney(d.amount)}</td>
                <td className="num">{fmtMoney(d.amount - (usage.get(d.id) ?? 0))}</td>
              </tr>
            ))}</tbody>
          </table></div>}
        </div>
        <div className="card">
          <h2>Invoices <span className="actions"><button className="btn sm" onClick={() => setInvoiceModal({})}>+ Invoice</button></span></h2>
          {jobInv.length === 0 && <p className="small muted">None yet.</p>}
          {jobInv.length > 0 && <div className="table-wrap"><table>
            <thead><tr><th>#</th><th>Status</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>{jobInv.map(i => (
              <tr key={i.id} className="clickable" onClick={() => setInvoiceModal({ invoice: i })}>
                <td className="bold">{i.number}<div className="tiny muted">{fmtDate(i.issued_date)} · {fmtHours(sum(hours.filter(h => h.entry.invoice_id === i.id).map(h => entryHours(h.entry))))}</div></td>
                <td>{i.paid_date ? <span className="badge complete">paid {fmtDate(i.paid_date)}</span> : <span className="badge soon">waiting</span>}</td>
                <td className="num">{fmtMoney(i.amount)}</td>
                <td onClick={e => e.stopPropagation()}>{!i.paid_date && <button className="btn sm" onClick={() => update('invoices', i.id, { paid_date: new Date().toISOString().slice(0, 10) })}>Mark paid</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>}
        </div>
      </div>

      <div className="card">
        <h2>Hours <span className="actions">
          <button className="btn sm primary" disabled={sel.size === 0} onClick={() => setInvoiceModal({ entryIds: [...sel], amount: owedSel })}>Invoice selected ({fmtMoney(owedSel)})</button>
        </span></h2>
        <div className="filters">
          {FILTERS.map(x => <button key={x.key} className={`chip ${filter === x.key ? 'on' : ''}`} onClick={() => setFilter(x.key)}>{x.label}</button>)}
          {unbilledIds.length > 0 && <button className="btn sm ghost" onClick={() => setSel(sel.size ? new Set() : new Set(unbilledIds))}>{sel.size ? 'Clear selection' : 'Select all not billed'}</button>}
        </div>
        {list.length === 0 && <p className="small muted">No hours in this list.</p>}
        {list.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th></th><th>Date</th><th className="hide-mobile">Who</th><th className="hide-mobile">Phase</th><th className="num hide-mobile">Hours × rate</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.map(h => (
            <tr key={h.entry.id} className={selectable(h.status) ? 'clickable' : ''} onClick={() => selectable(h.status) && toggle(h.entry.id)}>
              <td>{selectable(h.status) && <input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={sel.has(h.entry.id)} onChange={() => toggle(h.entry.id)} onClick={e => e.stopPropagation()} />}</td>
              <td className="nowrap">{fmtDate(h.entry.date)}</td>
              <td className="hide-mobile"><Person userId={h.entry.user_id} hideName /></td>
              <td className="small hide-mobile">{phases.find(p => p.id === h.entry.phase_id)?.name ?? 'General'}{h.entry.notes && <div className="tiny muted">{h.entry.notes}</div>}</td>
              <td className="num hide-mobile nowrap">{fmtHours(h.entry.hours)} × ${entryRate(store, h.entry)}</td>
              <td className="num">{fmtMoney(h.amount)}</td>
              <td><StatusBadge h={h} /></td>
              <td onClick={e => e.stopPropagation()} className="nowrap">
                <button className="btn sm ghost" onClick={() => setEditEntry(h.entry)} title="Edit hours or rate"><Icon name="edit" size={14} /></button>
                {(h.status === 'billed' || h.status === 'paid') && <button className="btn sm ghost" title="Take these hours off their invoice" onClick={() => update('time_entries', h.entry.id, { billed: false, invoice_id: null })}>Unbill</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>}
        <p className="small muted mt">Tick hours that aren't billed and click "Invoice selected" to record an invoice; those hours then show as "Billed, not paid" until you mark the invoice paid. Deposits pay for hours automatically, oldest first.</p>
      </div>

      {invoiceModal && <InvoiceModal invoice={invoiceModal.invoice} jobId={job.id} entryIds={invoiceModal.entryIds} defaultAmount={invoiceModal.amount} onClose={() => { setInvoiceModal(null); setSel(new Set()) }} />}
      {depositModal && <DepositModal deposit={depositModal.deposit} jobId={job.id} onClose={() => setDepositModal(null)} />}
      {editEntry && <TimeModal entry={editEntry} onClose={() => setEditEntry(null)} />}
    </div>
  )
}

function round2(n: number) { return Math.round(n * 100) / 100 }
