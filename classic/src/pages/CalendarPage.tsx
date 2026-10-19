import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, format } from 'date-fns'
import { useData } from '../lib/store'
import { buildICS, calendarItems, parseCalendarQuery, writeCalendarQuery, type CalendarFocus, type CalendarKind, type CalendarQuery, type CalendarStatus } from '../lib/calendar'
import { downloadText, fmtDate } from '../lib/utils'
import { CalendarView } from '../views/CalendarView'
import { Icon } from '../components/ui'
import './calendar-page.css'

const focusCopy: Record<Exclude<CalendarFocus, 'all'>, { title: string; detail: string }> = {
  overdue: { title: 'Overdue open dates', detail: 'Unfinished dates before today, across all months.' },
  today: { title: 'Today', detail: 'Open dates on the local calendar day.' },
  upcoming: { title: 'Next 7 days', detail: 'Open dates from today through the next six days.' },
  visits: { title: 'Upcoming site visits', detail: 'Open site visits from today forward, across all months.' },
}

export function CalendarPage() {
  const store = useData()
  const [params, setParams] = useSearchParams()
  const [now, setNow] = useState(() => new Date())
  const [defaultMode] = useState<'month' | 'agenda'>(() => window.innerWidth < 760 ? 'agenda' : 'month')
  const query = parseCalendarQuery(params, now, defaultMode)
  const today = format(now, 'yyyy-MM-dd'), upcomingEnd = format(addDays(now, 6), 'yyyy-MM-dd')
  const allItems = useMemo(() => calendarItems(store), [store])
  const calendarJobs = store.jobs.filter(job => job.status !== 'cancelled' && job.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))
  const words = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const baseItems = allItems.filter(item => (!query.job || item.jobId === query.job) && (query.kind === 'all' || item.kind === query.kind) && words.every(word => `${item.title} ${item.jobName} ${item.clientName ?? ''} ${item.jobNumber ?? ''} ${store.jobs.find(job => job.id === item.jobId)?.address ?? ''}`.toLowerCase().includes(word)))
  const openItems = baseItems.filter(item => !item.done)
  const counts = { overdue: openItems.filter(item => item.date < today).length, today: openItems.filter(item => item.date === today).length, upcoming: openItems.filter(item => item.date >= today && item.date <= upcomingEnd).length, visits: openItems.filter(item => item.kind === 'site_visit' && item.date >= today).length }
  const statusItems = baseItems.filter(item => query.status === 'all' || (query.status === 'done' ? item.done : !item.done))
  const items = query.focus === 'all' ? statusItems : openItems.filter(item => query.focus === 'overdue' ? item.date < today : query.focus === 'today' ? item.date === today : query.focus === 'upcoming' ? item.date >= today && item.date <= upcomingEnd : item.kind === 'site_visit' && item.date >= today)
  const scopeItems = query.focus === 'all' ? items.filter(item => item.date.startsWith(query.month)) : items
  const exported = scopeItems.filter(item => !item.done)
  const currentFocus = query.focus === 'all' ? null : focusCopy[query.focus]
  const mode = currentFocus ? 'agenda' : query.view
  const activeFilters = Boolean(query.job || query.q.trim() || query.kind !== 'all' || query.status !== 'open' || currentFocus)

  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [])
  function patch(patch: Partial<CalendarQuery>, replace = false) { setParams(current => writeCalendarQuery(current, patch, now, defaultMode), { replace }) }
  function chooseFocus(focus: Exclude<CalendarFocus, 'all'>) { patch({ focus, status: 'open', view: 'agenda' }) }

  return <div className="calendar-page">
    <div className="page-header calendar-page-header"><div><h1>Calendar</h1><p className="calendar-page-subtitle">Deadlines, tasks and site visits, with the job behind each date.</p></div><div className="actions"><button className="btn" disabled={exported.length === 0} title="Download unfinished dates in the current month or date focus" onClick={() => downloadText('wisner-planner.ics', buildICS(exported, 'Wisner Planner'), 'text/calendar')}><Icon name="download" size={15} /> Download open .ics</button><Link className="btn" to="/settings#calendar">Calendar sync</Link></div></div>
    <div className="stats calendar-summary" aria-label="Open calendar work">
      {([['overdue', 'Overdue', 'Before today'], ['today', 'Today', fmtDate(today, 'long')], ['upcoming', 'Next 7 days', `Through ${fmtDate(upcomingEnd)}`], ['visits', 'Site visits', 'Today forward']] as const).map(([focus, label, detail]) => <button key={focus} className={`stat calendar-summary-button ${query.focus === focus ? 'is-selected' : ''}`} aria-label={`${label}: ${counts[focus]}`} aria-pressed={query.focus === focus} onClick={() => chooseFocus(focus)}><div className="label">{label}</div><div className="value">{counts[focus]}</div><div className="sub">{detail}</div></button>)}
    </div>
    <p className="calendar-summary-scope tiny muted">Summaries count open work for the current job, search and date type, across all months.</p>
    <section className="card calendar-page-filters" aria-label="Calendar filters"><div className="calendar-filter-grid">
      <label className="calendar-search-label">Search dates<input type="search" aria-label="Search calendar" placeholder="Task, job, client or address…" value={query.q} onChange={event => patch({ q: event.target.value }, true)} /></label>
      <label>Job<select aria-label="Calendar job" value={query.job} onChange={event => patch({ job: event.target.value })}><option value="">All calendar jobs</option>{query.job && !calendarJobs.some(job => job.id === query.job) && <option value={query.job}>Job unavailable in calendar</option>}{calendarJobs.map(job => <option key={job.id} value={job.id}>{job.job_number ? `${job.job_number} · ` : ''}{job.name}{job.status === 'complete' ? ' (Complete)' : job.status === 'on_hold' ? ' (On hold)' : ''}</option>)}</select></label>
      <label>Date type<select aria-label="Calendar date type" value={query.kind} onChange={event => patch({ kind: event.target.value as CalendarKind })}><option value="all">All types</option><option value="job">Job deadlines</option><option value="phase">Phase deadlines</option><option value="task">Tasks</option><option value="site_visit">Site visits</option></select></label>
      <label>Date status<select aria-label="Calendar date status" value={currentFocus ? 'open' : query.status} onChange={event => patch({ status: event.target.value as CalendarStatus, focus: 'all' })}><option value="open">Open dates</option><option value="all">Include completed</option><option value="done">Completed only</option></select></label>
    </div><div className="calendar-filter-footer"><span role="status">{scopeItems.length} matching {scopeItems.length === 1 ? 'date' : 'dates'} in {currentFocus ? 'this date focus' : 'the selected month'}</span>{activeFilters && <button className="btn ghost" onClick={() => patch({ job: '', q: '', kind: 'all', status: 'open', focus: 'all' })}>Clear calendar filters</button>}</div></section>
    <p className="calendar-status-scope small muted">Open dates are unfinished work on active or on-hold jobs. Include completed to see finished dates and completed jobs. Cancelled and archived jobs are excluded.</p>
    {currentFocus && <div className="calendar-focus-notice"><div><b>{currentFocus.title}</b><span>{currentFocus.detail}</span></div><button className="btn" onClick={() => patch({ focus: 'all' })}>Show selected month</button></div>}
    <CalendarView items={items} now={now} month={query.month} onMonthChange={month => patch({ month, focus: 'all' })} mode={mode} onModeChange={view => patch({ view, ...(view === 'month' ? { focus: 'all' } : {}) })} agendaScope={currentFocus ? 'all' : 'month'} agendaTitle={currentFocus?.title} />
    <p className="calendar-export-scope tiny muted">Download includes {exported.length} unfinished {exported.length === 1 ? 'date' : 'dates'} in {currentFocus ? 'this date focus' : 'the selected month'} and current filters. Completed dates are excluded. Timed visits use your local calendar date and time.</p>
  </div>
}
