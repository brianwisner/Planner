// One client: their jobs, contact details, money across all jobs, and invoices.
import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Briefcase, ChevronRight, Mail, MapPin, Pencil, Phone, Plus, Receipt } from 'lucide-react'
import { useData } from '../lib/store'
import { useEditors } from '../components/editors'
import { Avatar, DueText, Empty, StageChip } from '../components/ui'
import { summarizeJob, type JobSummary } from '../lib/views'
import { JOB_STATUS_LABEL } from '../lib/types'
import { fmtDate, fmtHourlyRate, fmtHours, fmtMoney, sum, todayISO } from '../lib/utils'
import './clients.css'

const PALETTE = ['#2f5bea', '#0b8a7e', '#7a3fe4', '#d97a06', '#cf2f7d', '#12813f', '#e35a12', '#0e7490']
const avatarName = (name: string) => name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || name
function avatarColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function ClientPage() {
  const { id = '' } = useParams()
  const store = useData()
  const edit = useEditors()
  const navigate = useNavigate()
  const client = store.clients.find(c => c.id === id)

  const rows = useMemo<JobSummary[]>(() => {
    if (!client) return []
    const isOpen = (s: string) => s === 'active' || s === 'on_hold'
    return store.jobs.filter(j => j.client_id === client.id)
      .sort((a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)) || (isOpen(a.status) ? a.priority - b.priority : (b.due_date ?? b.created_at).localeCompare(a.due_date ?? a.created_at)))
      .map(j => summarizeJob(store, j))
  }, [store, client])

  if (!client) return <div className="card" style={{ marginTop: 20 }}><Empty title="Client not found" action={<Link className="btn" to="/clients">Back to clients</Link>}>They may have been deleted.</Empty></div>

  const counted = rows.filter(r => r.job.status !== 'archived')
  const money = {
    work: sum(counted.map(r => r.money.workValue)),
    deposits: sum(counted.map(r => r.money.deposits)),
    invoiced: sum(counted.map(r => r.money.invoiced)),
    awaiting: sum(counted.map(r => r.money.outstanding)),
    toBill: sum(counted.map(r => r.money.unbilledAmount)),
    fees: sum(counted.map(r => r.money.feeRevenue)),
    hours: sum(counted.map(r => r.money.loggedHours)),
  }
  const rate = money.hours > 0 ? money.fees / money.hours : null
  const jobIds = new Set(rows.map(r => r.job.id))
  const invoices = store.invoices.filter(i => jobIds.has(i.job_id)).sort((a, b) => b.issued_date.localeCompare(a.issued_date))
  const openCount = rows.filter(r => r.job.status === 'active' || r.job.status === 'on_hold').length
  const today = todayISO()

  return <div className="client-page">
    <div className="crumbs"><Link to="/clients">Clients</Link><ChevronRight size={14} /><span>{client.name}</span></div>
    <div className="page-head">
      <div className="titles row" style={{ gap: 14 }}>
        <Avatar name={avatarName(client.name)} color={avatarColor(client.name)} size="lg" />
        <div style={{ minWidth: 0 }}>
          <h1>{client.name}</h1>
          <p className="lede">{[client.contact_name, `${openCount} open job${openCount === 1 ? '' : 's'}`, rows.length > openCount ? `${rows.length - openCount} past` : null].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="actions">
        {client.phone && <a className="btn" href={`tel:${client.phone}`}><Phone size={15} /> Call</a>}
        {client.email && <a className="btn" href={`mailto:${client.email}`}><Mail size={15} /> Email</a>}
        <button className="btn" onClick={() => edit.client(client)}><Pencil size={15} /> Edit</button>
        <button className="btn primary" onClick={() => edit.job(undefined, { client_id: client.id })}><Plus size={16} /> New job</button>
      </div>
    </div>

    <div className="client-layout">
      <section className="card">
        <div className="card-head"><h2>Jobs <span className="count">{rows.length}</span></h2>{rows.length > openCount && <span className="sub">open first</span>}</div>
        {rows.length === 0
          ? <Empty compact icon={<Briefcase size={20} />} title="No jobs yet" action={<button className="btn sm soft" onClick={() => edit.job(undefined, { client_id: client.id })}><Plus size={14} /> Start a job for {client.name}</button>}>Jobs you create for this client appear here.</Empty>
          : <ul className="list">{rows.map(r => {
            const open = r.job.status === 'active' || r.job.status === 'on_hold'
            return <li key={r.job.id} className="list-row link client-job" onClick={() => navigate(`/jobs/${r.job.id}`)}>
              <div className="grow" style={{ minWidth: 0 }}>
                <Link to={`/jobs/${r.job.id}`} className="title" onClick={e => e.stopPropagation()}>{r.job.name}</Link>
                <div className="meta">{[r.job.job_number, r.nextTask && open ? `Next: ${r.nextTask.title}` : null].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <span className="client-job-stage">{r.job.status === 'active' ? <StageChip stage={r.stage.stage} /> : r.job.status === 'on_hold' ? <StageChip stage={r.stage.stage} hold label="On hold" /> : <span className={`badge ${r.job.status === 'complete' ? 'ok' : r.job.status === 'cancelled' ? 'danger' : ''}`}>{JOB_STATUS_LABEL[r.job.status]}</span>}</span>
              <span className="hide-sm client-job-due">{open && r.nextDeadline ? <DueText date={r.nextDeadline.date} /> : <span className="tiny muted">—</span>}</span>
              <span className="hide-sm tiny muted num client-job-hours">{fmtHours(r.hours)}{r.estimate > 0 ? ` / ${fmtHours(r.estimate)}` : ''}</span>
              <span className="num client-job-bill">{r.money.unbilledAmount > 0.5 ? <span className="ok-text strong small">{fmtMoney(r.money.unbilledAmount)}</span> : <span className="muted small">—</span>}</span>
            </li>
          })}</ul>}
      </section>

      <div className="stack loose">
        <section className="card">
          <div className="card-head"><h2>Contact</h2><button className="btn ghost xs" onClick={() => edit.client(client)}><Pencil size={13} /> Edit</button></div>
          <div className="card-body contact-list">
            {client.contact_name && <div className="contact-line"><span className="muted small">Contact</span><span>{client.contact_name}</span></div>}
            {client.phone && <div className="contact-line"><span className="muted small">Phone</span><a href={`tel:${client.phone}`}>{client.phone}</a></div>}
            {client.email && <div className="contact-line"><span className="muted small">Email</span><a href={`mailto:${client.email}`} className="truncate">{client.email}</a></div>}
            {client.address && <div className="contact-line"><span className="muted small">Address</span><a href={`https://maps.google.com/?q=${encodeURIComponent(client.address)}`} target="_blank" rel="noreferrer"><MapPin size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }} />{client.address}</a></div>}
            {!client.contact_name && !client.phone && !client.email && !client.address && <p className="small muted">No contact details yet. <button className="btn ghost xs" onClick={() => edit.client(client)}>Add them</button></p>}
            {client.notes && <div className="client-notes">{client.notes}</div>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Money</h2><span className="sub">all jobs</span></div>
          <div className="card-body glance">
            <div className="glance-row"><span>Work done</span><strong className="num">{fmtMoney(money.work)}</strong></div>
            <div className="glance-row"><span>Deposits received</span><strong className="num">{fmtMoney(money.deposits)}</strong></div>
            <div className="glance-row"><span>Invoiced</span><strong className="num">{fmtMoney(money.invoiced)}</strong></div>
            <div className="glance-row"><span>Awaiting payment</span><strong className={`num ${money.awaiting > 0.5 ? 'warn-text' : ''}`}>{fmtMoney(money.awaiting)}</strong></div>
            <div className="glance-row"><span>Ready to bill</span><strong className={`num ${money.toBill > 0.5 ? 'ok-text' : ''}`}>{fmtMoney(money.toBill)}</strong></div>
            <div className="glance-row"><span title="Deposits and invoices ÷ all hours worked for this client (before overhead and tax)">Earned per hour</span><strong className="num">{fmtHourlyRate(rate)}</strong></div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Invoices <span className="count">{invoices.length}</span></h2></div>
          {invoices.length === 0
            ? <Empty compact icon={<Receipt size={20} />} title="No invoices yet">Invoices for this client's jobs show up here.</Empty>
            : <ul className="list">{invoices.slice(0, 8).map(i => {
              const job = store.jobs.find(j => j.id === i.job_id)
              const age = Math.round((Date.parse(today) - Date.parse(i.issued_date)) / 86400000)
              return <li key={i.id} className="list-row link" onClick={() => navigate(`/money/invoice/${i.id}`)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <Link to={`/money/invoice/${i.id}`} className="title" onClick={e => e.stopPropagation()}>{i.number}</Link>
                  <div className="meta truncate">{fmtDate(i.issued_date)} · {job?.name}</div>
                </div>
                {i.paid_date ? <span className="badge ok">Paid</span> : <span className={`badge ${age > 30 ? 'danger' : 'warn'}`}>Unpaid · {age}d</span>}
                <strong className="num small">{fmtMoney(i.amount)}</strong>
              </li>
            })}</ul>}
          {invoices.length > 8 && <div className="card-foot"><Link className="small" to="/money?tab=invoices">All invoices</Link></div>}
        </section>
      </div>
    </div>
  </div>
}
