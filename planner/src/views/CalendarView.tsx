// Month calendar + agenda list of deadlines, tasks and site visits.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import type { CalItem } from '../lib/calendar'
import { googleCalendarLink } from '../lib/calendar'
import { daysUntil, fmtDate, todayISO } from '../lib/utils'
import { Icon } from '../components/ui'

export function CalendarView({ items }: { items: CalItem[] }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [mode, setMode] = useState<'month' | 'agenda'>(() => window.innerWidth < 760 ? 'agenda' : 'month')
  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(month), end: endOfWeek(endOfMonth(month)) }), [month])
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>()
    for (const it of items) { const arr = m.get(it.date) ?? []; arr.push(it); m.set(it.date, arr) }
    return m
  }, [items])
  const siteUrl = window.location.origin + window.location.pathname

  const agenda = useMemo(() => {
    const from = todayISO()
    const upcoming = items.filter(i => i.date >= from && !i.done)
    const overdue = items.filter(i => i.date < from && !i.done)
    return { overdue, upcoming: upcoming.slice(0, 80) }
  }, [items])

  return (
    <div>
      <div className="filters">
        <div className="btn-group">
          <button className={`btn sm ${mode === 'month' ? 'active' : ''}`} onClick={() => setMode('month')}>Month</button>
          <button className={`btn sm ${mode === 'agenda' ? 'active' : ''}`} onClick={() => setMode('agenda')}>Agenda</button>
        </div>
        {mode === 'month' && <>
          <button className="btn sm icon" onClick={() => setMonth(m => addMonths(m, -1))}><Icon name="chevronL" size={16} /></button>
          <span className="bold" style={{ minWidth: 130, textAlign: 'center' }}>{format(month, 'MMMM yyyy')}</span>
          <button className="btn sm icon" onClick={() => setMonth(m => addMonths(m, 1))}><Icon name="chevronR" size={16} /></button>
          <button className="btn sm" onClick={() => setMonth(startOfMonth(new Date()))}>Today</button>
        </>}
        <span className="grow" />
        <span className="small muted hide-mobile">Colors: <span className="badge" style={{ background: 'var(--navy)', color: '#fff' }}>job due</span> <span className="badge" style={{ background: '#9a6700', color: '#fff' }}>phase due</span> <span className="badge" style={{ background: 'var(--accent)', color: '#fff' }}>task</span> <span className="badge site">site visit</span></span>
      </div>

      {mode === 'month' ? (
        <div className="cal card" style={{ padding: 0 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="dow">{d}</div>)}
          {days.map(d => {
            const key = format(d, 'yyyy-MM-dd')
            const evs = byDay.get(key) ?? []
            return (
              <div key={key} className={`day ${isSameMonth(d, month) ? '' : 'other'} ${isToday(d) ? 'today' : ''}`}>
                <span className="num">{format(d, 'd')}</span>
                {evs.map(ev => (
                  <Link key={ev.id} to={ev.link} className={`ev ${ev.kind} ${ev.done ? 'done' : ''} ${!ev.done && (daysUntil(ev.date) ?? 0) < 0 ? 'overdue' : ''}`} title={`${ev.title} — ${ev.jobName}`}>
                    {ev.time ? format(new Date(ev.time), 'h:mma ') : ''}{ev.title}
                  </Link>
                ))}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card agenda">
          {agenda.overdue.length > 0 && <>
            <div className="day-head danger-text">Overdue</div>
            <ul className="list">{agenda.overdue.map(ev => <AgendaRow key={ev.id} ev={ev} siteUrl={siteUrl} />)}</ul>
          </>}
          {groupByDay(agenda.upcoming).map(([day, evs]) => (
            <div key={day}>
              <div className="day-head">{fmtDate(day, 'long')}{day === todayISO() && <span className="badge soon" style={{ marginLeft: 8 }}>Today</span>}</div>
              <ul className="list">{evs.map(ev => <AgendaRow key={ev.id} ev={ev} siteUrl={siteUrl} />)}</ul>
            </div>
          ))}
          {agenda.upcoming.length === 0 && agenda.overdue.length === 0 && <div className="empty">Nothing scheduled.</div>}
        </div>
      )}
    </div>
  )
}

function groupByDay(items: CalItem[]): [string, CalItem[]][] {
  const m = new Map<string, CalItem[]>()
  for (const it of items) { const arr = m.get(it.date) ?? []; arr.push(it); m.set(it.date, arr) }
  return [...m.entries()]
}

function AgendaRow({ ev, siteUrl }: { ev: CalItem; siteUrl: string }) {
  return (
    <li>
      <span className={`badge ${ev.kind === 'site_visit' ? 'site' : ev.kind === 'phase' ? 'waiting' : ev.kind === 'job' ? 'archived' : 'active'}`}>
        {ev.kind === 'site_visit' ? 'Site visit' : ev.kind === 'phase' ? 'Phase due' : ev.kind === 'job' ? 'Job due' : 'Task'}
      </span>
      <div className="title">
        <Link to={ev.link}>{ev.title}</Link>
        <div className="meta">{ev.time ? format(new Date(ev.time), 'h:mm a') + ' · ' : ''}{ev.jobName}</div>
      </div>
      <a className="btn sm ghost" href={googleCalendarLink(ev, siteUrl)} target="_blank" rel="noreferrer" title="Add to Google Calendar"><Icon name="external" size={14} /></a>
    </li>
  )
}
