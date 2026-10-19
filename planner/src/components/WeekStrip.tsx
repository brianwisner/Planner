// Seven small columns: planned hours against what you can work each day.
import type { WeekDay } from '../lib/views'
import { fmtHours } from '../lib/utils'
import './week-strip.css'

const LETTER = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function WeekStrip({ days, onPick }: { days: WeekDay[]; onPick?: (date: string) => void }) {
  const max = Math.max(8, ...days.map(d => Math.max(d.planned, d.logged, d.capacity)))
  return <div className="week-strip" role="list" aria-label="Hours planned this week">
    {days.map((d, i) => {
      const over = d.capacity > 0 ? d.planned > d.capacity + 0.01 : d.planned > 0
      const label = `${new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}: ${fmtHours(d.planned)} planned of ${fmtHours(d.capacity)}, ${fmtHours(d.logged)} logged`
      const body = <>
        <div className="ws-bar" aria-hidden="true">
          {d.capacity > 0 && <span className="ws-cap" style={{ bottom: `${(d.capacity / max) * 100}%` }} />}
          <span className={`ws-planned ${over ? 'over' : ''}`} style={{ height: `${(d.planned / max) * 100}%` }} />
          {d.logged > 0 && <span className="ws-logged" style={{ height: `${(d.logged / max) * 100}%` }} />}
        </div>
        <span className="ws-hours num">{d.planned ? fmtHours(d.planned) : '–'}</span>
        <span className="ws-day">{LETTER[i]}<span className="ws-date">{Number(d.date.slice(8))}</span></span>
      </>
      return onPick
        ? <button key={d.date} role="listitem" className={`ws-col ${d.isToday ? 'today' : ''} ${d.weekend ? 'weekend' : ''}`} title={label} aria-label={label} onClick={() => onPick(d.date)}>{body}</button>
        : <div key={d.date} role="listitem" className={`ws-col ${d.isToday ? 'today' : ''} ${d.weekend ? 'weekend' : ''}`} title={label} aria-label={label}>{body}</div>
    })}
  </div>
}
