// Gantt timeline: one row per job with a bar per phase. Scroll sideways.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, differenceInCalendarDays, eachMonthOfInterval, endOfMonth, format, parseISO, startOfMonth, startOfDay } from 'date-fns'
import { useData } from '../lib/store'
import { hoursForPhase } from '../lib/calc'
import type { Job, Phase } from '../lib/types'
import { PHASE_KIND_SHORT } from '../lib/types'
import { Empty } from '../components/ui'

const DAY_PX = { week: 28, month: 10, quarter: 4 }
type Zoom = keyof typeof DAY_PX

export function Gantt({ jobs }: { jobs: Job[] }) {
  const { phases, timeEntries } = useData()
  const nav = useNavigate()
  const [zoom, setZoom] = useState<Zoom>('month')
  const dayPx = DAY_PX[zoom]
  const today = startOfDay(new Date())

  // The visible window: from the earliest start to the latest due date, padded.
  const { start, end, months } = useMemo(() => {
    const dates: Date[] = [today]
    for (const j of jobs) {
      if (j.start_date) dates.push(parseISO(j.start_date))
      if (j.due_date) dates.push(parseISO(j.due_date))
      for (const p of phases.filter(p => p.job_id === j.id)) {
        if (p.start_date) dates.push(parseISO(p.start_date))
        if (p.due_date) dates.push(parseISO(p.due_date))
      }
    }
    const min = new Date(Math.min(...dates.map(d => d.getTime())))
    const max = new Date(Math.max(...dates.map(d => d.getTime())))
    const start = startOfMonth(addDays(min, -7))
    const end = endOfMonth(addDays(max, 21))
    return { start, end, months: eachMonthOfInterval({ start, end }) }
  }, [jobs, phases, today])

  const x = (d: Date) => differenceInCalendarDays(d, start) * dayPx
  const totalW = x(end) + dayPx

  function barFor(p: Phase, job: Job) {
    // Phases with no dates fall back to the job's dates; no dates = no bar.
    const s = p.start_date ?? (p.due_date ? null : job.start_date)
    const e = p.due_date ?? (p.start_date ? null : job.due_date)
    if (!s && !e) return null
    const sd = s ? parseISO(s) : addDays(parseISO(e!), -7)
    const ed = e ? parseISO(e) : addDays(parseISO(s!), 7)
    const left = x(sd)
    const width = Math.max(dayPx, x(addDays(ed, 1)) - left)
    const logged = hoursForPhase(timeEntries, p.id)
    const pct = p.status === 'complete' ? 100 : p.estimate_hours ? Math.min(100, (logged / p.estimate_hours) * 100) : 0
    return { left, width, pct }
  }

  if (jobs.length === 0) return <Empty>No jobs to show.</Empty>

  return (
    <div>
      <div className="filters">
        <div className="btn-group">
          {(['week', 'month', 'quarter'] as Zoom[]).map(z => <button key={z} className={`btn sm ${zoom === z ? 'active' : ''}`} onClick={() => setZoom(z)}>{z === 'week' ? 'Detailed' : z === 'month' ? 'Normal' : 'Zoomed out'}</button>)}
        </div>
        <span className="small muted">Bars show each phase from start to due date. The shaded part of a bar is hours used vs. estimate. Red line = today.</span>
      </div>
      <div className="gantt card" style={{ padding: 0 }}>
        <div className="gantt-inner" style={{ minWidth: 240 + totalW }}>
          <div className="labels">
            <div className="rowlabel" style={{ fontWeight: 600 }}>Job / phase</div>
            {jobs.map(j => (
              <div key={j.id}>
                <div className="rowlabel job" onClick={() => nav(`/jobs/${j.id}`)} style={{ cursor: 'pointer' }} title={j.name}>{j.name}</div>
                {phases.filter(p => p.job_id === j.id).map(p => <div key={p.id} className="rowlabel phase">{PHASE_KIND_SHORT[p.kind]}</div>)}
              </div>
            ))}
          </div>
          <div className="timeline" style={{ width: totalW }}>
            <div className="months">
              {months.map(m => {
                const ms = m < start ? start : m
                const me = endOfMonth(m) > end ? end : endOfMonth(m)
                return <div key={m.toISOString()} className="month" style={{ width: x(addDays(me, 1)) - x(ms) }}>{format(m, zoom === 'quarter' ? 'MMM' : 'MMMM yyyy')}</div>
              })}
            </div>
            {zoom !== 'quarter' && Array.from({ length: differenceInCalendarDays(end, start) + 1 }, (_, i) => addDays(start, i)).filter(d => d.getDay() === 0 || d.getDay() === 6).map(d => (
              <div key={d.toISOString()} className="weekend" style={{ left: x(d), width: dayPx }} />
            ))}
            <div className="today" style={{ left: x(today) }} title="Today" />
            {jobs.map(j => (
              <div key={j.id}>
                <div className="grow-row job">
                  {j.start_date && j.due_date && (
                    <div className="gbar job" style={{ left: x(parseISO(j.start_date)), width: Math.max(dayPx, x(addDays(parseISO(j.due_date), 1)) - x(parseISO(j.start_date))) }} onClick={() => nav(`/jobs/${j.id}`)} title={`${j.name}: ${j.start_date} → ${j.due_date}`} />
                  )}
                </div>
                {phases.filter(p => p.job_id === j.id).map(p => {
                  const b = barFor(p, j)
                  return (
                    <div key={p.id} className="grow-row">
                      {b && (
                        <div className={`gbar ${p.kind} ${p.status}`} style={{ left: b.left, width: b.width }} onClick={() => nav(`/jobs/${j.id}`)} title={`${p.name}: ${p.start_date ?? '?'} → ${p.due_date ?? '?'} · ${p.estimate_hours}h est`}>
                          <span className="fill" style={{ width: `${b.pct}%` }} />
                          <span style={{ position: 'relative' }}>{zoom !== 'quarter' && `${PHASE_KIND_SHORT[p.kind]} · ${p.estimate_hours}h`}</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
