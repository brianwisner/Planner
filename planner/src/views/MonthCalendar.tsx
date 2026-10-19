// Month calendar (and an agenda list, the default on phones): deadlines,
// tasks and site visits. Click a day to add a task on it.
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import { CalendarClock, ChevronLeft, ChevronRight, Download, ExternalLink, MapPin, Plus } from 'lucide-react'
import { useData } from '../lib/store'
import { buildICS, calendarItems, googleCalendarLink, type CalItem } from '../lib/calendar'
import { jobStage } from '../lib/stages'
import { downloadText, todayISO } from '../lib/utils'
import { useEditors } from '../components/editors'
import { Segmented } from '../components/ui'
import './month.css'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export function MonthCalendar({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const store = useData()
  const edit = useEditors()
  const navigate = useNavigate()
  const today = todayISO()
  const phone = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches
  const [mode, setMode] = useState<'month' | 'agenda'>(phone ? 'agenda' : 'month')
  const [showDone, setShowDone] = useState(false)
  const first = startOfMonth(parseISO(month + '-01'))
  const gridStart = addDays(first, -((first.getDay() + 6) % 7))
  const last = endOfMonth(first)
  const weeks = Math.ceil((((first.getDay() + 6) % 7) + last.getDate()) / 7)
  const items = useMemo(() => calendarItems(store).filter(i => showDone || !i.done), [store, showDone])
  const byDate = useMemo(() => {
    const m = new Map<string, CalItem[]>()
    for (const i of items) { const a = m.get(i.date) ?? []; a.push(i); m.set(i.date, a) }
    return m
  }, [items])

  const open = (i: CalItem) => {
    if (i.kind === 'task' || i.kind === 'site_visit') { const t = store.tasks.find(t => `task-${t.id}` === i.id); if (t) { edit.task(t); return } }
    navigate(i.link)
  }
  const stageOf = (i: CalItem) => jobStage(store.phases, i.jobId).stage
  const monthLabel = format(first, 'MMMM yyyy')
  function download() {
    const from = iso(first), to = iso(last)
    downloadText(`calendar-${month}.ics`, buildICS(items.filter(i => i.date >= from && i.date <= to && !i.done), `${store.settings.company_name} — ${monthLabel}`), 'text/calendar')
  }

  const agendaDays = (() => {
    const from = mode === 'agenda' && month === today.slice(0, 7) ? today : iso(first)
    const to = iso(addDays(parseISO(from), 45))
    return [...byDate.entries()].filter(([d]) => d >= from && d <= to).sort(([a], [b]) => a.localeCompare(b))
  })()

  return <div className="month-view">
    <div className="toolbar">
      <div className="btn-group">
        <button className="btn icon" aria-label="Previous month" onClick={() => onMonth(format(addMonths(first, -1), 'yyyy-MM'))}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => onMonth(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>Today</button>
        <button className="btn icon" aria-label="Next month" onClick={() => onMonth(format(addMonths(first, 1), 'yyyy-MM'))}><ChevronRight size={18} /></button>
      </div>
      <strong className="week-label">{monthLabel}</strong>
      <div className="grow" />
      <Segmented size="sm" label="Layout" value={mode} onChange={setMode} options={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'List' }]} />
      <label className="switch small"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} />Show done</label>
      <button className="btn sm" onClick={download} title="Download this month's open items as a calendar file"><Download size={14} /> .ics</button>
      <Link className="btn sm ghost" to="/settings#calendar">Sync with Google Calendar</Link>
    </div>

    {mode === 'month' ? <div className="card month-card">
      <div className="month-grid head">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="mg-dow">{d}</div>)}</div>
      <div className="month-grid" style={{ gridTemplateRows: `repeat(${weeks}, minmax(112px, 1fr))` }}>
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const d = addDays(gridStart, i)
          const key = iso(d)
          const list = byDate.get(key) ?? []
          const other = d.getMonth() !== first.getMonth()
          const weekend = d.getDay() === 0 || d.getDay() === 6
          return <div key={key} className={`mg-day ${other ? 'other' : ''} ${weekend ? 'weekend' : ''} ${key === today ? 'today' : ''} ${key < today ? 'past' : ''}`}>
            <div className="mg-top">
              <span className="mg-num">{d.getDate()}</span>
              <button className="mg-add" aria-label={`Add a task on ${format(d, 'MMMM d')}`} onClick={() => edit.task(undefined, { due_date: key })}><Plus size={13} /></button>
            </div>
            <div className="mg-items">
              {list.slice(0, 4).map(it => <button key={it.id} className={`mg-item k-${it.kind} ${it.done ? 'done' : ''}`} data-stage={stageOf(it)} onClick={() => open(it)} title={`${it.title} — ${it.jobName}`}>
                {it.kind === 'site_visit' ? <MapPin size={11} /> : it.kind !== 'task' ? <CalendarClock size={11} /> : <span className="mg-dot" />}
                <span className="truncate">{it.time ? `${format(new Date(it.time), 'h:mma').toLowerCase()} ` : ''}{it.kind === 'task' || it.kind === 'site_visit' ? it.title : it.title.replace(/ — .*/, '')}</span>
              </button>)}
              {list.length > 4 && <button className="mg-more" onClick={() => setMode('agenda')}>+{list.length - 4} more</button>}
            </div>
          </div>
        })}
      </div>
    </div> : <div className="card">
      {agendaDays.length === 0 && <div className="empty"><h3>Nothing scheduled</h3><p>Deadlines, tasks and site visits will show up here.</p></div>}
      {agendaDays.map(([date, list]) => <div key={date} className="agenda-day">
        <div className={`agenda-date ${date === today ? 'today' : ''} ${date < today ? 'past' : ''}`}><span className="ad-dow">{format(parseISO(date), 'EEE')}</span><span className="ad-num">{format(parseISO(date), 'd')}</span><span className="ad-mon">{format(parseISO(date), 'MMM')}</span></div>
        <div className="agenda-items">{list.map(it => <div key={it.id} className={`agenda-item k-${it.kind} ${it.done ? 'done' : ''}`} data-stage={stageOf(it)}>
          <button className="ai-main" onClick={() => open(it)}>
            <span className="ai-kind">{it.kind === 'site_visit' ? <MapPin size={14} /> : it.kind === 'task' ? <span className="mg-dot" /> : <CalendarClock size={14} />}</span>
            <span className="grow" style={{ minWidth: 0 }}><span className="strong" style={{ display: 'block' }}>{it.time && `${format(new Date(it.time), 'h:mm a')} · `}{it.title}</span><span className="tiny muted">{[it.jobName, it.clientName].filter(Boolean).join(' · ')}</span></span>
          </button>
          <a className="btn ghost icon xs" href={googleCalendarLink(it, window.location.href.split('#')[0])} target="_blank" rel="noreferrer" title="Add to Google Calendar" aria-label={`Add ${it.title} to Google Calendar`}><ExternalLink size={14} /></a>
        </div>)}</div>
      </div>)}
    </div>}
  </div>
}
