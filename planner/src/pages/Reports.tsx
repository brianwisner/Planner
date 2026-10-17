// Reports: hours by job and client; actual vs estimate per phase.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import { allHours, entryHours, hoursForPhase } from '../lib/calc'
import { PHASE_KIND_SHORT } from '../lib/types'
import { downloadCSV, fmtHours, sum, todayISO } from '../lib/utils'
import { Icon, Progress } from '../components/ui'
import { format, subDays } from 'date-fns'

type Tab = 'job' | 'client' | 'estimate'

export function Reports() {
  const store = useData()
  const { jobs, clients, phases, timeEntries } = store
  const hourMap = useMemo(() => allHours(store), [store])
  // Hours that are billed, or paid for by a deposit (part-covered entries count proportionally).
  const covered = (e: (typeof timeEntries)[number]) => { const h = hourMap.get(e.id); if (!h) return 0; if (h.status === 'billed' || h.status === 'paid' || h.status === 'deposit') return entryHours(e); return h.amount > 0 ? entryHours(e) * h.covered / h.amount : 0 }
  const [tab, setTab] = useState<Tab>('job')
  const [from, setFrom] = useState(format(subDays(new Date(), 90), 'yyyy-MM-dd'))
  const [to, setTo] = useState(todayISO())
  const entries = useMemo(() => timeEntries.filter(e => e.hours != null && e.date >= from && e.date <= to), [timeEntries, from, to])
  const total = sum(entries.map(entryHours))

  const byJob = jobs.map(j => ({ key: j.id, label: j.name, sub: clients.find(c => c.id === j.client_id)?.name ?? '', hours: sum(entries.filter(e => e.job_id === j.id).map(entryHours)), billed: sum(entries.filter(e => e.job_id === j.id).map(covered)), link: `/jobs/${j.id}` })).filter(r => r.hours > 0).sort((a, b) => b.hours - a.hours)
  const byClient = clients.map(c => { const ids = new Set(jobs.filter(j => j.client_id === c.id).map(j => j.id)); const es = entries.filter(e => ids.has(e.job_id)); return { key: c.id, label: c.name, sub: `${ids.size} jobs`, hours: sum(es.map(entryHours)), billed: sum(es.map(covered)), link: `/clients/${c.id}` } }).filter(r => r.hours > 0).sort((a, b) => b.hours - a.hours)
  const rows = tab === 'client' ? byClient : byJob

  const estimateRows = jobs.filter(j => j.status !== 'archived').flatMap(j => phases.filter(p => p.job_id === j.id && (p.estimate_hours > 0 || hoursForPhase(timeEntries, p.id) > 0)).map(p => ({ job: j, phase: p, logged: hoursForPhase(timeEntries, p.id) })))

  function exportCSV() {
    if (tab === 'estimate') downloadCSV('estimate-vs-actual.csv', ['Job #', 'Job', 'Phase', 'Status', 'Estimate h', 'Actual h', 'Variance h', '% used'], estimateRows.map(r => [r.job.job_number, r.job.name, r.phase.name, r.phase.status, r.phase.estimate_hours, Math.round(r.logged * 100) / 100, Math.round((r.logged - r.phase.estimate_hours) * 100) / 100, r.phase.estimate_hours ? Math.round(r.logged / r.phase.estimate_hours * 100) : '']))
    else downloadCSV(`hours-by-${tab}.csv`, [tab === 'job' ? 'Job' : 'Client', 'Detail', 'Hours', 'Billed or deposit h', 'Not billed h', 'Share %'], rows.map(r => [r.label, r.sub, Math.round(r.hours * 100) / 100, Math.round(r.billed * 100) / 100, Math.round((r.hours - r.billed) * 100) / 100, total ? Math.round(r.hours / total * 100) : 0]))
  }

  return (
    <div>
      <div className="page-header">
        <h1>Reports</h1>
        <div className="btn-group">
          {(['job', 'client', 'estimate'] as Tab[]).map(t => <button key={t} className={`btn sm ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'job' ? 'By job' : t === 'client' ? 'By client' : 'Estimate vs actual'}</button>)}
        </div>
        <div className="actions"><button className="btn" onClick={exportCSV}><Icon name="download" size={16} /> CSV</button></div>
      </div>
      {tab !== 'estimate' && (
        <div className="filters">
          <label style={{ margin: 0 }}>From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <label style={{ margin: 0 }}>To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} />
          <div className="btn-group">
            <button className="btn sm" onClick={() => { setFrom(format(subDays(new Date(), 7), 'yyyy-MM-dd')); setTo(todayISO()) }}>7d</button>
            <button className="btn sm" onClick={() => { setFrom(format(subDays(new Date(), 30), 'yyyy-MM-dd')); setTo(todayISO()) }}>30d</button>
            <button className="btn sm" onClick={() => { setFrom(format(subDays(new Date(), 90), 'yyyy-MM-dd')); setTo(todayISO()) }}>90d</button>
            <button className="btn sm" onClick={() => { setFrom(`${new Date().getFullYear()}-01-01`); setTo(todayISO()) }}>This year</button>
          </div>
          <span className="grow" /><span className="bold">{fmtHours(total)} total</span>
        </div>
      )}
      <div className="card">
        {tab !== 'estimate' ? (
          <div className="table-wrap"><table>
            <thead><tr><th>{tab === 'job' ? 'Job' : 'Client'}</th><th style={{ width: '30%' }} className="hide-mobile">Share</th><th className="num">Hours</th><th className="num hide-mobile">Billed / deposit</th><th className="num">Not billed</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key}>
                  <td><Link to={r.link} className="bold">{r.label}</Link><div className="tiny muted">{r.sub}</div></td>
                  <td className="hide-mobile"><Progress value={r.hours} max={total} /><span className="tiny muted">{total ? Math.round(r.hours / total * 100) : 0}%</span></td>
                  <td className="num bold">{fmtHours(r.hours)}</td>
                  <td className="num hide-mobile">{fmtHours(r.billed)}</td>
                  <td className="num">{fmtHours(r.hours - r.billed)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="empty">No hours in this range.</td></tr>}
            </tbody>
          </table></div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Job</th><th>Phase</th><th className="hide-mobile" style={{ width: '25%' }}>Used</th><th className="num">Estimate</th><th className="num">Actual</th><th className="num">Variance</th></tr></thead>
            <tbody>
              {estimateRows.map(r => {
                const v = r.logged - r.phase.estimate_hours
                return (
                  <tr key={r.phase.id}>
                    <td><Link to={`/jobs/${r.job.id}`} className="bold">{r.job.name}</Link></td>
                    <td><span className={`badge ${r.phase.status}`}>{PHASE_KIND_SHORT[r.phase.kind]}</span></td>
                    <td className="hide-mobile"><Progress value={r.logged} max={r.phase.estimate_hours} /></td>
                    <td className="num">{fmtHours(r.phase.estimate_hours)}</td>
                    <td className="num">{fmtHours(r.logged)}</td>
                    <td className={`num bold ${v > 0 ? 'danger-text' : 'ok-text'}`}>{v > 0 ? '+' : ''}{fmtHours(v)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{fmtHours(sum(estimateRows.map(r => r.phase.estimate_hours)))}</td><td className="num">{fmtHours(sum(estimateRows.map(r => r.logged)))}</td><td className="num">{fmtHours(sum(estimateRows.map(r => r.logged - r.phase.estimate_hours)))}</td></tr></tfoot>
          </table></div>
        )}
      </div>
    </div>
  )
}
