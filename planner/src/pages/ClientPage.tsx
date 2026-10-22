// One client: their jobs, contact details, money across all jobs, and invoices.
import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, Mail, MapPin, Pencil, Phone, Plus, Receipt } from 'lucide-react'
import { useData } from '../lib/store'
import { EMAIL_TARGET, useEmailLink } from '../lib/email'
import { useEditors } from '../components/editors'
import { Avatar, Empty } from '../components/ui'
import { summarizeJob, type JobSummary } from '../lib/views'
import { ClientJobList } from '../components/ClientJobList'
import { ClientNotes } from '../components/ClientNotes'
import { compareClientJobs } from '../lib/clientJobs'
import { JOB_STATUS_LABEL } from '../lib/types'
import { fmtDate, fmtHourlyRate, fmtMoney, sum, todayISO } from '../lib/utils'
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
  const emailLink = useEmailLink()
  const edit = useEditors()
  const navigate = useNavigate()
  const client = store.clients.find(c => c.id === id)

  const rows = useMemo<JobSummary[]>(() => {
    if (!client) return []
    const isOpen = (s: string) => s === 'active' || s === 'on_hold'
    return store.jobs.filter(j => j.client_id === client.id)
      .sort((a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)) || (isOpen(a.status) ? compareClientJobs(a, b) : (b.due_date ?? b.created_at).localeCompare(a.due_date ?? a.created_at)))
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
  const past = rows.filter(r => r.job.status !== 'active' && r.job.status !== 'on_hold')
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
        {client.email && <a className="btn" href={emailLink(client.email)} {...EMAIL_TARGET}><Mail size={15} /> Email</a>}
        <button className="btn" onClick={() => edit.client(client)}><Pencil size={15} /> Edit</button>
        <button className="btn primary" onClick={() => edit.job(undefined, { client_id: client.id })}><Plus size={16} /> New job</button>
      </div>
    </div>

    <div className="client-layout">
      <div className="stack loose">
        <section className="card">
          <ClientJobList client={client} detailed />
        </section>
        {past.length > 0 && <section className="card">
          <div className="card-head"><h2>Past jobs <span className="count">{past.length}</span></h2></div>
          <ul className="list">{past.map(r => <li key={r.job.id} className="list-row client-job">
            <div className="grow" style={{ minWidth: 0 }}>
              <Link to={`/jobs/${r.job.id}`} className="title">{r.job.name}</Link>
              <div className="meta">{r.job.job_number}</div>
            </div>
            <span className={`badge ${r.job.status === 'complete' ? 'ok' : r.job.status === 'cancelled' ? 'danger' : ''}`}>{JOB_STATUS_LABEL[r.job.status]}</span>
          </li>)}</ul>
        </section>}
      </div>

      <div className="stack loose">
        <ClientNotes key={client.id} client={client} />
        <section className="card">
          <div className="card-head"><h2>Contact</h2><button className="btn ghost xs" onClick={() => edit.client(client)}><Pencil size={13} /> Edit</button></div>
          <div className="card-body contact-list">
            {client.contact_name && <div className="contact-line"><span className="muted small">Contact</span><span>{client.contact_name}</span></div>}
            {client.phone && <div className="contact-line"><span className="muted small">Phone</span><a href={`tel:${client.phone}`}>{client.phone}</a></div>}
            {client.email && <div className="contact-line"><span className="muted small">Email</span><a href={emailLink(client.email)} {...EMAIL_TARGET} className="truncate">{client.email}</a></div>}
            {client.address && <div className="contact-line"><span className="muted small">Address</span><a href={`https://maps.google.com/?q=${encodeURIComponent(client.address)}`} target="_blank" rel="noreferrer"><MapPin size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 3 }} />{client.address}</a></div>}
            {!client.contact_name && !client.phone && !client.email && !client.address && <p className="small muted">No contact details yet. <button className="btn ghost xs" onClick={() => edit.client(client)}>Add them</button></p>}
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
                {i.paid_date ? <span className="badge ok">Paid</span> : i.amount <= 0.005 ? <span className="badge">No payment due</span> : <span className={`badge ${age > 30 ? 'danger' : 'warn'}`}>Unpaid · {age}d</span>}
                <strong className="num small">{fmtMoney(i.amount)}</strong>
              </li>
            })}</ul>}
          {invoices.length > 8 && <div className="card-foot"><Link className="small" to="/money?tab=invoices">All invoices</Link></div>}
        </section>
      </div>
    </div>
  </div>
}
