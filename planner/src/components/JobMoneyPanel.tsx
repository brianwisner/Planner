// Billing for one job: where the money stands, work to invoice, invoices and deposits.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileText, Plus, Printer, Receipt, Undo2, Wallet } from 'lucide-react'
import { useData } from '../lib/store'
import { balanceHistory, depositUsage, jobBilling, jobCharges, HOUR_STATUS_LABEL, type HourStatus } from '../lib/calc'
import { phaseLabel } from '../lib/phases'
import { fmtDate, fmtHourlyRate, fmtHours, fmtMoney, fmtSigned, todayISO } from '../lib/utils'
import { useEditors } from './editors'
import { BalanceChart, WorkStatusBar } from './MoneyCharts'
import { Empty, useConfirm } from './ui'
import './job-money.css'

export function MoneyStatusBadge({ status }: { status: HourStatus }) {
  const tone: Record<HourStatus, string> = { deposit: 'ok', partial: 'warn', unbilled: 'danger', billed: 'warn', paid: 'ok', nonbillable: '' }
  return <span className={`badge ${tone[status]}`}>{HOUR_STATUS_LABEL[status]}</span>
}

export function JobMoneyPanel({ jobId }: { jobId: string }) {
  const store = useData()
  const edit = useEditors()
  const confirm = useConfirm()
  const job = store.jobs.find(j => j.id === jobId)!
  const b = useMemo(() => jobBilling(store, job), [store, job])
  const charges = useMemo(() => jobCharges(store, jobId), [store, jobId])
  const history = useMemo(() => balanceHistory(store, jobId), [store, jobId])
  const usage = useMemo(() => depositUsage(store, jobId), [store, jobId])
  const invoices = store.invoices.filter(i => i.job_id === jobId).sort((a, b) => b.issued_date.localeCompare(a.issued_date))
  const deposits = store.deposits.filter(d => d.job_id === jobId)
  const phaseName = (id: string | null) => { const p = store.phases.find(x => x.id === id); return p ? phaseLabel(p) : 'General' }
  const open = (s: HourStatus) => s === 'unbilled' || s === 'partial'
  const unbilled = [
    ...charges.hours.filter(h => open(h.status)).map(h => ({ key: `h:${h.entry.id}`, date: h.entry.date, title: h.entry.notes || phaseName(h.entry.phase_id), sub: `${fmtHours(h.entry.hours)} · ${phaseName(h.entry.phase_id)}`, due: h.amount - h.covered, covered: h.covered })),
    ...charges.items.filter(i => open(i.status)).map(i => ({ key: `i:${i.item.id}`, date: i.item.date, title: i.item.description || i.item.category, sub: i.item.category, due: i.amount - i.covered, covered: i.covered })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const chosen = selected ?? new Set(unbilled.map(u => u.key))
  const chosenTotal = unbilled.filter(u => chosen.has(u.key)).reduce((s, u) => s + u.due, 0)
  const billedWork = [
    ...charges.hours.filter(h => h.status === 'billed' || h.status === 'paid').map(h => ({ table: 'time_entries' as const, id: h.entry.id, date: h.entry.date, title: h.entry.notes || phaseName(h.entry.phase_id), sub: fmtHours(h.entry.hours), amount: h.amount, status: h.status, invoice: store.invoices.find(i => i.id === h.entry.invoice_id) })),
    ...charges.items.filter(i => i.status === 'billed' || i.status === 'paid').map(i => ({ table: 'job_items' as const, id: i.item.id, date: i.item.date, title: i.item.description || i.item.category, sub: i.item.category, amount: i.amount, status: i.status, invoice: store.invoices.find(x => x.id === i.item.invoice_id) })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const [showBilled, setShowBilled] = useState(false)
  const today = todayISO()

  function invoiceChosen() {
    const keys = [...chosen]
    edit.invoice(jobId, undefined, { entryIds: keys.filter(k => k.startsWith('h:')).map(k => k.slice(2)), itemIds: keys.filter(k => k.startsWith('i:')).map(k => k.slice(2)) })
  }
  async function unbill(w: typeof billedWork[number]) {
    if (!await confirm({ title: 'Take this off its invoice?', body: `“${w.title}” goes back to not billed. The invoice amount itself doesn't change — edit the invoice if it should.`, confirmLabel: 'Unbill' })) return
    if (await store.update(w.table, w.id, { billed: false, invoice_id: null, deposit_applied: null })) store.toast('Work removed from its invoice')
  }

  return <div className="money-panel">
    <div className="stats money-stats">
      <div className="stat"><span className="label">Work done</span><span className="value">{fmtMoney(b.workValue)}</span><span className="sub">{fmtHours(b.loggedHours)}{b.itemsValue > 0 ? ` + ${fmtMoney(b.itemsValue)} charges` : ''}</span></div>
      <div className="stat"><span className="label">Deposits</span><span className="value">{fmtMoney(b.deposits)}</span><span className="sub">{fmtMoney(b.depositRemaining)} not used yet</span></div>
      <div className="stat"><span className="label">Invoiced</span><span className="value">{fmtMoney(b.invoiced)}</span><span className="sub">{fmtMoney(b.outstanding)} awaiting payment</span></div>
      <div className={`stat ${b.balance < -0.5 ? 'danger' : b.balance > 0.5 ? 'ok' : ''}`}><span className="label" title="Deposits + invoices − work done">Balance</span><span className="value">{fmtSigned(b.balance)}</span><span className="sub">{fmtHourlyRate(b.effectiveHourlyRate)} earned per hour</span></div>
    </div>

    <div className="money-grid">
      <section className="card">
        <div className="card-head"><h2>Where the money stands</h2></div>
        <div className="card-body stack loose">
          <WorkStatusBar b={b} />
          <BalanceChart points={history} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Ready to invoice <span className="sub">{fmtMoney(b.unbilledAmount)}</span></h2>
          {unbilled.length > 0 && <button className="btn sm primary" disabled={!chosen.size} onClick={invoiceChosen}><Receipt size={15} /> Invoice {chosen.size === unbilled.length ? 'all' : `${chosen.size}`} · {fmtMoney(chosenTotal)}</button>}
        </div>
        {unbilled.length === 0 ? <Empty compact icon={<CheckCircle2 size={20} />} title="Nothing waiting to be billed">{b.depositRemaining > 0.5 ? `${fmtMoney(b.depositRemaining)} of deposits is still available for future work.` : 'New hours and charges will show up here.'}</Empty> :
          <ul className="pick-list flat">{unbilled.map(u => <li key={u.key}><label className="pick-row">
            <input type="checkbox" checked={chosen.has(u.key)} onChange={() => { const n = new Set(chosen); if (n.has(u.key)) n.delete(u.key); else n.add(u.key); setSelected(n) }} />
            <span className="grow" style={{ minWidth: 0 }}><span className="strong truncate" style={{ display: 'block' }}>{u.title}</span><span className="tiny muted">{fmtDate(u.date)} · {u.sub}{u.covered > 0 ? ` · ${fmtMoney(u.covered)} paid by deposit` : ''}</span></span>
            <span className="num strong">{fmtMoney(u.due)}</span>
          </label></li>)}</ul>}
        <div className="card-foot">
          <div className="row"><button className="btn sm" onClick={() => edit.charge(undefined, jobId)}><FileText size={14} /> Add charge</button><button className="btn sm" onClick={() => edit.time(undefined, { job_id: jobId })}><Plus size={14} /> Log hours</button></div>
          <button className="btn ghost sm" onClick={() => edit.invoice(jobId, undefined, { entryIds: [], itemIds: [] })}>Fixed-fee invoice…</button>
        </div>
      </section>
    </div>

    <div className="money-grid">
      <section className="card">
        <div className="card-head"><h2>Invoices</h2><button className="btn sm" onClick={() => edit.invoice(jobId)}><Plus size={15} /> New invoice</button></div>
        {invoices.length === 0 ? <Empty compact icon={<Receipt size={20} />} title="No invoices yet" /> :
          <ul className="list">{invoices.map(i => { const age = Math.round((Date.parse(today) - Date.parse(i.issued_date)) / 86400000); return <li key={i.id} className="list-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <Link to={`/money/invoice/${i.id}`} className="title">{i.number}</Link>
              <div className="meta">Issued {fmtDate(i.issued_date)}{i.notes ? ` · ${i.notes}` : ''}</div>
            </div>
            {i.paid_date ? <span className="badge ok">Paid {fmtDate(i.paid_date)}</span> : i.amount <= 0.005 ? <span className="badge">No payment due</span> : <span className={`badge ${age > 30 ? 'danger' : 'warn'}`}>Unpaid · {age}d</span>}
            <strong className="num">{fmtMoney(i.amount)}</strong>
            <div className="row" style={{ gap: 4 }}>
              {!i.paid_date && i.amount > 0.005 && <button className="btn xs" onClick={() => edit.paid(i)}>Paid</button>}
              <Link className="btn ghost icon xs" to={`/money/invoice/${i.id}`} aria-label={`Print ${i.number}`}><Printer size={14} /></Link>
              <button className="btn ghost xs" onClick={() => edit.invoice(jobId, i)}>Edit</button>
            </div>
          </li> })}</ul>}
      </section>

      <section className="card">
        <div className="card-head"><h2>Deposits</h2><button className="btn sm" onClick={() => edit.deposit(undefined, jobId)}><Wallet size={15} /> Record deposit</button></div>
        {deposits.length === 0 ? <Empty compact icon={<Wallet size={20} />} title="No deposits">Record a retainer when the client pays up front. It pays for work automatically, oldest first.</Empty> :
          <ul className="list">{deposits.map(d => { const used = usage.get(d.id) ?? 0; return <li key={d.id} className="list-row link" onClick={() => edit.deposit(d)}>
            <div className="grow"><div className="title">{fmtMoney(d.amount)} <span className="small muted">· {d.method}</span></div><div className="meta">Received {fmtDate(d.received_date)}{d.notes ? ` · ${d.notes}` : ''}</div></div>
            <div style={{ width: 120 }}><div className="progress ok"><span style={{ width: `${d.amount ? Math.min(100, used / d.amount * 100) : 0}%` }} /></div><div className="tiny muted" style={{ marginTop: 4 }}>{fmtMoney(used)} used</div></div>
          </li> })}</ul>}
      </section>
    </div>

    {billedWork.length > 0 && <section className="card">
      <div className="card-head"><h2>Billed work <span className="sub">{billedWork.length} item{billedWork.length === 1 ? '' : 's'}</span></h2><button className="btn ghost sm" onClick={() => setShowBilled(s => !s)}>{showBilled ? 'Hide' : 'Show'}</button></div>
      {showBilled && <div className="table-wrap"><table className="table">
        <thead><tr><th>Date</th><th>Work</th><th>Invoice</th><th className="num">Amount</th><th>Status</th><th /></tr></thead>
        <tbody>{billedWork.map(w => <tr key={w.id}>
          <td className="nowrap">{fmtDate(w.date)}</td><td>{w.title}<div className="tiny muted">{w.sub}</div></td>
          <td>{w.invoice ? <Link to={`/money/invoice/${w.invoice.id}`}>{w.invoice.number}</Link> : '—'}</td>
          <td className="num">{fmtMoney(w.amount)}</td><td><MoneyStatusBadge status={w.status} /></td>
          <td className="right"><button className="btn ghost xs" onClick={() => void unbill(w)}><Undo2 size={13} /> Unbill</button></td>
        </tr>)}</tbody>
      </table></div>}
    </section>}
  </div>
}
