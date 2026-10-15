// Stand-alone calendar page (also reachable from the Jobs page).
import { useMemo, useState } from 'react'
import { useData } from '../lib/store'
import { buildICS, calendarItems } from '../lib/calendar'
import { downloadText } from '../lib/utils'
import { CalendarView } from '../views/CalendarView'
import { Icon } from '../components/ui'
import { Link } from 'react-router-dom'

export function CalendarPage() {
  const store = useData()
  const { me, profiles } = store
  const [who, setWho] = useState('')
  const [kinds, setKinds] = useState({ phase: true, task: true, site_visit: true, job: true })
  const items = useMemo(() => calendarItems(store).filter(i => kinds[i.kind] && (!who || i.assigneeId === who || i.assigneeId == null)), [store, who, kinds])

  return (
    <div>
      <div className="page-header">
        <h1>Calendar</h1>
        <div className="actions">
          <button className="btn" onClick={() => downloadText('wisner-planner.ics', buildICS(items.filter(i => !i.done), 'Wisner Planner'), 'text/calendar')}><Icon name="download" size={16} /> Download .ics</button>
          <Link className="btn" to="/settings#calendar">Google Calendar sync</Link>
        </div>
      </div>
      <div className="filters">
        <select value={who} onChange={e => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.id === me?.id ? 'Me' : p.full_name}</option>)}
        </select>
        {(['phase', 'task', 'site_visit', 'job'] as const).map(k => (
          <button key={k} className={`chip ${kinds[k] ? 'on' : ''}`} onClick={() => setKinds(x => ({ ...x, [k]: !x[k] }))}>{k === 'phase' ? 'Phase deadlines' : k === 'task' ? 'Tasks' : k === 'site_visit' ? 'Site visits' : 'Job deadlines'}</button>
        ))}
      </div>
      <CalendarView items={items} />
    </div>
  )
}
