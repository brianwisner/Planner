// Timesheet: a week at a glance, plus the full list of entries.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { useData } from '../lib/store'
import { allHours, entryHours, startOfWeekISO, timerHours } from '../lib/calc'
import { StatusBadge } from './Billing'
import type { TimeEntry } from '../lib/types'
import { downloadCSV, fmtDate, fmtHours, sum } from '../lib/utils'
import { TimeModal } from '../components/editors'
import { Icon } from '../components/ui'

export function Time() {
  const store = useData()
  const { timeEntries, jobs, phases, profiles, me, update, clients } = store
  const hourMap = useMemo(() => allHours(store), [store])
  const [params, setParams] = useSearchParams()
  const [jobFilter, setJobFilter] = useState(params.get('job') ?? '')
  const [weekStart, setWeekStart] = useState(startOfWeekISO())
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const e = params.get('entry')
    if (e) { const en = timeEntries.find(x => x.id === e); if (en) setEditing(en); setParams(p => { p.delete('entry'); return p }, { replace: true }) }
  }, [params, timeEntries, setParams])

  const days = Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(weekStart), i), 'yyyy-MM-dd'))
  const weekEnd = days[6]!
  const inWeek = timeEntries.filter(e => e.date >= weekStart && e.date <= weekEnd && (!jobFilter || e.job_id === jobFilter))
  const byJob = useMemo(() => {
    const m = new Map<string, TimeEntry[]>()
    for (const e of inWeek) { const a = m.get(e.job_id) ?? []; a.push(e); m.set(e.job_id, a) }
    return [...m.entries()]
  }, [inWeek])
  const listEntries = (showAll ? timeEntries : inWeek).filter(e => !jobFilter || e.job_id === jobFilter)
  const jobName = (id: string) => jobs.find(j => j.id === id)?.name ?? '?'
  const running = timeEntries.find(e => e.user_id === me?.id && e.started_at && e.hours == null)

  function exportCSV() {
    downloadCSV(`hours-${showAll ? 'all' : weekStart}.csv`, ['Date', 'Person', 'Client', 'Job #', 'Job', 'Phase', 'Hours', 'Notes', 'Billing status'],
      listEntries.map(e => { const j = jobs.find(j => j.id === e.job_id); return [e.date, profiles.find(p => p.id === e.user_id)?.full_name, clients.find(c => c.id === j?.client_id)?.name, j?.job_number, j?.name, phases.find(p => p.id === e.phase_id)?.name ?? 'General', Math.round(entryHours(e) * 100) / 100, e.notes, hourMap.get(e.id)?.status ?? (e.started_at ? 'running' : '')] }))
  }

  return (
    <div>
      <div className="page-header">
        <h1>Time</h1>
        <div className="actions">
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Log hours</button>
          <button className="btn" onClick={exportCSV}><Icon name="download" size={16} /> CSV</button>
        </div>
      </div>
      {running && <div className="card mb row"><span className="timer-pill"><span className="dot" /> Timer running</span> <span>{jobName(running.job_id)} · {phases.find(p => p.id === running.phase_id)?.name ?? 'General'} · started {format(new Date(running.started_at!), 'h:mm a')}</span><span className="grow" /><button className="btn sm" onClick={() => update('time_entries', running.id, { hours: timerHours(running), started_at: null })}><Icon name="stop" size={12} /> Stop</button></div>}
      <div className="filters">
        <select aria-label="Filter time by job" value={jobFilter} onChange={e => setJobFilter(e.target.value)}>
          <option value="">All jobs</option>
          {jobs.filter(j => j.status !== 'archived').map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
        <button className="btn sm icon" aria-label="Previous week" onClick={() => setWeekStart(format(addDays(parseISO(weekStart), -7), 'yyyy-MM-dd'))}><Icon name="chevronL" size={16} /></button>
        <span className="bold nowrap">Week of {fmtDate(weekStart)}</span>
        <button className="btn sm icon" aria-label="Next week" onClick={() => setWeekStart(format(addDays(parseISO(weekStart), 7), 'yyyy-MM-dd'))}><Icon name="chevronR" size={16} /></button>
        <button className="btn sm" onClick={() => setWeekStart(startOfWeekISO())}>This week</button>
      </div>

      <div className="card">
        <h2>Week at a glance <span className="muted small" style={{ fontWeight: 400 }}>{fmtHours(sum(inWeek.map(entryHours)))} total</span></h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Job</th>{days.map(d => <th key={d} className="num">{format(parseISO(d), 'EEE d')}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {byJob.map(([jid, es]) => (
              <tr key={jid}>
                <td><Link to={`/jobs/${jid}`}>{jobName(jid)}</Link></td>
                {days.map(d => { const h = sum(es.filter(e => e.date === d).map(entryHours)); return <td key={d} className="num">{h ? fmtHours(h) : <span className="muted">·</span>}</td> })}
                <td className="num bold">{fmtHours(sum(es.map(entryHours)))}</td>
              </tr>
            ))}
            {byJob.length === 0 && <tr><td colSpan={9} className="empty">No hours this week.</td></tr>}
          </tbody>
          {byJob.length > 0 && <tfoot><tr><td>Total</td>{days.map(d => <td key={d} className="num">{fmtHours(sum(inWeek.filter(e => e.date === d).map(entryHours)))}</td>)}<td className="num">{fmtHours(sum(inWeek.map(entryHours)))}</td></tr></tfoot>}
        </table></div>
      </div>

      <div className="card">
        <h2>Entries <span className="actions"><button className={`chip ${showAll ? 'on' : ''}`} onClick={() => setShowAll(!showAll)}>{showAll ? 'All time' : 'This week'}</button></span></h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Date</th><th>Job / phase</th><th className="hide-mobile">Notes</th><th className="num">Hours</th><th className="hide-mobile">Billing</th></tr></thead>
          <tbody>
            {listEntries.slice(0, 300).map(e => (
              <tr key={e.id} className="clickable" onClick={() => setEditing(e)}>
                <td className="nowrap">{fmtDate(e.date)}</td>
                <td>{jobName(e.job_id)}<div className="tiny muted">{phases.find(p => p.id === e.phase_id)?.name ?? 'General'}</div></td>
                <td className="hide-mobile small muted">{e.notes}</td>
                <td className="num">{e.started_at && e.hours == null ? '⏱' : fmtHours(e.hours)}</td>
                <td className="hide-mobile">{hourMap.get(e.id) && <StatusBadge h={hourMap.get(e.id)!} />}</td>
              </tr>
            ))}
            {listEntries.length === 0 && <tr><td colSpan={5} className="empty">No entries.</td></tr>}
          </tbody>
        </table></div>
      </div>
      <p className="small muted mt">Tip: press <kbd>t</kbd> anywhere to log hours.</p>
      {editing && <TimeModal entry={editing} onClose={() => setEditing(null)} />}
      {adding && <TimeModal defaults={{ user_id: me?.id, job_id: jobFilter || undefined }} onClose={() => setAdding(false)} />}
    </div>
  )
}
