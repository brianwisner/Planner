// Money → Bids: who sends you work, how many bids you win, and why you lose the
// rest. Everything is worked out from jobs (see lib/bids.ts); all time.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Download, Handshake, Inbox, Send } from 'lucide-react'
import { useData } from '../lib/store'
import { bidSummary, FOLLOW_UP_TITLE, quotedFee, sourceReport } from '../lib/bids'
import { DueText, Empty } from '../components/ui'
import { downloadCSV, fmtDate, fmtHourlyRate, fmtMoney } from '../lib/utils'

const pct = (n: number | null) => n == null ? '—' : `${Math.round(n * 100)}%`

export function BidsReport() {
  const store = useData()
  const sources = useMemo(() => sourceReport(store), [store])
  const bids = useMemo(() => bidSummary(store), [store])
  const clientName = (id: string) => store.clients.find(c => c.id === id)?.name ?? ''
  const unreferred = store.jobs.filter(j => !j.source.trim()).length
  const decided = bids.won + bids.lost.length
  const open = [...bids.out, ...bids.leads].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const followUp = (jobId: string) => store.tasks.find(t => t.job_id === jobId && t.status !== 'done' && t.title === FOLLOW_UP_TITLE)

  const exportCsv = () => downloadCSV('who-sends-you-work.csv', ['Source', 'Clients referred', 'Jobs', 'Won', 'Lost', 'Still open', 'Win rate', 'Work won', 'Earned per hour (finished jobs)'],
    sources.map(r => [r.name, r.clients.join('; '), r.jobs, r.won, r.lost, r.open, r.winRate == null ? null : Math.round(r.winRate * 100) / 100, Math.round(r.workWon), r.rate == null ? null : Math.round(r.rate * 100) / 100]))

  if (!store.jobs.length) return <div className="card"><Empty icon={<Handshake size={22} />} title="No jobs yet">Add leads as they come in (New job → starts in Lead) and this page shows who sends you work and how many bids you win.</Empty></div>

  return <div className="stack loose">
    <div className="stats">
      <Link className="stat" to="/jobs?stage=lead"><span className="label"><Inbox size={15} />New leads</span><span className="value">{bids.leads.length}</span><span className="sub">Not priced yet</span></Link>
      <Link className="stat" to="/jobs?stage=bidding"><span className="label"><Send size={15} />Bids out</span><span className="value">{bids.out.length}</span><span className="sub">Being priced or waiting on an answer</span></Link>
      <div className="stat ok"><span className="label">Win rate</span><span className="value">{pct(bids.winRate)}</span><span className="sub">{decided ? `Won ${bids.won} of ${decided} decided bids` : 'No decided bids yet'}</span></div>
      <div className="stat"><span className="label">Average fee offered</span><span className="value">{bids.avgWon == null ? '—' : fmtMoney(bids.avgWon)}</span><span className="sub">On bids you won{bids.avgLost != null ? ` · ${fmtMoney(bids.avgLost)} on bids you lost` : ''}</span></div>
    </div>

    <section className="card">
      <div className="card-head"><h2>Who sends you work <span className="sub">All time</span></h2>{sources.length > 0 && <button className="btn sm" onClick={exportCsv}><Download size={14} /> CSV</button>}</div>
      <div className="table-wrap"><table className="table sources-table">
        <thead><tr><th>Source</th><th className="num">Jobs</th><th className="num">Won</th><th className="num hide-sm">Lost</th><th className="num">Win rate</th><th className="num">Work won</th><th className="num hide-sm" title="Fees recorded ÷ hours worked, on finished jobs">Earned / hr</th></tr></thead>
        <tbody>{sources.map(r => <tr key={r.key}>
          <td><span className="strong">{r.name}</span>{r.clients.length > 0 && <div className="tiny muted">Referred {r.clients.join(', ')}</div>}{r.open > 0 && <div className="tiny muted">{r.open} still open</div>}</td>
          <td className="num">{r.jobs}</td>
          <td className="num">{r.won}</td>
          <td className="num hide-sm">{r.lost || <span className="muted">—</span>}</td>
          <td className="num">{pct(r.winRate)}</td>
          <td className="num strong">{r.workWon ? fmtMoney(r.workWon) : <span className="muted">—</span>}</td>
          <td className="num hide-sm">{r.rate == null ? <span className="muted">—</span> : fmtHourlyRate(r.rate)}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="card-foot"><span className="tiny muted">{unreferred
        ? `${unreferred} job${unreferred === 1 ? ' has' : 's have'} no referral recorded, so ${unreferred === 1 ? 'it is' : 'they are'} listed under the client. Add one with Edit job → Referred by.`
        : 'Jobs without a referral are listed under their client.'} Earned per hour counts finished jobs only.</span></div>
    </section>

    <div className="money-two">
      <section className="card">
        <div className="card-head"><h2>Open leads and bids <span className="sub">Oldest first</span></h2><Link className="small" to="/jobs">Board</Link></div>
        {open.length === 0 ? <Empty compact title="No open leads or bids">New jobs start in Lead. When a proposal goes out, mark it sent to get a follow-up reminder.</Empty> :
          <ul className="list">{open.map(job => { const fee = quotedFee(store, job), task = followUp(job.id); return <li key={job.id} className="list-row bid-row">
            <span className="stage-dot" data-stage={bids.leads.includes(job) ? 'lead' : 'bidding'} />
            <span className="grow">
              <Link to={`/jobs/${job.id}`} className="strong">{job.name}</Link>
              <span className="tiny muted" style={{ display: 'block' }}>{[clientName(job.client_id), job.source && `via ${job.source}`, `came in ${fmtDate(job.created_at.slice(0, 10))}`].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="right">
              <span className="num strong small" style={{ display: 'block' }}>{fee != null ? fmtMoney(fee) : bids.leads.includes(job) ? 'Lead' : 'Not priced'}</span>
              {task?.due_date && <span className="tiny">Follow up <DueText date={task.due_date} /></span>}
            </span>
          </li> })}</ul>}
      </section>

      <section className="card">
        <div className="card-head"><h2>Why bids were lost</h2><span className="sub">{bids.lost.length} lost</span></div>
        {bids.lost.length === 0 ? <Empty compact title="No lost bids recorded">When a lead or bid doesn't turn into work, use "Didn't get it" on the job to record why.</Empty> : <>
          <div className="card-body">
            <ul className="hbar-list">{bids.reasons.map(r => <li key={r.reason}>
              <div className="row between"><span className="small strong">{r.reason}</span><span className="small num">{r.count}</span></div>
              <div className="hbar" aria-hidden="true"><span className="hbar-lost" style={{ width: `${r.count / bids.reasons[0].count * 100}%` }} /></div>
            </li>)}</ul>
          </div>
          <ul className="list">{bids.lost.slice(0, 8).map(l => <li key={l.job.id} className="list-row bid-row">
            <span className="grow">
              <Link to={`/jobs/${l.job.id}`} className="strong">{l.job.name}</Link>
              <span className="tiny muted" style={{ display: 'block' }}>{[clientName(l.job.client_id), l.reason, l.date && fmtDate(l.date)].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="num small">{l.fee != null ? fmtMoney(l.fee) : <span className="muted">—</span>}</span>
          </li>)}</ul>
        </>}
      </section>
    </div>
  </div>
}
