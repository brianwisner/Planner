import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns'
import { calendarOrder, googleCalendarLink, type CalItem, type CalendarMode } from '../lib/calendar'
import { fmtDate } from '../lib/utils'
import { DueBadge, Icon } from '../components/ui'
import './calendar.css'

export interface CalendarViewProps {
  items: CalItem[]
  month?: string
  onMonthChange?: (month: string) => void
  mode?: CalendarMode
  onModeChange?: (mode: CalendarMode) => void
  agendaScope?: 'month' | 'all'
  agendaTitle?: string
  now?: Date
}
const labels: Record<CalItem['kind'], string> = { job: 'Job deadline', phase: 'Phase deadline', task: 'Task', site_visit: 'Site visit' }

/** Controlled by CalendarPage, or usable with only items inside the Jobs view. */
export function CalendarView({ items, month: controlledMonth, onMonthChange, mode: controlledMode, onModeChange, agendaScope = 'all', agendaTitle, now: suppliedNow }: CalendarViewProps) {
  const headingId = useId()
  const [clock, setClock] = useState(() => new Date())
  const [localMonth, setLocalMonth] = useState(() => format(new Date(), 'yyyy-MM'))
  const [localMode, setLocalMode] = useState<CalendarMode>(() => window.innerWidth < 760 ? 'agenda' : 'month')
  const [selected, setSelected] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  useEffect(() => {
    if (suppliedNow) return
    const tick = () => setClock(new Date())
    const timer = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [suppliedNow])
  const now = suppliedNow ?? clock
  const today = format(now, 'yyyy-MM-dd')
  const monthKey = controlledMonth ?? localMonth
  const month = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(monthKey) ? new Date(`${monthKey}-01T00:00:00`) : startOfMonth(now)
  const activeMonth = format(month, 'yyyy-MM')
  const mode = controlledMode ?? localMode
  const selectedDay = selected.startsWith(activeMonth) ? selected : today.startsWith(activeMonth) ? today : `${activeMonth}-01`
  const sorted = useMemo(() => [...items].sort(calendarOrder), [items])
  const byDay = useMemo(() => {
    const grouped = new Map<string, CalItem[]>()
    for (const item of sorted) grouped.set(item.date, [...(grouped.get(item.date) ?? []), item])
    return grouped
  }, [sorted])
  const days = eachDayOfInterval({ start: startOfWeek(month), end: endOfWeek(endOfMonth(month)) })
  const monthItems = sorted.filter(item => item.date.startsWith(activeMonth))
  const agendaItems = agendaScope === 'month' ? monthItems : sorted
  const overdue = agendaItems.filter(item => !item.done && item.date < today)
  const dated = agendaItems.filter(item => item.done || item.date >= today)
  const showMonthNavigation = mode === 'month' || agendaScope === 'month'
  const siteUrl = window.location.origin + window.location.pathname

  function changeMonth(next: string) { if (onMonthChange) onMonthChange(next); else setLocalMonth(next) }
  function changeMode(next: CalendarMode) { if (onModeChange) onModeChange(next); else setLocalMode(next) }
  function chooseDay(date: string) { setSelected(date); if (!date.startsWith(activeMonth)) changeMonth(date.slice(0, 7)) }
  return <section className="calendar-view" aria-labelledby={headingId}>
    <div className="calendar-view-toolbar">
      <div className="btn-group calendar-mode" aria-label="Calendar view"><button className={`btn ${mode === 'month' ? 'active' : ''}`} aria-pressed={mode === 'month'} onClick={() => changeMode('month')}>Month</button><button className={`btn ${mode === 'agenda' ? 'active' : ''}`} aria-pressed={mode === 'agenda'} onClick={() => changeMode('agenda')}>Agenda</button></div>
      {showMonthNavigation && <div className="calendar-month-controls"><button className="btn icon" aria-label="Previous month" onClick={() => changeMonth(format(addMonths(month, -1), 'yyyy-MM'))}><Icon name="chevronL" size={16} /></button><label className="calendar-month-input"><span className="sr-only">Calendar month</span><input aria-label="Calendar month" type="month" value={activeMonth} onChange={event => { if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value)) changeMonth(event.target.value) }} /></label><button className="btn icon" aria-label="Next month" onClick={() => changeMonth(format(addMonths(month, 1), 'yyyy-MM'))}><Icon name="chevronR" size={16} /></button><button className="btn" onClick={() => { changeMonth(format(now, 'yyyy-MM')); setSelected(today) }}>Today</button></div>}
    </div>
    <div className="calendar-view-heading"><h2 id={headingId}>{mode === 'agenda' && agendaScope === 'all' ? agendaTitle ?? 'All calendar dates' : format(month, 'MMMM yyyy')}</h2><span className="small muted" role="status">{(mode === 'month' ? monthItems : agendaItems).length} dates · {(mode === 'month' ? monthItems : agendaItems).filter(item => item.done).length} completed</span></div>

    {mode === 'month' ? <>
      <div className="calendar-month-wrap"><table className="calendar-month-table" aria-label={`${format(month, 'MMMM yyyy')} calendar`}><thead><tr>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => <th key={day} scope="col"><abbr title={day}>{day.slice(0, 3)}</abbr></th>)}</tr></thead><tbody>{Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
        const date = format(day, 'yyyy-MM-dd'), inMonth = date.startsWith(activeMonth), dates = inMonth ? byDay.get(date) ?? [] : []
        return <td key={date} className={`${inMonth ? '' : 'calendar-other-month'} ${date === today ? 'calendar-today' : ''} ${date === selectedDay ? 'calendar-selected' : ''}`}><button className="calendar-day-button" aria-label={`${format(day, 'EEEE, MMMM d, yyyy')}, ${dates.length} ${dates.length === 1 ? 'date' : 'dates'}`} aria-pressed={date === selectedDay} onClick={() => chooseDay(date)}><span className="calendar-day-number">{format(day, 'd')}{date === today && <span className="sr-only"> Today</span>}</span><span className="calendar-day-events">{dates.slice(0, 3).map(item => <span key={item.id} className={`calendar-mini-event ${item.kind} ${item.done ? 'is-done' : ''}`}><span className="calendar-kind-dot" />{item.time && <span className="calendar-mini-time">{format(new Date(item.time), 'h:mm a')} </span>}{item.title}</span>)}{dates.length > 3 && <span className="calendar-more-count">+{dates.length - 3} more</span>}</span>{dates.length > 0 && <span className="calendar-mobile-count">{dates.length}<span className="sr-only"> dates</span></span>}</button></td>
      })}</tr>)}</tbody></table></div>
      <p className="calendar-month-help small muted">Choose a day to see its full details and open a job or task.</p>
      <section className="card calendar-selected-day" aria-label="Selected day"><div className="calendar-day-heading"><h3>{fmtDate(selectedDay, 'long')}</h3>{selectedDay === today && <span className="badge soon">Today</span>}</div>{(byDay.get(selectedDay)?.length ?? 0) > 0 ? <ul className="calendar-agenda-list">{byDay.get(selectedDay)!.map(item => <AgendaRow key={item.id} item={item} today={today} siteUrl={siteUrl} />)}</ul> : <p className="calendar-empty">No dates match the current filters on this day.</p>}</section>
    </> : <div className="card calendar-agenda">
      {overdue.length > 0 && <section className="calendar-agenda-group" aria-label="Overdue open dates"><h3 className="calendar-agenda-date danger-text">Overdue <span className="calendar-group-count">{overdue.length}</span></h3><ul className="calendar-agenda-list">{overdue.map(item => <AgendaRow key={item.id} item={item} today={today} siteUrl={siteUrl} showDate />)}</ul></section>}
      {[...groupByDay(dated)].map(([date, dates]) => <section key={date} className="calendar-agenda-group" aria-label={fmtDate(date, 'long')}><h3 className="calendar-agenda-date">{fmtDate(date, 'long')}{date === today && <span className="badge soon">Today</span>}</h3><ul className="calendar-agenda-list">{dates.map(item => <AgendaRow key={item.id} item={item} today={today} siteUrl={siteUrl} />)}</ul></section>)}
      {agendaItems.length === 0 && <p className="calendar-empty">{agendaScope === 'month' ? 'No dates match the current filters in this month. Try another month or clear the filters.' : 'No dates match the current filters.'}</p>}
    </div>}
    <div className="calendar-legend" aria-label="Calendar item types">{Object.entries(labels).map(([kind, text]) => <span key={kind}><span className={`calendar-kind-dot ${kind}`} />{text}</span>)}<span className="calendar-completed-key">✓ Completed</span></div>
  </section>
}

function groupByDay(items: CalItem[]) {
  const grouped = new Map<string, CalItem[]>()
  for (const item of items) grouped.set(item.date, [...(grouped.get(item.date) ?? []), item])
  return grouped
}

function AgendaRow({ item, today, siteUrl, showDate = false }: { item: CalItem; today: string; siteUrl: string; showDate?: boolean }) {
  return <li className={`calendar-agenda-row ${item.done ? 'is-done' : ''}`}>
    <div className="calendar-row-main"><div className="calendar-row-labels"><span className={`calendar-type-label ${item.kind}`}>{labels[item.kind]}</span>{item.done ? <span className="badge complete">Completed</span> : item.date <= today && <DueBadge date={item.date} />}</div><Link className="calendar-item-link" to={item.link}>{item.title}</Link><div className="calendar-item-context">{item.clientName && <span>{item.clientName} · </span>}{item.jobName}{item.jobNumber && ` · ${item.jobNumber}`}</div><div className="calendar-item-time">{showDate && `${fmtDate(item.date, 'long')} · `}{item.time ? format(new Date(item.time), 'h:mm a') : 'All day'}</div></div>
    {!item.done && <a className="btn ghost icon calendar-google-link" href={googleCalendarLink(item, siteUrl)} target="_blank" rel="noreferrer" aria-label={`Add ${item.title} to Google Calendar`} title="Add to Google Calendar"><Icon name="external" size={15} /></a>}
  </li>
}
