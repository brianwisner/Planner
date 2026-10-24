// A printable invoice. Use "Print / Save as PDF" to make a PDF to email.
// The recorded invoice amount is what's owed; the lines show the work behind it.
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Mail, Pencil, Printer } from 'lucide-react'
import { useData } from '../lib/store'
import { EMAIL_TARGET, useEmailLink } from '../lib/email'
import { useEditors } from '../components/editors'
import { Empty } from '../components/ui'
import { letterheadLines } from '../components/Letterhead'
import { entryAmount, entryRate, itemAmount } from '../lib/calc'
import { phaseLabel } from '../lib/phases'
import { fmtDate, fmtHours, sum, todayISO } from '../lib/utils'
import './invoice.css'

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function InvoiceView() {
  const { id = '' } = useParams()
  const store = useData()
  const edit = useEditors()
  const emailLink = useEmailLink()
  const invoice = store.invoices.find(i => i.id === id)
  const job = store.jobs.find(j => j.id === invoice?.job_id)
  const client = store.clients.find(c => c.id === job?.client_id)

  const lines = useMemo(() => {
    if (!invoice) return null
    const hours = store.timeEntries.filter(e => e.invoice_id === invoice.id && e.hours != null)
      .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
    const charges = store.items.filter(i => i.invoice_id === invoice.id).sort((a, b) => a.date.localeCompare(b.date))
    // Group hours by phase, in the job's phase order.
    const groups = new Map<string, { label: string; order: number; rows: typeof hours }>()
    for (const e of hours) {
      const p = store.phases.find(x => x.id === e.phase_id)
      const key = p?.id ?? 'general'
      const g = groups.get(key) ?? { label: p ? phaseLabel(p) : 'General', order: p?.sort_order ?? 99, rows: [] }
      g.rows.push(e)
      groups.set(key, g)
    }
    const hoursTotal = sum(hours.map(e => entryAmount(store, e)))
    const chargesTotal = sum(charges.map(itemAmount))
    const credit = sum([...hours.map(e => e.deposit_applied ?? 0), ...charges.map(i => i.deposit_applied ?? 0)])
    return {
      groups: [...groups.values()].sort((a, b) => a.order - b.order), charges, count: hours.length + charges.length,
      hoursQty: sum(hours.map(e => e.hours)), subtotal: hoursTotal + chargesTotal, credit,
    }
  }, [store, invoice])

  if (!invoice || !lines) return <div className="card" style={{ marginTop: 20 }}><Empty title="Invoice not found" action={<Link className="btn" to="/money?tab=invoices">All invoices</Link>}>It may have been deleted.</Empty></div>

  const net = lines.subtotal - lines.credit
  const adjustment = lines.count ? Math.round((invoice.amount - net) * 100) / 100 : 0
  const paid = Boolean(invoice.paid_date)
  const owner = store.me
  const age = Math.max(0, Math.round((Date.parse(todayISO()) - Date.parse(invoice.issued_date)) / 86400000))
  const subject = `Invoice ${invoice.number}${job ? ` — ${job.name}` : ''}`
  const body = `Hi${client?.contact_name ? ` ${client.contact_name.split(' ')[0]}` : ''},\n\nPlease find attached invoice ${invoice.number}${job ? ` for ${job.name}` : ''}, for ${money(invoice.amount)}.\n\nThank you,\n${owner?.full_name || store.settings.company_name}\n${store.settings.company_name}`
  const emailHref = emailLink(client?.email ?? '', subject, body)

  return <div className="invoice-page">
    <div className="invoice-toolbar no-print">
      <Link className="btn ghost back-link" to={job ? `/jobs/${job.id}?tab=billing` : '/money?tab=invoices'} title={job ? `Back to ${job.name}` : 'All invoices'}><ArrowLeft size={16} /><span className="truncate">{job ? job.name : 'Invoices'}</span></Link>
      <div className="grow" />
      {paid ? <span className="badge ok lg hide-sm"><CheckCircle2 size={14} /> Paid {fmtDate(invoice.paid_date)}</span>
        : invoice.amount <= 0.005 ? <span className="badge lg hide-sm">No payment due</span> : <span className={`badge lg hide-sm ${age > 30 ? 'danger' : 'warn'}`}>Unpaid · {age} day{age === 1 ? '' : 's'}</span>}
      <a className="btn" href={emailHref} {...EMAIL_TARGET} aria-label="Email client"><Mail size={16} /> <span className="hide-sm">Email client</span></a>
      {job && <button className="btn" onClick={() => edit.invoice(job.id, invoice)} aria-label="Edit invoice"><Pencil size={15} /> <span className="hide-sm">Edit</span></button>}
      {!paid && <button className="btn" onClick={() => edit.paid(invoice)}><CheckCircle2 size={16} /> <span className="hide-sm">Mark paid</span><span className="show-sm">Paid</span></button>}
      <button className="btn primary" onClick={() => window.print()}><Printer size={16} /> <span className="hide-sm">Print / Save as PDF</span><span className="show-sm">PDF</span></button>
    </div>
    <p className="invoice-tip no-print hide-sm">Tip: choose “Save as PDF” in the print window, then attach it to the Gmail message.</p>

    <article className="invoice-doc" aria-label={`Invoice ${invoice.number}`}>
      <header className="inv-head">
        <div>
          <div className="inv-company">{store.settings.company_name}</div>
          {owner?.full_name && <div className="inv-muted">{owner.full_name}</div>}
          {letterheadLines(store.settings.letterhead).map((line, i) => <div key={i} className="inv-muted">{line}</div>)}
          {store.settings.business_email?.trim() && <div className="inv-muted">{store.settings.business_email.trim()}</div>}
        </div>
        <div className="inv-title-block">
          <div className="inv-title">INVOICE</div>
          <dl className="inv-facts">
            <dt>Invoice #</dt><dd>{invoice.number}</dd>
            <dt>Date</dt><dd>{fmtDate(invoice.issued_date, 'long')}</dd>
            <dt>Status</dt><dd>{paid ? `Paid ${fmtDate(invoice.paid_date, 'long')}` : 'Due on receipt'}</dd>
          </dl>
        </div>
      </header>

      <section className="inv-parties">
        <div>
          <div className="inv-label">Bill to</div>
          <div className="inv-strong">{client?.name ?? '—'}</div>
          {client?.contact_name && client.contact_name !== client.name && <div>{client.contact_name}</div>}
          {client?.address && <div>{client.address}</div>}
          {client?.email && <div className="inv-muted">{client.email}</div>}
        </div>
        {job && <div>
          <div className="inv-label">Project</div>
          <div className="inv-strong">{job.name}</div>
          {job.job_number && <div>Job #{job.job_number}</div>}
          {job.address && <div>{job.address}</div>}
        </div>}
      </section>

      <table className="inv-lines">
        <thead><tr><th className="inv-date">Date</th><th>Description</th><th className="num">Qty</th><th className="num inv-rate">Rate</th><th className="num">Amount</th></tr></thead>
        {lines.count === 0
          ? <tbody><tr>
            <td className="inv-date">{fmtDate(invoice.issued_date)}</td>
            <td><div className="inv-strong">Professional services{job ? ` — ${job.name}` : ''}</div>{invoice.notes && <div className="inv-muted">{invoice.notes}</div>}</td>
            <td className="num">1</td><td className="num inv-rate">{money(invoice.amount)}</td><td className="num">{money(invoice.amount)}</td>
          </tr></tbody>
          : <>
            {lines.groups.map(g => <tbody key={g.label}>
              <tr className="inv-group"><td colSpan={5}>{g.label}</td></tr>
              {g.rows.map(e => <tr key={e.id}>
                <td className="inv-date">{fmtDate(e.date)}</td>
                <td>{e.notes || 'Engineering services'}</td>
                <td className="num">{fmtHours(e.hours)}</td>
                <td className="num inv-rate">{money(entryRate(store, e))}/h</td>
                <td className="num">{money(entryAmount(store, e))}</td>
              </tr>)}
            </tbody>)}
            {lines.charges.length > 0 && <tbody>
              <tr className="inv-group"><td colSpan={5}>Expenses and fees</td></tr>
              {lines.charges.map(i => <tr key={i.id}>
                <td className="inv-date">{fmtDate(i.date)}</td>
                <td>{i.description || i.category}{i.description && <span className="inv-muted"> · {i.category}</span>}</td>
                <td className="num">{i.quantity}</td>
                <td className="num inv-rate">{money(i.unit_price)}</td>
                <td className="num">{money(itemAmount(i))}</td>
              </tr>)}
            </tbody>}
          </>}
      </table>

      <div className="inv-summary">
      {paid ? <div className="inv-stamp" aria-hidden="true">PAID</div> : <span />}
      <section className="inv-totals">
        {lines.count > 0 && <>
          <div className="inv-total-row"><span>Subtotal{lines.hoursQty ? ` (${fmtHours(lines.hoursQty)})` : ''}</span><span>{money(lines.subtotal)}</span></div>
          {lines.credit > 0.005 && <div className="inv-total-row"><span>Less retainer / deposit applied</span><span>−{money(lines.credit)}</span></div>}
          {Math.abs(adjustment) >= 0.01 && <div className="inv-total-row"><span>{adjustment < 0 ? 'Discount / adjustment' : 'Adjustment'}</span><span>{adjustment < 0 ? `−${money(-adjustment)}` : money(adjustment)}</span></div>}
        </>}
        <div className="inv-total-row grand"><span>{paid ? 'Invoice total' : 'Amount due'}</span><span>{money(invoice.amount)}</span></div>
        {paid && <div className="inv-total-row paid"><span>Paid {fmtDate(invoice.paid_date, 'long')}</span><span>Balance {money(0)}</span></div>}
      </section>
      </div>

      {(invoice.notes && lines.count > 0) && <section className="inv-notes"><div className="inv-label">Notes</div><p>{invoice.notes}</p></section>}
      <footer className="inv-foot">Thank you for your business. Please reference invoice {invoice.number} with your payment.</footer>
    </article>
  </div>
}
