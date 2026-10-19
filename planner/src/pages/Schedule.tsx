// Schedule: plan the week, see the timeline of phases, or browse the calendar.
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, GanttChart, LayoutList } from 'lucide-react'
import { WeekPlanner } from '../views/WeekPlanner'
import { Timeline } from '../views/Timeline'
import { MonthCalendar } from '../views/MonthCalendar'
import { Segmented } from '../components/ui'
import { mondayOf } from '../lib/views'
import { pref, setPref } from '../lib/theme'
import { todayISO } from '../lib/utils'

type View = 'week' | 'timeline' | 'month'
const LEDE: Record<View, string> = {
  week: 'Type the hours you plan to spend on each job. Totals show against the time you have.',
  timeline: 'Phases on a calendar — drag bars to change dates.',
  month: 'Deadlines, tasks and site visits. Click a day to add a task.',
}

export function Schedule() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view: View = raw === 'week' || raw === 'timeline' || raw === 'month' ? raw : pref<View>('schedule.view', 'week')
  const today = todayISO()
  const week = /^\d{4}-\d{2}-\d{2}$/.test(params.get('week') ?? '') ? params.get('week')! : mondayOf(today)
  const month = /^\d{4}-\d{2}$/.test(params.get('month') ?? '') ? params.get('month')! : today.slice(0, 7)
  const patch = (next: Record<string, string | null>) => setParams(p => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(next)) { if (v == null) n.delete(k); else n.set(k, v) }
    return n
  }, { replace: true })
  return <div className="schedule-page">
    <div className="page-head">
      <div className="titles"><h1>Schedule</h1><p className="lede">{LEDE[view]}</p></div>
      <div className="actions">
        <Segmented label="View" value={view} onChange={v => { setPref('schedule.view', v); patch({ view: v }) }} options={[
          { value: 'week', label: 'Week plan', icon: <LayoutList size={15} /> },
          { value: 'timeline', label: 'Timeline', icon: <GanttChart size={15} /> },
          { value: 'month', label: 'Calendar', icon: <CalendarDays size={15} /> },
        ]} />
      </div>
    </div>
    {view === 'week' && <WeekPlanner week={week} onWeek={w => patch({ week: w === mondayOf(today) ? null : w })} />}
    {view === 'timeline' && <Timeline />}
    {view === 'month' && <MonthCalendar month={month} onMonth={m => patch({ month: m === today.slice(0, 7) ? null : m })} />}
  </div>
}
