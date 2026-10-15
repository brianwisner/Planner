// Billing: per job, what has been invoiced, paid, is outstanding, and what
// hours are still unbilled. Select unbilled hours → "Create invoice" marks them billed.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { entryHours, jobBilling, rateFor } from '../lib/calc'
import type { Invoice } from '../lib/types'
import { downloadCSV, fmtDate, fmtHours, fmtMoney, sum } from '../lib/utils'
import { InvoiceModal } from '../components/editors'
import { Empty, Icon, Person } from '../components/ui'

export function Billing() {
  const store = useData()
  const { jobs, clients } = store
  const [params, setParams] = useSearchParams()
  const jobId = params.get('job')
  const [showClosed, setShowClosed] = useState(false)
  const rows = useMemo(() => jobs.filter(j => showClosed || j.status === 'active' || j.status === 'on_hold').map(j => jobBilling(store, j)), [jobs, store, showClosed])
  const totals = { unbilled: sum(rows.map(r => r.unbilledAmount)), outstanding: sum(rows.map(r => r.outstanding)), invoiced: sum(rows.map(r => r.invoiced)), paid: sum(rows.map(r => r.paid)) }

  if (jobId) return <JobBillingDetail jobId={jobId} onBack={() => setParams({})} />

  return (
    <div>
      <div className="page-header">
        <h1>Billing</h1>
        <div className="actions">
          <button className={`chip ${showClosed ? 'on' : ''}`} onClick={() => setShowClosed(!showClosed)}>Include complete jobs</button>
          <button className="btn" onClick={() => downloadCSV('billing.csv', ['Job #', 'Job', 'Client', 'Fee', 'Logged h', 'Billed h', 'Unbilled h', 'Unbilled $', 'Invoiced $', 'Paid $', 'Outstanding $'], rows.map(r => [r.job.job_number, r.job.name, clients.find(c => c.id === r.job.client_id)?.name, r.fee, Math.round(r.loggedHours * 100) / 100, Math.round(r.billedHours * 100) / 100, Math.round(r.unbilledHours * 100) / 100, Math.round(r.unbilledAmount), r.invoiced, r.paid, r.outstanding]))}><Icon name="download" size={16} /> CSV</button>
        </div>
      </div>
      <div className="stats mb">
        <div className="stat"><div className="label">Unbilled work</div><div className="value">{fmtMoney(totals.unbilled)}</div><div className="sub">{fmtHours(sum(rows.map(r => r.unbilledHours)))} at hourly rates</div></div>
        <div className="stat"><div className="label">Outstanding</div><div className={`value ${totals.outstanding > 0 ? 'warn-text' : ''}`}>{fmtMoney(totals.outstanding)}</div><div className="sub">invoiced, not yet paid</div></div>
        <div className="stat"><div className="label">Invoiced</div><div className="value">{fmtMoney(totals.invoiced)}</div><div className="sub">{fmtMoney(totals.paid)} paid</div></div>
      </div>
      <div className="card">
        <div className="table-wrap"><table>
          <thead><tr><th>Job</th><th className="hide-mobile">Client</th><th className="num hide-mobile">Fee</th><th className="num">Unbilled</th><th className="num hide-mobile">Invoiced</th><th className="num">Outstanding</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.job.id} className="clickable" onClick={() => setParams({ job: r.job.id })}>
                <td><div className="bold">{r.job.name}</div><div className="tiny muted">{r.job.job_number} · {fmtHours(r.loggedHours)} logged</div></td>
                <td className="hide-mobile">{clients.find(c => c.id === r.job.client_id)?.name}</td>
                <td className="num hide-mobile">{fmtMoney(r.fee)}</td>
                <td className="num">{r.unbilledHours > 0 ? <><b>{fmtMoney(r.unbilledAmount)}</b><div className="tiny muted">{fmtHours(r.unbilledHours)}</div></> : <span className="muted">–</span>}</td>
                <td className="num hide-mobile">{fmtMoney(r.invoiced)}{r.fee != null && r.fee > 0 && <div className="tiny muted">{Math.round(r.invoiced / r.fee * 100)}% of fee</div>}</td>
                <td className={`num ${r.outstanding > 0 ? 'warn-text bold' : ''}`}>{r.outstanding > 0 ? fmtMoney(r.outstanding) : <span className="muted">–</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6}><Empty>No jobs.</Empty></td></tr>}
          </tbody>
        </table></div>
      </div>
      <p className="small muted mt">Unbilled $ = unbilled hours × each person's hourly rate (Settings). Mark an invoice as paid to move it out of Outstanding.</p>
    </div>
  )
}

function JobBillingDetail({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const store = useData()
  const { jobs, clients, timeEntries, invoices, phases, profiles, settings, update } = store
  const job = jobs.find(j => j.id === jobId)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [invoiceModal, setInvoiceModal] = useState<{ invoice?: Invoice; entryIds?: string[] } | null>(null)
  if (!job) return <Empty>Job not found.</Empty>
  const b = jobBilling(store, job)
  const entries = timeEntries.filter(e => e.job_id === job.id && e.hours != null).sort((a, b) => a.date.localeCompare(b.date))
  const unbilled = entries.filter(e => !e.billed)
  const jobInv = invoices.filter(i => i.job_id === job.id)
  const rate = (uid: string) => rateFor(profiles.find(p => p.id === uid), settings.default_rate)
  const selAmount = sum(unbilled.filter(e => sel.has(e.id)).map(e => entryHours(e) * rate(e.user_id)))
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="small muted"><a href="#" onClick={e => { e.preventDefault(); onBack() }}>Billing</a> › <Link to={`/jobs/${job.id}`}>{job.name}</Link></div>
          <h1>{job.name}</h1>
          <div className="small muted">{clients.find(c => c.id === job.client_id)?.name} · fee {fmtMoney(job.fee)}</div>
        </div>
        <div className="actions"><button className="btn primary" onClick={() => setInvoiceModal({})}><Icon name="plus" size={16} /> Record invoice</button></div>
      </div>
      <div className="stats mb">
        <div className="stat"><div className="label">Unbilled</div><div className="value">{fmtMoney(b.unbilledAmount)}</div><div className="sub">{fmtHours(b.unbilledHours)}</div></div>
        <div className="stat"><div className="label">Invoiced</div><div className="value">{fmtMoney(b.invoiced)}</div><div className="sub">{fmtHours(b.billedHours)} billed</div></div>
        <div className="stat"><div className="label">Paid</div><div className="value ok-text">{fmtMoney(b.paid)}</div></div>
        <div className="stat"><div className="label">Outstanding</div><div className={`value ${b.outstanding > 0 ? 'warn-text' : ''}`}>{fmtMoney(b.outstanding)}</div></div>
      </div>

      <div className="card">
        <h2>Invoices</h2>
        {jobInv.length === 0 && <p className="small muted">None yet.</p>}
        {jobInv.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Issued</th><th>Status</th><th className="num">Amount</th><th className="num">Hours on it</th><th></th></tr></thead>
          <tbody>{jobInv.map(i => (
            <tr key={i.id} className="clickable" onClick={() => setInvoiceModal({ invoice: i })}>
              <td className="bold">{i.number}</td><td>{fmtDate(i.issued_date)}</td>
              <td>{i.paid_date ? <span className="badge complete">paid {fmtDate(i.paid_date)}</span> : <span className="badge soon">outstanding</span>}</td>
              <td className="num">{fmtMoney(i.amount)}</td>
              <td className="num">{fmtHours(sum(entries.filter(e => e.invoice_id === i.id).map(entryHours)))}</td>
              <td onClick={e => e.stopPropagation()}>{!i.paid_date && <button className="btn sm" onClick={() => update('invoices', i.id, { paid_date: new Date().toISOString().slice(0, 10) })}>Mark paid</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>}
      </div>

      <div className="card">
        <h2>Unbilled hours <span className="actions">
          <button className="btn sm" onClick={() => setSel(sel.size === unbilled.length ? new Set() : new Set(unbilled.map(e => e.id)))}>{sel.size === unbilled.length && unbilled.length ? 'Select none' : 'Select all'}</button>
          <button className="btn sm primary" disabled={sel.size === 0} onClick={() => setInvoiceModal({ entryIds: [...sel] })}>Invoice selected ({fmtMoney(selAmount)})</button>
        </span></h2>
        {unbilled.length === 0 && <p className="small muted">All hours on this job are billed.</p>}
        {unbilled.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th></th><th>Date</th><th>Who</th><th>Phase</th><th className="hide-mobile">Notes</th><th className="num">Hours</th><th className="num">Amount</th></tr></thead>
          <tbody>{unbilled.map(e => (
            <tr key={e.id} className="clickable" onClick={() => toggle(e.id)}>
              <td><input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={sel.has(e.id)} onChange={() => toggle(e.id)} onClick={ev => ev.stopPropagation()} /></td>
              <td className="nowrap">{fmtDate(e.date)}</td><td><Person userId={e.user_id} /></td>
              <td className="small">{phases.find(p => p.id === e.phase_id)?.name ?? 'General'}</td>
              <td className="hide-mobile small muted">{e.notes}</td>
              <td className="num">{fmtHours(e.hours)}</td><td className="num">{fmtMoney(entryHours(e) * rate(e.user_id))}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={5}>Total unbilled</td><td className="num">{fmtHours(b.unbilledHours)}</td><td className="num">{fmtMoney(b.unbilledAmount)}</td></tr></tfoot>
        </table></div>}
        <p className="small muted mt">Selecting hours and clicking "Invoice selected" records an invoice and marks those hours as billed. You can also mark hours billed one by one from the Time page by editing an entry.</p>
      </div>

      <div className="card">
        <h2>Billed hours</h2>
        {entries.filter(e => e.billed).length === 0 && <p className="small muted">None yet.</p>}
        {entries.filter(e => e.billed).length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Who</th><th>Phase</th><th>Invoice</th><th className="num">Hours</th><th></th></tr></thead>
          <tbody>{entries.filter(e => e.billed).map(e => (
            <tr key={e.id}><td className="nowrap">{fmtDate(e.date)}</td><td><Person userId={e.user_id} /></td><td className="small">{phases.find(p => p.id === e.phase_id)?.name ?? 'General'}</td><td>{invoices.find(i => i.id === e.invoice_id)?.number ?? '–'}</td><td className="num">{fmtHours(e.hours)}</td>
              <td><button className="btn sm ghost" onClick={() => update('time_entries', e.id, { billed: false, invoice_id: null })}>Unmark</button></td></tr>
          ))}</tbody>
        </table></div>}
      </div>
      {invoiceModal && <InvoiceModal invoice={invoiceModal.invoice} jobId={job.id} entryIds={invoiceModal.entryIds} onClose={() => { setInvoiceModal(null); setSel(new Set()) }} />}
    </div>
  )
}
