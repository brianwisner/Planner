// A completed-hours timesheet and searchable history, with running timers separate.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { useData } from '../lib/store'
import { timerHours } from '../lib/calc'
import type { TimeEntry } from '../lib/types'
import { JOB_STATUS_LABEL } from '../lib/types'
import { phaseLabel } from '../lib/phases'
import { downloadCSV, fmtDate, fmtDateTime, fmtHourlyRate, fmtHours } from '../lib/utils'
import { elapsedTime, filterTimeRows, parseTimeQuery, timeCSV, timeDays, timeRangeError, timeRows, timeStatusLabel, timeTotals, timeWeek, validTimeDate, writeTimeQuery, TIME_CSV_HEADERS, TIME_PAGE_SIZE, type TimeQuery, type TimeRow } from '../lib/time'
import { TimeModal } from '../components/editors'
import { Icon } from '../components/ui'
import './Time.css'

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export function Time() {
  const store = useData()
  const { loading, error, timeEntries, toast } = store
  const [params, setParams] = useSearchParams()
  const [now, setNow] = useState(() => new Date())
  const query = parseTimeQuery(params, now)
  const allRows = useMemo(() => timeRows(store, now), [store, now])
  const rows = filterTimeRows(allRows, query)
  const totals = timeTotals(rows)
  const dateError = timeRangeError(query)
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const consumedEntry = useRef<string | null>(null)
  const stopping = useRef(new Set<string>())
  const [busyTimers, setBusyTimers] = useState(new Set<string>())
  const [timerErrors, setTimerErrors] = useState<Record<string, string>>({})
  const selectedJob = store.jobs.find(job => job.id === query.job)
  const myTimers = allRows.filter(row => row.status === 'running' && row.entry.user_id === store.me?.id)
  const days = timeDays(query.week)
  const completedRows = rows.filter(row => row.entry.hours != null)
  const weekJobs = [...new Set(completedRows.map(row => row.entry.job_id))]
  const pageCount = Math.max(1, Math.ceil(rows.length / TIME_PAGE_SIZE))
  const page = Math.min(query.page, pageCount)
  const shownRows = rows.slice((page - 1) * TIME_PAGE_SIZE, page * TIME_PAGE_SIZE)
  const filtered = query.job !== '' || query.q.trim() !== '' || query.billable !== 'all' || query.status !== 'all' || query.range !== 'week' || query.week !== timeWeek(now)

  useEffect(() => {
    const tick = () => setNow(new Date())
    const interval = window.setInterval(tick, 30_000)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', tick) }
  }, [])
  useEffect(() => {
    const entryId = params.get('entry')
    if (!entryId) { consumedEntry.current = null; return }
    if (loading || error || consumedEntry.current === entryId) return
    consumedEntry.current = entryId
    const entry = timeEntries.find(entry => entry.id === entryId)
    if (entry) setEditing(entry)
    else toast('That time entry is no longer available.', 'error')
    setParams(current => { const next = new URLSearchParams(current); next.delete('entry'); return next }, { replace: true })
  }, [params, loading, error, timeEntries, toast, setParams])

  function patch(change: Partial<TimeQuery>, replace = false) {
    setParams(current => writeTimeQuery(current, { page: 1, ...change }, now), { replace })
  }
  function reset() { patch({ job: '', q: '', billable: 'all', status: 'all', range: 'week', week: timeWeek(now), from: '', to: '' }) }
  async function stopTimer(row: TimeRow) {
    if (row.entry.user_id !== store.me?.id || stopping.current.has(row.entry.id)) return
    const id = row.entry.id
    if (!Number.isFinite(Date.parse(row.entry.started_at ?? ''))) { setTimerErrors(errors => ({ ...errors, [id]: 'This timer has no valid start time. Edit the entry to record its hours.' })); return }
    stopping.current.add(id); setBusyTimers(new Set(stopping.current))
    setTimerErrors(errors => { const next = { ...errors }; delete next[id]; return next })
    try {
      if (!await store.update('time_entries', id, { hours: timerHours(row.entry), started_at: null })) {
        await store.refresh('time_entries')
        setTimerErrors(errors => ({ ...errors, [id]: 'The timer could not be stopped. Check its current state before retrying.' }))
      }
    } catch {
      await store.refresh('time_entries')
      setTimerErrors(errors => ({ ...errors, [id]: 'Could not confirm the timer stop. Check the entry before retrying.' }))
    } finally { stopping.current.delete(id); setBusyTimers(new Set(stopping.current)) }
  }
  function entryLink(entry: TimeEntry) {
    const next = new URLSearchParams(params); next.set('entry', entry.id)
    return `/time?${next}`
  }
  const scope = query.range === 'all' ? 'All recorded dates' : query.range === 'custom' ? dateError ? 'Custom dates need attention' : `${fmtDate(query.from, 'long')} – ${fmtDate(query.to, 'long')}` : `${fmtDate(query.week, 'long')} – ${fmtDate(days[6])}`

  return <div className="time-page">
    <div className="page-header time-header"><div><h1>Time</h1><p className="time-subtitle">Review completed work, keep notes with each entry, and check your timers.</p></div><div className="actions"><button className="btn primary" disabled={!store.jobs.length || Boolean(query.job && !selectedJob)} onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Log hours</button><button className="btn" disabled={!rows.length || Boolean(dateError)} onClick={() => downloadCSV(`hours-${query.range === 'week' ? query.week : query.range}.csv`, TIME_CSV_HEADERS, timeCSV(rows))}><Icon name="download" size={15} /> Export CSV</button></div></div>

    {(myTimers.length > 0 || busyTimers.size > 0) && <section className="card time-running-card" aria-label="Your running timers"><div><h2>Your running timers</h2><p className="small muted">Always shown, regardless of the filters below. Elapsed time is separate from completed hours.</p></div>{myTimers.map(row => <div className="time-running-row" key={row.entry.id}><span className="timer-pill"><span className="dot" /> {elapsedTime(row.elapsedHours)} elapsed</span><div><Link to={`/jobs/${row.entry.job_id}`}>{row.job?.name ?? 'Saved job'}</Link><div className="tiny muted">{row.phase ? phaseLabel(row.phase) : 'General'} · {row.entry.billable === false ? 'Nonbillable' : 'Billable'}{row.entry.started_at && Number.isFinite(Date.parse(row.entry.started_at)) ? ` · started ${fmtDateTime(row.entry.started_at)}` : ''}</div></div><button className="btn" disabled={busyTimers.has(row.entry.id)} aria-label={`Stop timer for ${row.job?.name ?? 'saved job'}`} onClick={() => void stopTimer(row)}><Icon name="stop" size={14} />{busyTimers.has(row.entry.id) ? 'Stopping…' : 'Stop timer'}</button></div>)}{!myTimers.length && busyTimers.size > 0 && <p className="small muted" role="status">Saving the timer stop…</p>}</section>}
    {Object.entries(timerErrors).map(([id, message]) => <p className="time-error" role="alert" key={id}>{message}</p>)}

    <section className="card time-controls" aria-label="Time filters">
      <div className="time-range-controls" aria-label="Date range">{([['week', 'Week'], ['all', 'All time'], ['custom', 'Custom range']] as const).map(([range, label]) => <button className={`chip ${query.range === range ? 'on' : ''}`} aria-pressed={query.range === range} key={range} onClick={() => patch({ range, ...(range === 'custom' ? { from: query.from || query.week, to: query.to || days[6] } : {}) })}>{label}</button>)}</div>
      {query.range === 'week' && <div className="time-week-controls"><button className="btn icon" aria-label="Previous week" onClick={() => patch({ week: format(addDays(parseISO(query.week), -7), 'yyyy-MM-dd') })}><Icon name="chevronL" size={16} /></button><label>Week starting<input aria-label="Week starting" type="date" value={query.week} onChange={event => { if (validTimeDate(event.target.value)) patch({ week: timeWeek(parseISO(event.target.value)) }) }} /></label><button className="btn icon" aria-label="Next week" onClick={() => patch({ week: format(addDays(parseISO(query.week), 7), 'yyyy-MM-dd') })}><Icon name="chevronR" size={16} /></button><button className="btn" onClick={() => patch({ range: 'week', week: timeWeek(now) })}>This week</button><span className="tiny muted">Monday–Sunday · local dates</span></div>}
      {query.range === 'custom' && <div className="time-custom-dates"><label>From date<input aria-label="From date" type="date" value={query.from} onChange={event => patch({ from: event.target.value })} /></label><label>To date<input aria-label="To date" type="date" value={query.to} onChange={event => patch({ to: event.target.value })} /></label></div>}
      <div className="time-filter-grid"><label>Job<select aria-label="Filter time by job" value={query.job} onChange={event => patch({ job: event.target.value })}><option value="">All job history</option>{query.job && !selectedJob && <option value={query.job}>{store.loading ? 'Loading selected job…' : 'Unavailable job (saved filter)'}</option>}{[...store.jobs].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(job => <option key={job.id} value={job.id}>{store.clients.find(client => client.id === job.client_id)?.name} · {job.job_number ? `${job.job_number} · ` : ''}{job.name}{job.status !== 'active' ? ` (${JOB_STATUS_LABEL[job.status]})` : ''}</option>)}</select></label><label className="time-search-field">Search<input type="search" aria-label="Search time entries" placeholder="Job, client, phase, task, or notes…" value={query.q} onChange={event => patch({ q: event.target.value }, true)} /></label><label>Billing mode<select aria-label="Billable time" value={query.billable} onChange={event => patch({ billable: event.target.value as TimeQuery['billable'] })}><option value="all">Billable &amp; nonbillable</option><option value="billable">Billable</option><option value="nonbillable">Nonbillable</option></select></label><label>Status<select aria-label="Time status" value={query.status} onChange={event => patch({ status: event.target.value as TimeQuery['status'] })}><option value="all">All entries</option><option value="completed">Completed hours</option><option value="running">Running timers</option><option value="unbilled">Not billed</option><option value="partial">Partly paid by deposit</option><option value="deposit">Paid by deposit</option><option value="billed">Billed, not paid</option><option value="paid">Paid invoice</option><option value="nonbillable">Nonbillable</option></select></label></div>
      <div className="time-filter-footer"><span role="status">{scope}</span>{filtered && <button className="btn ghost" onClick={reset}>Reset filters</button>}</div>
      {dateError && <p className="time-error" role="alert">{dateError}</p>}
    </section>

    <div className="stats time-stats" aria-label="Filtered time totals"><div className="stat"><div className="label">Completed hours</div><div className="value">{fmtHours(totals.hours)}</div><div className="sub">{totals.completed} saved {totals.completed === 1 ? 'entry' : 'entries'}</div></div><div className="stat"><div className="label">Billable hours</div><div className="value">{fmtHours(totals.billable)}</div><div className="sub">Completed client work</div></div><div className="stat"><div className="label">Nonbillable hours</div><div className="value">{fmtHours(totals.nonbillable)}</div><div className="sub">Completed internal or rework time</div></div><div className="stat"><div className="label">Running timers</div><div className="value">{totals.running}</div><div className="sub">{elapsedTime(totals.elapsed)} elapsed · excluded above</div></div></div>
    <p className="time-basis tiny muted">Totals and export follow every filter and include historical records. Running timers do not add completed hours or work value until stopped.</p>

    {query.range === 'week' && <section className="card time-week-card" aria-labelledby="time-week-title"><div className="time-section-heading"><h2 id="time-week-title">Week at a glance</h2><span className="small muted">{fmtHours(totals.hours)} completed</span></div><p className="small muted">{fmtHours(totals.billable)} billable · {fmtHours(totals.nonbillable)} nonbillable. {totals.running ? `${totals.running} running ${totals.running === 1 ? 'timer is' : 'timers are'} shown separately.` : 'Completed hours only.'}</p><p className="tiny muted time-swipe-hint">Scroll the table sideways to see every day.</p><div className="table-wrap"><table className="time-week-table"><thead><tr><th>Job</th>{days.map(day => <th key={day} className="num">{format(parseISO(day), 'EEE')}<span>{format(parseISO(day), 'MMM d')}</span></th>)}<th className="num">Total</th></tr></thead><tbody>{weekJobs.map(jobId => { const entries = completedRows.filter(row => row.entry.job_id === jobId); const job = entries[0].job; return <tr key={jobId}><th scope="row">{job ? <Link to={`/jobs/${jobId}`}>{job.name}</Link> : 'Unavailable job'}</th>{days.map(day => { const hours = entries.filter(row => row.entry.date === day).reduce((sum, row) => sum + row.entry.hours!, 0); return <td key={day} className="num">{hours ? fmtHours(hours) : <span className="muted">–</span>}</td> })}<td className="num bold">{fmtHours(timeTotals(entries).hours)}</td></tr> })}{weekJobs.length === 0 && <tr><td colSpan={9} className="time-empty-grid">No completed hours match this week and these filters.</td></tr>}</tbody>{weekJobs.length > 0 && <tfoot><tr><th scope="row">Completed total</th>{days.map(day => <td key={day} className="num">{fmtHours(timeTotals(completedRows.filter(row => row.entry.date === day)).hours)}</td>)}<td className="num">{fmtHours(totals.hours)}</td></tr></tfoot>}</table></div></section>}

    <section className="card time-history-card" aria-labelledby="time-history-title"><div className="time-section-heading"><h2 id="time-history-title">Entries</h2><span className="small muted">Newest recorded date first</span></div>{store.loading ? <p className="time-empty" role="status">Loading time entries…</p> : shownRows.length ? <div className="table-wrap"><table className="time-history-table"><thead><tr><th>Date / job / notes</th><th className="num">Hours</th><th>Billing / value</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{shownRows.map(row => <tr key={row.entry.id} data-entry-id={row.entry.id}><td className="time-entry-context"><Link className="time-entry-date" to={entryLink(row.entry)}>{fmtDate(row.entry.date, 'long')}</Link><div className="time-entry-job">{row.job ? <Link to={`/jobs/${row.job.id}`}>{row.job.name}</Link> : 'Unavailable job'}{row.client && <span className="tiny muted">{row.client.name}{row.job?.job_number ? ` · ${row.job.job_number}` : ''}</span>}</div><div className="tiny muted">{row.phase ? phaseLabel(row.phase) : 'General / unavailable phase'} · {row.ownerName}</div>{row.task && <div className="tiny muted">Task: {row.task.title}</div>}{row.entry.notes && <p className="time-entry-notes">{row.entry.notes}</p>}</td><td className="num time-entry-hours">{row.status === 'running' ? <><span className="timer-pill"><span className="dot" /> Running</span><div className="tiny muted">{elapsedTime(row.elapsedHours)} elapsed</div></> : fmtHours(row.entry.hours)}</td><td className="time-entry-billing"><span className={`badge h-${row.status}`}>{timeStatusLabel(row)}</span>{row.status === 'running' && <span className={`badge ${row.entry.billable === false ? 'h-nonbillable' : 'todo'}`}>{row.entry.billable === false ? 'Nonbillable' : 'Billable'}</span>}{row.amount != null && <div className="small">{money(row.amount)} work value</div>}<div className="tiny muted">{row.entry.rate == null ? 'Fallback rate' : 'Saved rate'} {fmtHourlyRate(row.rate)}</div><Link className="tiny" to={`/billing?job=${row.entry.job_id}`}>Job billing →</Link></td><td className="time-entry-actions"><button className="btn ghost" aria-label={`Edit time entry on ${row.entry.date}${row.entry.notes ? `: ${row.entry.notes}` : ''}`} onClick={() => setEditing(row.entry)}><Icon name="edit" size={15} /><span>Edit</span></button></td></tr>)}</tbody></table></div> : <div className="time-empty"><h3>{dateError ? 'Check the selected dates' : store.timeEntries.length ? 'No entries match these filters' : 'No time recorded yet'}</h3><p>{dateError ? 'Correct the date range to show entries.' : store.timeEntries.length ? 'Try another job, date range, or search, or reset the filters.' : 'Log completed hours on a job to start your timesheet.'}</p>{filtered && !dateError && <button className="btn" onClick={reset}>Reset filters</button>}{!store.jobs.length && <Link className="btn" to="/jobs">Open jobs</Link>}</div>}
      <div className="time-history-footer"><span role="status">{rows.length ? `${(page - 1) * TIME_PAGE_SIZE + 1}–${Math.min(page * TIME_PAGE_SIZE, rows.length)} of ${rows.length} matching entries` : '0 matching entries'} · export includes all matches</span>{pageCount > 1 && <div className="time-pagination"><button className="btn" aria-label="Previous entries" disabled={page <= 1} onClick={() => patch({ page: page - 1 })}><Icon name="chevronL" size={14} /> Previous</button><span className="small">Page {page} of {pageCount}</span><button className="btn" aria-label="Next entries" disabled={page >= pageCount} onClick={() => patch({ page: page + 1 })}>Next <Icon name="chevronR" size={14} /></button></div>}</div>
    </section>
    {editing && <TimeModal entry={editing} onClose={() => setEditing(null)} />}
    {adding && <TimeModal defaults={{ job_id: selectedJob?.id }} onClose={() => setAdding(false)} />}
  </div>
}
