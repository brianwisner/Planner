import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/store'
import { hoursForJob, jobBilling } from '../lib/calc'
import { downloadCSV, fmtHours, fmtMoney, sum } from '../lib/utils'
import { ClientModal } from '../components/editors'
import { Empty, Icon } from '../components/ui'

export function Clients() {
  const store = useData()
  const { clients, jobs, timeEntries } = store
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const rows = clients.filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.contact_name.toLowerCase().includes(q.toLowerCase())).map(c => {
    const cj = jobs.filter(j => j.client_id === c.id)
    const b = cj.map(j => jobBilling(store, j))
    return { c, jobs: cj, active: cj.filter(j => j.status === 'active').length, hours: sum(cj.map(j => hoursForJob(timeEntries, j.id))), outstanding: sum(b.map(x => x.outstanding)), unbilled: sum(b.map(x => x.unbilledAmount)) }
  })
  return (
    <div>
      <div className="page-header">
        <h1>Clients</h1>
        <div className="actions"><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> New client</button></div>
      </div>
      <div className="filters"><input type="search" placeholder="Filter clients…" value={q} onChange={e => setQ(e.target.value)} /><span className="grow" /><button className="btn sm" onClick={() => downloadCSV('clients.csv', ['Client', 'Contact', 'Email', 'Phone', 'Jobs', 'Active jobs', 'Hours', 'Unbilled $', 'Outstanding $'], rows.map(r => [r.c.name, r.c.contact_name, r.c.email, r.c.phone, r.jobs.length, r.active, Math.round(r.hours * 100) / 100, Math.round(r.unbilled), r.outstanding]))}>Export CSV</button></div>
      <div className="card">
        {rows.length === 0 && <Empty>No clients yet.</Empty>}
        {rows.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Client</th><th className="hide-mobile">Contact</th><th className="num">Jobs</th><th className="num hide-mobile">Hours</th><th className="num">Unbilled</th><th className="num">Outstanding</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.c.id} className="clickable" onClick={() => nav(`/clients/${r.c.id}`)}>
                <td><div className="bold">{r.c.name}</div><div className="tiny muted">{r.c.address}</div></td>
                <td className="hide-mobile">{r.c.contact_name}<div className="tiny muted">{r.c.phone}{r.c.phone && r.c.email && ' · '}{r.c.email}</div></td>
                <td className="num">{r.active} <span className="muted">/ {r.jobs.length}</span></td>
                <td className="num hide-mobile">{fmtHours(r.hours)}</td>
                <td className="num">{fmtMoney(r.unbilled)}</td>
                <td className={`num ${r.outstanding > 0 ? 'warn-text bold' : ''}`}>{fmtMoney(r.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>}
      </div>
      {adding && <ClientModal onClose={() => setAdding(false)} onCreated={c => nav(`/clients/${c.id}`)} />}
    </div>
  )
}
