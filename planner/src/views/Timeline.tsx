// Timeline: each job's phases as bars on a calendar. Drag a bar to move it,
// drag either end to change its start or due date, or click an empty row to
// give a phase dates.
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { addDays, differenceInCalendarDays, format, parseISO, startOfMonth } from 'date-fns'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useData } from '../lib/store'
import { jobPhaseGroups, phaseLabel } from '../lib/phases'
import { jobStage } from '../lib/stages'
import { hoursForPhase } from '../lib/calc'
import { mondayOf } from '../lib/views'
import { fmtDate, fmtHours, todayISO } from '../lib/utils'
import { pref, setPref } from '../lib/theme'
import { Segmented, useConfirm } from '../components/ui'
import type { Phase } from '../lib/types'
import './timeline.css'

type Zoom = 'weeks' | 'months'
const DAY_W: Record<Zoom, number> = { weeks: 30, months: 9 }
const SPAN: Record<Zoom, number> = { weeks: 70, months: 182 }
const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export function Timeline() {
  const store = useData()
  const { jobs, phases, clients, schedule } = store
  const today = todayISO()
  const [zoom, setZoomState] = useState<Zoom>(() => pref('timeline.zoom', 'weeks'))
  const setZoom = (z: Zoom) => { setZoomState(z); setPref('timeline.zoom', z) }
  const [start, setStart] = useState(() => iso(addDays(parseISO(mondayOf(today)), -14)))
  const [collapsed, setCollapsedState] = useState<string[]>(() => pref('timeline.collapsed', []))
  const setCollapsed = (ids: string[]) => { setCollapsedState(ids); setPref('timeline.collapsed', ids) }
  const [showHold, setShowHold] = useState(false)
  const dayW = DAY_W[zoom]
  const days = SPAN[zoom]
  const startDate = parseISO(start)
  const width = days * dayW
  const x = (date: string) => differenceInCalendarDays(parseISO(date), startDate) * dayW
  const visibleJobs = jobs.filter(j => j.status === 'active' || (showHold && j.status === 'on_hold'))

  const months = (() => {
    const out: { x: number; label: string }[] = []
    for (let d = startOfMonth(startDate); differenceInCalendarDays(d, startDate) < days; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      out.push({ x: Math.max(0, differenceInCalendarDays(d, startDate) * dayW), label: format(d, zoom === 'weeks' ? 'MMMM yyyy' : 'MMM yyyy') })
    }
    return out
  })()
  const ticks = Array.from({ length: days }, (_, i) => addDays(startDate, i))
  const todayX = x(today)
  const shift = (n: number) => setStart(iso(addDays(startDate, n)))
  const allCollapsed = visibleJobs.every(j => collapsed.includes(j.id))

  return <div className="timeline">
    <div className="toolbar">
      <div className="btn-group">
        <button className="btn icon" aria-label="Earlier" onClick={() => shift(zoom === 'weeks' ? -14 : -56)}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => setStart(iso(addDays(parseISO(mondayOf(today)), -14)))}>Today</button>
        <button className="btn icon" aria-label="Later" onClick={() => shift(zoom === 'weeks' ? 14 : 56)}><ChevronRight size={18} /></button>
      </div>
      <Segmented size="sm" label="Zoom" value={zoom} onChange={setZoom} options={[{ value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }]} />
      <div className="grow" />
      <label className="switch small"><input type="checkbox" checked={showHold} onChange={e => setShowHold(e.target.checked)} />Show on-hold jobs</label>
      <button className="btn sm ghost" onClick={() => setCollapsed(allCollapsed ? [] : visibleJobs.map(j => j.id))}>{allCollapsed ? <><ChevronsUpDown size={15} /> Expand all</> : <><ChevronsDownUp size={15} /> Collapse all</>}</button>
    </div>

    <div className="card tl-card">
      <div className="tl-scroll">
        <div className="tl-grid" style={{ ['--tl-w' as string]: `${width}px`, ['--day-w' as string]: `${dayW}px` }}>
          <div className="tl-head">
            <div className="tl-label tl-head-label">Job / phase</div>
            <div className="tl-track tl-head-track" style={{ width }}>
              <div className="tl-months">{months.map(m => <span key={m.x} style={{ left: m.x }}>{m.label}</span>)}</div>
              <div className="tl-days">{ticks.map((d, i) => {
                const wd = d.getDay()
                const show = zoom === 'weeks' ? true : wd === 1
                return show ? <span key={i} className={`${wd === 0 || wd === 6 ? 'we' : ''} ${iso(d) === today ? 'now' : ''}`} style={{ left: i * dayW, width: zoom === 'weeks' ? dayW : dayW * 7 }}>{zoom === 'weeks' ? <><b>{'SMTWTFS'[wd]}</b>{d.getDate()}</> : format(d, 'd')}</span> : null
              })}</div>
            </div>
          </div>
          {visibleJobs.map(job => {
            const st = jobStage(phases, job.id)
            const wf = jobPhaseGroups(phases, job.id).workflow
            const isCollapsed = collapsed.includes(job.id)
            const dated = wf.filter(p => p.start_date || p.due_date)
            const spanStart = dated.map(p => p.start_date ?? p.due_date!).sort()[0]
            const spanEnd = dated.map(p => p.due_date ?? p.start_date!).sort().pop()
            const plans = schedule.filter(s => s.job_id === job.id)
            return <div key={job.id} className="tl-job" data-stage={job.status === 'active' ? st.stage : 'hold'}>
              <div className="tl-row tl-job-row">
                <div className="tl-label">
                  <button className="tl-toggle" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Show' : 'Hide'} phases for ${job.name}`} onClick={() => setCollapsed(isCollapsed ? collapsed.filter(id => id !== job.id) : [...collapsed, job.id])}><ChevronDown size={16} /></button>
                  <span className="dot" style={{ background: 'var(--stage)' }} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <Link to={`/jobs/${job.id}`} className="tl-job-name truncate">{job.name}</Link>
                    <span className="tl-job-sub truncate">{clients.find(c => c.id === job.client_id)?.name}</span>
                  </span>
                </div>
                <div className="tl-track" style={{ width }}>
                  <Backdrop ticks={ticks} dayW={dayW} />
                  {spanStart && spanEnd && <div className="tl-span" style={{ left: x(spanStart), width: Math.max(dayW, x(spanEnd) - x(spanStart) + dayW) }} />}
                  {plans.map(s => { const left = x(s.date); return left >= 0 && left < width ? <span key={s.id} className="tl-plan" title={`${fmtHours(s.hours)} planned ${fmtDate(s.date)}`} style={{ left: left + 2, width: Math.max(3, dayW - 4), height: Math.min(14, 3 + s.hours * 1.4) }} /> : null })}
                  {job.due_date && x(job.due_date) >= 0 && x(job.due_date) < width && <span className="tl-due" title={`Job due ${fmtDate(job.due_date, 'long')}`} style={{ left: x(job.due_date) + dayW / 2 }} />}
                </div>
              </div>
              {!isCollapsed && wf.map(p => <PhaseRow key={p.id} phase={p} x={x} dayW={dayW} width={width} ticks={ticks} startDate={startDate} />)}
            </div>
          })}
          {todayX >= 0 && todayX < width && <div className="tl-now" style={{ left: `calc(var(--tl-label-w) + ${todayX + dayW / 2}px)` }} aria-hidden="true" />}
        </div>
      </div>
    </div>
    <p className="tiny muted mt">Drag a bar to move a phase; drag its ends to change the start or due date. Click an empty row to give a phase dates. The small blue marks on each job are planned hours.</p>
  </div>
}

function Backdrop({ ticks, dayW }: { ticks: Date[]; dayW: number }) {
  return <div className="tl-backdrop" style={{ backgroundSize: `${dayW * 7}px 100%`, backgroundPositionX: `${-((ticks[0].getDay() + 6) % 7) * dayW}px` }} />
}

function PhaseRow({ phase, x, dayW, width, ticks, startDate }: { phase: Phase; x: (d: string) => number; dayW: number; width: number; ticks: Date[]; startDate: Date }) {
  const store = useData()
  const confirm = useConfirm()
  const [drag, setDrag] = useState<{ mode: 'move' | 'start' | 'end'; originX: number; delta: number } | null>(null)
  const moved = useRef(false)
  const s = phase.start_date ?? phase.due_date
  const e = phase.due_date ?? phase.start_date
  const stageKey = phase.kind === 'client_changes' ? 'client_changes' : phase.kind
  const logged = hoursForPhase(store.timeEntries, phase.id)

  const preview = (() => {
    if (!s || !e) return null
    let a = parseISO(s), b = parseISO(e)
    if (drag) {
      if (drag.mode === 'move') { a = addDays(a, drag.delta); b = addDays(b, drag.delta) }
      if (drag.mode === 'start') { a = addDays(a, drag.delta); if (a > b) a = b }
      if (drag.mode === 'end') { b = addDays(b, drag.delta); if (b < a) b = a }
    }
    return { a: iso(a), b: iso(b) }
  })()

  function down(ev: ReactPointerEvent, mode: 'move' | 'start' | 'end') {
    ev.stopPropagation()
    ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
    moved.current = false
    setDrag({ mode, originX: ev.clientX, delta: 0 })
  }
  function move(ev: ReactPointerEvent) {
    if (!drag) return
    const delta = Math.round((ev.clientX - drag.originX) / dayW)
    if (delta !== drag.delta) { moved.current = true; setDrag({ ...drag, delta }) }
  }
  async function up() {
    if (!drag || !preview) { setDrag(null); return }
    const before = { start_date: phase.start_date, due_date: phase.due_date }
    const next = { start_date: phase.start_date ? preview.a : null, due_date: phase.due_date ? preview.b : null }
    if (!phase.start_date && drag.mode !== 'end') next.due_date = preview.b
    if (!phase.due_date && drag.mode !== 'start') next.start_date = preview.a
    setDrag(null)
    if (next.start_date === before.start_date && next.due_date === before.due_date) return
    if (await store.update('phases', phase.id, next)) store.toast(`${phase.name}: ${fmtDate(next.start_date ?? next.due_date)} → ${fmtDate(next.due_date ?? next.start_date)}`, 'ok', { label: 'Undo', run: () => store.update('phases', phase.id, before) })
  }
  async function setDates(ev: React.MouseEvent<HTMLDivElement>) {
    if (s || e) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const day = Math.floor((ev.clientX - rect.left) / dayW)
    const start = iso(addDays(startDate, day))
    const due = iso(addDays(startDate, day + 9))
    if (!await confirm({ title: `Give ${phase.name} dates?`, body: `${fmtDate(start, 'long')} to ${fmtDate(due, 'long')}. You can drag the bar or its ends afterwards.`, confirmLabel: 'Set dates' })) return
    if (await store.update('phases', phase.id, { start_date: start, due_date: due })) store.toast(`${phase.name}: ${fmtDate(start)} – ${fmtDate(due)}`, 'ok', { label: 'Undo', run: () => store.update('phases', phase.id, { start_date: null, due_date: null }) })
  }

  return <div className={`tl-row tl-phase-row ${phase.status}`} data-stage={stageKey}>
    <div className="tl-label tl-phase-label">
      <span className="grow truncate">{phaseLabel(phase)}</span>
      <span className="tl-phase-hours num">{phase.estimate_hours > 0 ? `${fmtHours(logged)}/${fmtHours(phase.estimate_hours)}` : logged ? fmtHours(logged) : ''}</span>
    </div>
    <div className={`tl-track ${!s ? 'tl-unset' : ''}`} style={{ width }} onClick={e2 => void setDates(e2)} title={!s ? 'Click to give this phase dates' : undefined}>
      <Backdrop ticks={ticks} dayW={dayW} />
      {preview && <div className={`tl-bar ${drag ? 'dragging' : ''}`} style={{ left: x(preview.a), width: Math.max(dayW, x(preview.b) - x(preview.a) + dayW) }}
        onPointerDown={ev => down(ev, 'move')} onPointerMove={move} onPointerUp={() => void up()} onPointerCancel={() => setDrag(null)}
        title={`${phaseLabel(phase)}: ${fmtDate(preview.a)} – ${fmtDate(preview.b)}`} role="slider" aria-label={`${phase.name} dates`} aria-valuetext={`${fmtDate(preview.a)} to ${fmtDate(preview.b)}`}>
        <span className="tl-handle start" onPointerDown={ev => down(ev, 'start')} />
        <span className="tl-bar-text truncate">{x(preview.b) - x(preview.a) > 70 ? `${fmtDate(preview.a)} – ${fmtDate(preview.b)}` : ''}</span>
        {phase.status === 'complete' && <span className="tl-done">✓</span>}
        <span className="tl-handle end" onPointerDown={ev => down(ev, 'end')} />
      </div>}
      {!s && <span className="tl-empty-hint">+ Set dates</span>}
    </div>
  </div>
}
