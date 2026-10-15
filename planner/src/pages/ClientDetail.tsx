import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { jobBilling } from '../lib/calc'
import { fmtDate, fmtHours, fmtMoney, sum } from '../lib/utils'
import { JobsTable } from '../views/JobsTable'
import { ClientModal, JobModal } from '../components/editors'
import { Empty, Icon } from '../components/ui'

export function ClientDetail() {
  const { id } = useParams()
  const store = useData()
  const { clients, jobs, invoices } = store
  const nav = useNavigate()
  const client = clients.find(c => c.id === id)
  const [edit, setEdit] = useState(false)
  const [newJob, setNewJob] = useState(false)
  const cj = useMemo(() => jobs.filter(j => j.client_id === id), [jobs, id])
  const b = useMemo(() => cj.map(j => jobBilling(store, j)), [cj, store])
  if (!client) return <div className="card"><Empty>Client not found. <Link to="/clients">Back</Link></Empty></div>
  const cinv = invoices.filter(i => cj.some(j => j.id === i.job_id)).sort((a, b) => b.issued_date.localeCompare(a.issued_date))
  return (
    <div>
      <div className="page-header">
        <div>
          <div className="small muted"><Link to="/clients">Clients</Link></div>
          <h1>{client.name}</h1>
          <div className="small muted">{[client.contact_name, client.phone, client.email, client.address].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setNewJob(true)}><Icon name="plus" size={16} /> New job</button>
          <button className="btn" onClick={() => setEdit(true)}><Icon name="edit" size={14} /> Edit</button>
        </div>
      </div>
      <div className="stats mb">
        <div className="stat"><div className="label">Jobs</div><div className="value">{cj.filter(j => j.status === 'active').length}<span className="muted" style={{ fontSize: 14 }}> active / {cj.length}</span></div></div>
        <div className="stat"><div className="label">Hours logged</div><div className="value">{fmtHours(sum(b.map(x => x.loggedHours)))}</div></div>
        <div className="stat"><div className="label">Unbilled</div><div className="value">{fmtMoney(sum(b.map(x => x.unbilledAmount)))}</div><div className="sub">{fmtHours(sum(b.map(x => x.unbilledHours)))}</div></div>
        <div className="stat"><div className="label">Outstanding</div><div className={`value ${sum(b.map(x => x.outstanding)) > 0 ? 'warn-text' : ''}`}>{fmtMoney(sum(b.map(x => x.outstanding)))}</div><div className="sub">{fmtMoney(sum(b.map(x => x.invoiced)))} invoiced total</div></div>
      </div>
      {client.notes && <div className="card mb"><h2>Notes</h2><p style={{ whiteSpace: 'pre-wrap' }}>{client.notes}</p></div>}
      <div className="card"><h2>Jobs</h2><JobsTable jobs={cj} showExport={false} /></div>
      <div className="card">
        <h2>Invoices</h2>
        {cinv.length === 0 && <p className="small muted">No invoices yet.</p>}
        {cinv.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Job</th><th>Issued</th><th>Paid</th><th className="num">Amount</th></tr></thead>
          <tbody>{cinv.map(i => <tr key={i.id} className="clickable" onClick={() => nav(`/billing?job=${i.job_id}`)}><td>{i.number}</td><td>{jobs.find(j => j.id === i.job_id)?.name}</td><td>{fmtDate(i.issued_date)}</td><td>{i.paid_date ? <span className="badge complete">{fmtDate(i.paid_date)}</span> : <span className="badge soon">outstanding</span>}</td><td className="num">{fmtMoney(i.amount)}</td></tr>)}</tbody>
        </table></div>}
      </div>
      {edit && <ClientModal client={client} onClose={() => { setEdit(false); if (!clients.find(c => c.id === id)) nav('/clients') }} />}
      {newJob && <JobModal defaultClientId={client.id} onClose={() => setNewJob(false)} onCreated={j => nav(`/jobs/${j.id}`)} />}
    </div>
  )
}
