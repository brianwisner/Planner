// Gantt timeline.
//  - One row per job (click the arrow to roll its phases up/down) and one per phase.
//  - The job/phase column and the date header stay visible while scrolling.
//  - Header: month · date · weekday letter (M T W R F S U) · your scheduled hours that day.
//  - Phase bars run start → due. Drag across days on a row to schedule hours
//    (opens a form listing each day); click a single day to change it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay, startOfWeek } from 'date-fns'
import { useData } from '../lib/store'
import { hoursForPhase } from '../lib/calc'
import type { Job, Phase } from '../lib/types'
import { PHASE_KIND_SHORT } from '../lib/types'
import { fmtHours, sum } from '../lib/utils'
import { Avatar, Empty, Icon } from '../components/ui'
import { ScheduleModal } from '../components/ScheduleModal'

const DAY_PX = { detailed: 40, normal: 28, zoomed: 10 }
type Zoom = keyof typeof DAY_PX
const LETTER = ['U', 'M', 'T', 'W', 'R', 'F', 'S'] // Sunday … Saturday

function loadCollapsed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem('gantt-collapsed') ?? '[]')) } catch { return new Set() }
}
function saveCollapsed(s: Set<string>) {
  try { localStorage.setItem('gantt-collapsed', JSON.stringify([...s])) } catch { /* storage unavailable */ }
}

export function Gantt({ jobs }: { jobs: Job[] }) {
  const { phases, timeEntries, schedule, profiles, me, settings, clients } = useData()
  const nav = useNavigate()
  const [zoom, setZoom] = useState<Zoom>(() => (typeof window !== 'undefined' && window.innerWidth < 760 ? 'normal' : 'detailed'))
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)
  const [who, setWho] = useState<string>(me?.id ?? '')
  const [drag, setDrag] = useState<{ rowKey: string; jobId: string; phaseId: string | null; a: number; b: number } | null>(null)
  const [modal, setModal] = useState<{ jobId: string; phaseId: string | null; from: string; to: string } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const dayW = DAY_PX[zoom]
  const today = startOfDay(new Date())

  // Visible window: from a little before the earliest date to well past the latest (and today).
  const { start, days } = useMemo(() => {
    const ds: Date[] = [addDays(today, -14), addDays(today, 90)]
    const jobIds = new Set(jobs.map(j => j.id))
    for (const j of jobs) { if (j.start_date) ds.push(parseISO(j.start_date)); if (j.due_date) ds.push(parseISO(j.due_date)) }
    for (const p of phases) if (jobIds.has(p.job_id)) { if (p.start_date) ds.push(parseISO(p.start_date)); if (p.due_date) ds.push(parseISO(p.due_date)) }
    for (const s of schedule) if (jobIds.has(s.job_id)) ds.push(parseISO(s.date))
    const min = new Date(Math.min(...ds.map(d => d.getTime())))
    const max = new Date(Math.max(...ds.map(d => d.getTime())))
    const start = startOfWeek(addDays(min, -7), { weekStartsOn: 1 })
    const end = addDays(max, 21)
    return { start, days: differenceInCalendarDays(end, start) + 1 }
  }, [jobs, phases, schedule]) // eslint-disable-line react-hooks/exhaustive-deps

  const dateAt = (i: number) => format(addDays(start, i), 'yyyy-MM-dd')
  const idxOf = (iso: string) => differenceInCalendarDays(parseISO(iso), start)
  const width = days * dayW
  const todayIdx = differenceInCalendarDays(today, start)

  // Scroll so today sits near the left edge when the chart opens or the zoom changes.
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, (todayIdx - 7) * dayW)
  }, [zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!who && me) setWho(me.id) }, [me, who])

  // Daily schedule totals for the header (the chosen person, across ALL jobs).
  const person = profiles.find(p => p.id === who)
  const dailyCap = (person?.weekly_hours || settings.weekly_capacity || 40) / 5
  const perDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of schedule) if (!who || s.user_id === who) m.set(s.date, (m.get(s.date) ?? 0) + s.hours)
    return m
  }, [schedule, who])

  // Schedule totals per row: key = phase id (or `job:<id>` for the whole job) → date → hours
  const rowSched = useMemo(() => {
    const m = new Map<string, Map<string, { hours: number; who: Set<string> }>>()
    const add = (key: string, date: string, hours: number, uid: string) => {
      let r = m.get(key); if (!r) { r = new Map(); m.set(key, r) }
      const c = r.get(date) ?? { hours: 0, who: new Set<string>() }
      c.hours += hours; c.who.add(uid); r.set(date, c)
    }
    for (const s of schedule) { add(`job:${s.job_id}`, s.date, s.hours, s.user_id); add(s.phase_id ?? `general:${s.job_id}`, s.date, s.hours, s.user_id) }
    return m
  }, [schedule])

  function toggle(id: string) {
    setCollapsed(c => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); saveCollapsed(n); return n })
  }
  function setAll(collapse: boolean) {
    const n = collapse ? new Set(jobs.map(j => j.id)) : new Set<string>()
    saveCollapsed(n); setCollapsed(n)
  }

  // ---- Drag to schedule (mouse); tap to schedule a single day (touch) ----
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  function dayFromEvent(e: RPointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(days - 1, Math.floor((e.clientX - r.left) / dayW)))
  }
  function onDown(e: RPointerEvent<HTMLDivElement>, rowKey: string, jobId: string, phaseId: string | null) {
    if (e.button !== 0) return
    if (e.pointerType === 'mouse') {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      const i = dayFromEvent(e)
      setDrag({ rowKey, jobId, phaseId, a: i, b: i })
    } else {
      touchStart.current = { x: e.clientX, y: e.clientY }
    }
  }
  function onMove(e: RPointerEvent<HTMLDivElement>, rowKey: string) {
    if (drag && drag.rowKey === rowKey) { const i = dayFromEvent(e); if (i !== drag.b) setDrag({ ...drag, b: i }) }
  }
  function onUp(e: RPointerEvent<HTMLDivElement>, jobId: string, phaseId: string | null) {
    if (e.pointerType === 'mouse') {
      if (!drag) return
      const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b)
      setDrag(null)
      setModal({ jobId: drag.jobId, phaseId: drag.phaseId, from: dateAt(a), to: dateAt(b) })
    } else if (touchStart.current) {
      const moved = Math.hypot(e.clientX - touchStart.current.x, e.clientY - touchStart.current.y)
      touchStart.current = null
      if (moved < 8) { const d = dateAt(dayFromEvent(e)); setModal({ jobId, phaseId, from: d, to: d }) }
    }
  }

  // ---- Background: day lines + weekend shading, drawn with CSS so rows stay light ----
  const grid = zoom === 'zoomed'
    ? `repeating-linear-gradient(to right, transparent 0 ${7 * dayW - 1}px, var(--border) ${7 * dayW - 1}px ${7 * dayW}px)`
    : `repeating-linear-gradient(to right, transparent 0 ${dayW - 1}px, var(--grid-line) ${dayW - 1}px ${dayW}px)`
  const weekend = `repeating-linear-gradient(to right, transparent 0 ${5 * dayW}px, var(--weekend) ${5 * dayW}px ${7 * dayW}px)`
  const rowBg = { width, backgroundImage: `${grid}, ${weekend}` }

  const bar = (s: string | null, e: string | null) => {
    if (!s && !e) return null
    const a = idxOf(s ?? e!), b = idxOf(e ?? s!)
    return { left: Math.min(a, b) * dayW, width: (Math.abs(b - a) + 1) * dayW }
  }

  function cells(key: string, kind: string) {
    const r = rowSched.get(key)
    if (!r) return null
    return [...r.entries()].map(([date, c]) => {
      const i = idxOf(date)
      if (i < 0 || i >= days) return null
      const names = [...c.who].map(id => profiles.find(p => p.id === id)?.full_name ?? '?').join(', ')
      return (
        <div key={date} className={`gsched ${kind}`} style={{ left: i * dayW + 1, width: dayW - 2 }} title={`${format(parseISO(date), 'EEE, MMM d')}: ${fmtHours(c.hours)} scheduled (${names})`}>
          {zoom !== 'zoomed' && fmtHours(c.hours).replace('h', '')}
        </div>
      )
    })
  }

  function selection(rowKey: string) {
    if (!drag || drag.rowKey !== rowKey) return null
    const a = Math.min(drag.a, drag.b), b = Math.max(drag.a, drag.b)
    return <div className="gsel" style={{ left: a * dayW, width: (b - a + 1) * dayW }}><span>{b - a + 1} day{b === a ? '' : 's'}</span></div>
  }

  function timeline(rowKey: string, jobId: string, phaseId: string | null, children: React.ReactNode) {
    return (
      <div className="gtl" style={rowBg}
        onPointerDown={e => onDown(e, rowKey, jobId, phaseId)}
        onPointerMove={e => onMove(e, rowKey)}
        onPointerUp={e => onUp(e, jobId, phaseId)}
        onPointerCancel={() => { setDrag(null); touchStart.current = null }}>
        {children}
        {selection(rowKey)}
      </div>
    )
  }

  if (jobs.length === 0) return <Empty>No jobs to show.</Empty>

  // ---- Header rows ----
  const months: { left: number; width: number; label: string }[] = []
  for (let i = 0; i < days;) {
    const d = addDays(start, i)
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const n = Math.min(days - i, differenceInCalendarDays(next, d))
    months.push({ left: i * dayW, width: n * dayW, label: format(d, n * dayW > 90 ? 'MMMM yyyy' : 'MMM') })
    i += n
  }
  const dayIdx = Array.from({ length: days }, (_, i) => i)
  const weekIdx = dayIdx.filter(i => i % 7 === 0)

  return (
    <div>
      <div className="filters">
        <div className="btn-group">
          {(['detailed', 'normal', 'zoomed'] as Zoom[]).map(z => <button key={z} className={`btn sm ${zoom === z ? 'active' : ''}`} onClick={() => setZoom(z)}>{z === 'detailed' ? 'Detailed' : z === 'normal' ? 'Normal' : 'Zoomed out'}</button>)}
        </div>
        <button className="btn sm" onClick={() => scroller.current?.scrollTo({ left: Math.max(0, (todayIdx - 7) * dayW), behavior: 'smooth' })}>Today</button>
        <button className="btn sm ghost" onClick={() => setAll(true)}>Collapse all</button>
        <button className="btn sm ghost" onClick={() => setAll(false)}>Expand all</button>
        <span className="grow" />
        <label className="small muted" style={{ margin: 0 }}>Daily hours for</label>
        <select value={who} onChange={e => setWho(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Everyone</option>
          {profiles.map(p => <option key={p.id} value={p.id}>{p.id === me?.id ? 'Me' : p.full_name}</option>)}
        </select>
      </div>
      <p className="small muted" style={{ margin: '-4px 0 10px' }}><span className="hide-mobile">Drag across days on a row to schedule hours. Click a day to change it. Bars run from a phase's start to its due date; the red line is today.</span><span className="show-mobile">Tap a day on a row to schedule hours. Swipe to scroll.</span></p>

      <div className="gantt2" ref={scroller}>
        <div className="ginner" style={{ width: `calc(var(--glabel) + ${width}px)` }}>
          {/* Header */}
          <div className="ghead">
            <div className="glabel ghead-corner">
              <span>Job / phase</span>
              <span className="tiny muted">{who ? (who === me?.id ? 'Your' : (person?.full_name.split(' ')[0] ?? '') + "'s") : 'Team'} hours ↓</span>
            </div>
            <div className="gscale" style={{ width }}>
              <div className="gmonths">{months.map(m => <div key={m.left} style={{ left: m.left, width: m.width }}><span>{m.label}</span></div>)}</div>
              {zoom === 'zoomed' ? <>
                <div className="gdates">{weekIdx.map(i => <div key={i} style={{ left: i * dayW, width: 7 * dayW }}>{format(addDays(start, i), 'MMM d')}</div>)}</div>
                <div className="ghours">{weekIdx.map(i => {
                  const t = sum(Array.from({ length: 7 }, (_, k) => perDay.get(dateAt(i + k)) ?? 0))
                  return t ? <div key={i} style={{ left: i * dayW, width: 7 * dayW }} className={t > dailyCap * 5 && who ? 'over' : ''} title={`${fmtHours(t)} scheduled that week`}>{fmtHours(t)}</div> : null
                })}</div>
              </> : <>
                <div className="gdates">{dayIdx.map(i => <div key={i} style={{ left: i * dayW, width: dayW }} className={i === todayIdx ? 'today' : ''}>{addDays(start, i).getDate()}</div>)}</div>
                <div className="gdow">{dayIdx.map(i => { const d = addDays(start, i); return <div key={i} style={{ left: i * dayW, width: dayW }} className={d.getDay() === 0 || d.getDay() === 6 ? 'we' : ''}>{LETTER[d.getDay()]}</div> })}</div>
                <div className="ghours">{dayIdx.map(i => {
                  const t = perDay.get(dateAt(i)) ?? 0
                  return t ? <div key={i} style={{ left: i * dayW, width: dayW }} className={t > dailyCap && who ? 'over' : ''} title={`${fmtHours(t)} scheduled`}>{fmtHours(t).replace('h', '')}</div> : null
                })}</div>
              </>}
            </div>
          </div>

          {/* Body */}
          <div className="gbody">
            {todayIdx >= 0 && todayIdx < days && <div className="gtoday" style={{ left: `calc(var(--glabel) + ${todayIdx * dayW + dayW / 2}px)` }} />}
            {jobs.map(j => {
              const jp = phases.filter(p => p.job_id === j.id)
              const isOpen = !collapsed.has(j.id)
              const client = clients.find(c => c.id === j.client_id)?.name
              const jb = bar(j.start_date, j.due_date)
              const jobSched = sum([...(rowSched.get(`job:${j.id}`)?.values() ?? [])].map(c => c.hours))
              return (
                <div key={j.id} className="gjob">
                  <div className="grow2 gjobrow">
                    <div className="glabel">
                      <button className="gtoggle" onClick={() => toggle(j.id)} aria-label={isOpen ? 'Roll up phases' : 'Show phases'} aria-expanded={isOpen}>
                        <span style={{ display: 'inline-block', transform: `rotate(${isOpen ? 90 : 0}deg)`, transition: 'transform .15s' }}><Icon name="chevronR" size={14} /></span>
                      </button>
                      <div className="gjobtext" onClick={() => nav(`/jobs/${j.id}`)} title={`${client ?? ''} — ${j.name}`}>
                        <div className="tiny muted gclip">{client}{j.job_number ? ` · ${j.job_number}` : ''}</div>
                        <div className="gjobname">{j.name}</div>
                        {!isOpen && jobSched > 0 && <div className="tiny muted">{fmtHours(jobSched)} scheduled</div>}
                      </div>
                    </div>
                    {timeline(`job:${j.id}`, j.id, null, <>
                      {jb && <div className="gbar2 job" style={jb} />}
                      {!isOpen && jp.map((p, k) => { const b = bar(p.start_date, p.due_date); return b && <div key={p.id} className={`gmini ${p.kind} ${p.status}`} style={{ ...b, top: 30 + (k % 2) * 5 }} title={`${p.name}: ${p.start_date ?? '?'} → ${p.due_date ?? '?'}`} /> })}
                      {cells(`job:${j.id}`, 'job')}
                    </>)}
                  </div>
                  {isOpen && jp.map(p => <PhaseRow key={p.id} p={p} logged={hoursForPhase(timeEntries, p.id)} sched={sum([...(rowSched.get(p.id)?.values() ?? [])].map(c => c.hours))}>
                    {timeline(p.id, j.id, p.id, <>
                      {(() => { const b = bar(p.start_date, p.due_date); return b && <div className={`gbar2 ${p.kind} ${p.status}`} style={b} title={`${p.name}: ${p.start_date ?? '?'} → ${p.due_date ?? '?'} · ${p.estimate_hours}h est`} /> })()}
                      {cells(p.id, p.kind)}
                    </>)}
                  </PhaseRow>)}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {modal && <ScheduleModal {...modal} onClose={() => setModal(null)} />}
    </div>
  )
}

function PhaseRow({ p, logged, sched, children }: { p: Phase; logged: number; sched: number; children: React.ReactNode }) {
  return (
    <div className="grow2 gphaserow">
      <div className="glabel gphase">
        <span className={`gdot ${p.kind}`} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="gclip">{PHASE_KIND_SHORT[p.kind]}</div>
          <div className="tiny muted gclip">{fmtHours(sched)} sched · {fmtHours(logged)}/{fmtHours(p.estimate_hours)} est</div>
        </div>
        <Avatar userId={p.assignee_id} size="sm" />
      </div>
      {children}
    </div>
  )
}
