// Stand-alone calendar page (also reachable from the Jobs page).
import { useMemo, useState } from 'react'
import { useData } from '../lib/store'
import { buildICS, calendarItems, googleToCalItems } from '../lib/calendar'
import { useGoogleEvents } from '../lib/google'
import { addDays, subDays } from 'date-fns'
import { downloadText } from '../lib/utils'
import { CalendarView } from '../views/CalendarView'
import { Icon } from '../components/ui'
import { Link } from 'react-router-dom'

export function CalendarPage() {
  const store = useData()
  const { me, profiles, googleConnected } = store
  const [who, setWho] = useState('')
  const [kinds, setKinds] = useState({ phase: true, task: true, site_visit: true, job: true, google: true })
  const [range] = useState(() => ({ from: subDays(new Date(), 45).toISOString(), to: addDays(new Date(), 120).toISOString() }))
  const google = useGoogleEvents(googleConnected && kinds.google, range.from, range.to, me?.google_calendar_ids ?? [])
  const items = useMemo(() => {
    const mine = googleToCalItems(google.events, me?.id ?? null)
    return [...calendarItems(store), ...mine].filter(i => kinds[i.kind] && (!who || i.assigneeId === who || i.assigneeId == null)).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
  }, [store, who, kinds, google.events, me?.id])

  return (
    <div>
      <div className="page-header">
        <h1>Calendar</h1>
        <div className="actions">
          <button className="btn" onClick={() => downloadText('wisner-planner.ics', buildICS(items.filter(i => !i.done && i.kind !== 'google'), 'Wisner Planner'), 'text/calendar')}><Icon name="download" size={16} /> Download .ics</button>
          <Link className="btn" to="/settings#calendar">Google Calendar sync</Link>
        </div>
      </div>
      <div className="filters">
        <select value={who} onChange={e => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.id === me?.id ? 'Me' : p.full_name}</option>)}
        </select>
        {(['phase', 'task', 'site_visit', 'job', 'google'] as const).filter(k => k !== 'google' || googleConnected).map(k => (
          <button key={k} className={`chip ${kinds[k] ? 'on' : ''}`} onClick={() => setKinds(x => ({ ...x, [k]: !x[k] }))}>{k === 'phase' ? 'Phase deadlines' : k === 'task' ? 'Tasks' : k === 'site_visit' ? 'Site visits' : k === 'job' ? 'Job deadlines' : 'My Google Calendar'}</button>
        ))}
        {!googleConnected && <Link className="chip" to="/settings#google">+ Show my Google Calendar</Link>}
        {google.error && google.error !== 'not_connected' && <span className="small danger-text">Google Calendar: {google.error}</span>}
      </div>
      <CalendarView items={items} />
      {googleConnected && <p className="small muted mt">Google Calendar events are only visible to the person whose calendar it is.</p>}
    </div>
  )
}
