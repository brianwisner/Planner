// Time: a weekly timesheet you can type into, the running timer, and every entry.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Clock, Download, Lock, Play, Plus, Search, Square } from 'lucide-react'
import { useData } from '../lib/store'
import { useEditors } from '../components/editors'
import { Empty, Menu, Segmented, type MenuEntry } from '../components/ui'
import { allHours, entryHours, HOUR_STATUS_LABEL, workPhase } from '../lib/calc'
import { phaseLabel } from '../lib/phases'
import { runningTimer, startTimer, stopTimer, elapsedLabel } from '../lib/timer'
import { mondayOf } from '../lib/views'
import { downloadCSV, fmtDate, fmtHours, fmtMoney, sum, todayISO } from '../lib/utils'
import { pref, setPref } from '../lib/theme'
import type { TimeEntry } from '../lib/types'
import './time.css'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
type Range = 'week' | '30' | 'month' | 'all'

export function Time() {
  const store = useData()
  const edit = useEditors()
  const [params, setParams] = useSearchParams()
  const today = todayISO()
  const week = /^\d{4}-\d{2}-\d{2}$/.test(params.get('week') ?? '') ? mondayOf(params.get('week')!) : mondayOf(today)
  const setWeek = (w: string) => setParams(p => { const n = new URLSearchParams(p); if (w === mondayOf(today)) n.delete('week'); else n.set('week', w); return n }, { replace: true })
  const [weekends, setWeekendsState] = useState(() => pref('time.weekends', false))
  const setWeekends = (v: boolean) => { setWeekendsState(v); setPref('time.weekends', v) }
  const allDays = useMemo(() => Array.from({ length: 7 }, (_, i) => iso(addDays(parseISO(week), i))), [week])
  // Weekend columns appear on their own when weekend hours exist, so totals always add up.
  const weekendHours = store.timeEntries.some(e => e.date === allDays[5] || e.date === allDays[6])
  const days = weekends || weekendHours ? allDays : allDays.slice(0, 5)
  // Deep link: /time?entry=<id>
  const opened = useRef<string | null>(null)
  useEffect(() => {
    const id = params.get('entry')
    if (!id || opened.current === id) return
    const e = store.timeEntries.find(x => x.id === id)
    if (e) { opened.current = id; edit.time(e) }
  }, [params, store.timeEntries, edit])

  const weekEntries = store.timeEntries.filter(e => e.date >= allDays[0] && e.date <= allDays[6] && e.hours != null)
  const weekTotal = sum(weekEntries.map(e => e.hours))
  const billable = sum(weekEntries.filter(e => e.billable !== false).map(e => e.hours))

  return <div className="time-page">
    <div className="page-head">
      <div className="titles"><h1>Time</h1><p className="lede">{weekTotal ? `${fmtHours(weekTotal)} logged this week · ${fmtHours(billable)} billable` : 'Nothing logged this week yet'}</p></div>
      <div className="actions">
        <button className="btn" onClick={() => edit.time()}><Plus size={16} /> Log hours</button>
      </div>
    </div>

    <TimerCard />

    <Timesheet key={week} days={days} allDays={allDays} week={week} today={today} onWeek={setWeek} weekends={weekends} setWeekends={setWeekends} />

    <EntryList week={allDays} />
  </div>
}

function TimerCard() {
  const store = useData()
  const edit = useEditors()
  const timer = runningTimer(store)
  const [, tick] = useState(0)
  useEffect(() => { if (!timer) return; const id = setInterval(() => tick(n => n + 1), 15000); return () => clearInterval(id) }, [timer])
  const active = store.jobs.filter(j => j.status === 'active')
  const [jobId, setJobId] = useState(() => pref<string>('time.timerJob', ''))
  const [billable, setBillable] = useState(true)
  const job = active.find(j => j.id === jobId) ?? active[0]
  if (timer) {
    const tj = store.jobs.find(j => j.id === timer.job_id)
    const ph = store.phases.find(p => p.id === timer.phase_id)
    return <section className="card timer-card running">
      <span className="timer-pulse" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="small muted">Timer running · started {format(new Date(timer.started_at!), 'h:mm a')}</div>
        <div className="timer-job truncate">{tj?.name ?? 'Job'}</div>
        <div className="tiny muted">{ph ? phaseLabel(ph) : 'General'}{timer.billable === false ? ' · non-billable' : ''}</div>
      </div>
      <div className="timer-clock num">{elapsedLabel(timer.started_at!)}</div>
      <button className="btn" onClick={() => edit.time(timer)}>Edit</button>
      <button className="btn ok lg" onClick={() => void stopTimer(store, timer)}><Square size={14} fill="currentColor" /> Stop & save</button>
    </section>
  }
  if (!active.length) return null
  return <section className="card timer-card">
    <span className="timer-ico"><Clock size={20} /></span>
    <div className="grow timer-form">
      <select className="input" value={job?.id ?? ''} onChange={e => { setJobId(e.target.value); setPref('time.timerJob', e.target.value) }} aria-label="Job to time">
        {active.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
      </select>
      <label className="switch small"><input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} />Billable</label>
    </div>
    <button className="btn primary lg" onClick={() => job && void startTimer(store, { job_id: job.id, billable })}><Play size={16} /> Start timer</button>
  </section>
}

/* ---------------- Timesheet ---------------- */

function Timesheet({ days, allDays, week, today, onWeek, weekends, setWeekends }: { days: string[]; allDays: string[]; week: string; today: string; onWeek: (w: string) => void; weekends: boolean; setWeekends: (v: boolean) => void }) {
  const store = useData()
  const [extraRows, setExtraRows] = useState<string[]>([])
  const entries = store.timeEntries.filter(e => e.date >= allDays[0] && e.date <= allDays[6])
  // Jobs with hours or planned hours this week come pre-listed, ready to type into.
  const planned = store.schedule.filter(s => s.date >= allDays[0] && s.date <= allDays[6] && s.user_id === store.me?.id && store.jobs.some(j => j.id === s.job_id && j.status === 'active'))
  const rowJobs = [...new Set([...entries.map(e => e.job_id), ...planned.map(s => s.job_id), ...extraRows])]
    .map(id => store.jobs.find(j => j.id === id)).filter(Boolean)
    .sort((a, b) => a!.priority - b!.priority) as typeof store.jobs
  const candidates = store.jobs.filter(j => j.status === 'active' && !rowJobs.some(r => r.id === j.id))
  const addItems: MenuEntry[] = candidates.length ? candidates.map(j => ({ label: j.name, onSelect: () => setExtraRows(r => [...r, j.id]) })) : [{ label: 'All active jobs are listed', disabled: true }]
  const dayTotal = (d: string) => sum(entries.filter(e => e.date === d).map(entryHours))
  const total = sum(days.map(dayTotal))

  return <section className="card sheet-card">
    <div className="card-head sheet-head">
      <div className="btn-group">
        <button className="btn icon sm" aria-label="Previous week" onClick={() => onWeek(iso(addDays(parseISO(week), -7)))}><ChevronLeft size={17} /></button>
        <button className="btn sm" disabled={week === mondayOf(today)} onClick={() => onWeek(mondayOf(today))}>This week</button>
        <button className="btn icon sm" aria-label="Next week" onClick={() => onWeek(iso(addDays(parseISO(week), 7)))}><ChevronRight size={17} /></button>
      </div>
      <h2>Week of {format(parseISO(week), 'MMM d')}</h2>
      <div className="grow" />
      <label className="switch small"><input type="checkbox" checked={weekends} onChange={e => setWeekends(e.target.checked)} />Weekends</label>
    </div>
    <div className="sheet-scroll">
      <table className="sheet" style={{ ['--days' as string]: days.length }}>
        <thead><tr>
          <th className="sheet-job">Job</th>
          {days.map(d => <th key={d} className={d === today ? 'today' : ''}><span className="sd-name">{format(parseISO(d), 'EEE')}</span><span className="sd-date">{format(parseISO(d), 'd')}</span></th>)}
          <th className="sheet-total hide-sm">Total</th>
        </tr></thead>
        <tbody>
          {rowJobs.map(job => <tr key={job.id}>
            <th className="sheet-job" scope="row"><Link to={`/jobs/${job.id}?tab=time`} className="truncate" style={{ display: 'block' }}>{job.name}</Link><span className="tiny muted truncate" style={{ display: 'block' }}>{store.clients.find(c => c.id === job.client_id)?.name}</span></th>
            {days.map(d => <SheetCell key={d} jobId={job.id} date={d} today={today} entries={entries.filter(e => e.job_id === job.id && e.date === d)} planned={sum(planned.filter(s => s.job_id === job.id && s.date === d).map(s => s.hours))} />)}
            <td className="sheet-total hide-sm num strong">{fmtHours(sum(entries.filter(e => e.job_id === job.id && days.includes(e.date)).map(entryHours)))}</td>
          </tr>)}
          <tr className="sheet-add-row">
            <th className="sheet-job" colSpan={1}>
              <Menu label="Add a job row" align="start" items={addItems} trigger={p => <button className="btn ghost sm" {...p}><Plus size={15} /> Add a job</button>} />
            </th>
            <td colSpan={days.length + 1} className="tiny muted sheet-hint">{rowJobs.length ? 'Type hours in a box (faint numbers are your plan). Click + to add notes.' : 'Add a job, then type the hours you worked each day.'}</td>
          </tr>
        </tbody>
        <tfoot><tr>
          <th className="sheet-job">Total</th>
          {days.map(d => <td key={d} className="num strong">{dayTotal(d) ? fmtHours(dayTotal(d)) : '–'}</td>)}
          <td className="sheet-total hide-sm num strong">{fmtHours(total)}</td>
        </tr></tfoot>
      </table>
    </div>
  </section>
}

function SheetCell({ jobId, date, today, entries, planned }: { jobId: string; date: string; today: string; entries: TimeEntry[]; planned: number }) {
  const store = useData()
  const edit = useEditors()
  const done = entries.filter(e => e.hours != null)
  const running = entries.some(e => e.hours == null && e.started_at)
  const value = sum(done.map(e => e.hours))
  const single = done.length === 1 ? done[0] : null
  const locked = single ? Boolean(single.billed || single.invoice_id || (single.deposit_applied ?? 0) > 0) : false
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editable = !running && (done.length === 0 || (single && !locked))
  async function commit() {
    if (draft == null) return
    const n = draft.trim() === '' ? 0 : Number(draft)
    setDraft(null)
    if (!Number.isFinite(n) || n < 0 || n > 24) { store.toast('Enter hours between 0 and 24', 'error'); return }
    const hours = Math.round(n * 4) / 4
    if (hours === value) return
    setSaving(true)
    if (single) {
      if (hours === 0) await store.remove('time_entries', single.id)
      else await store.update('time_entries', single.id, { hours })
    } else if (hours > 0 && store.me) {
      await store.insert('time_entries', { job_id: jobId, phase_id: workPhase(store.phases, jobId)?.id ?? null, user_id: store.me.id, date, hours, billable: true, started_at: null })
    }
    setSaving(false)
  }
  const label = `Hours on ${format(parseISO(date), 'EEEE MMM d')}`
  return <td className={`sheet-cell ${date === today ? 'today' : ''} ${value ? 'has' : ''}`}>
    <div className="sc-wrap">
      {editable
        ? <input className="sc-input" inputMode="decimal" aria-label={label} disabled={saving} value={draft ?? (value ? String(value) : '')} placeholder={planned ? String(planned) : '·'} title={planned ? `${fmtHours(planned)} planned` : undefined}
            onChange={e => setDraft(e.target.value)} onBlur={() => void commit()}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() } }} />
        : <button className={`sc-input sc-btn ${running ? 'running' : ''}`} aria-label={`${label}: ${running ? 'timer running' : fmtHours(value)}`} onClick={() => single ? edit.time(single) : edit.time(entries.find(e => e.hours == null) ?? done[0])}>
            {running ? '●' : fmtHours(value)}{locked && <Lock size={10} className="sc-lock" />}{done.length > 1 && <span className="sc-count">{done.length}</span>}
          </button>}
      <button className="sc-more" aria-label={`Add hours with notes on ${format(parseISO(date), 'MMM d')}`} onClick={() => edit.time(undefined, { job_id: jobId, date })}><Plus size={12} /></button>
    </div>
  </td>
}

/* ---------------- Entries ---------------- */

function EntryList({ week }: { week: string[] }) {
  const store = useData()
  const edit = useEditors()
  const [range, setRange] = useState<Range>('week')
  const [q, setQ] = useState('')
  const [billing, setBilling] = useState<'all' | 'billable' | 'nonbillable' | 'unbilled'>('all')
  const status = useMemo(() => allHours(store), [store])
  const today = todayISO()
  const from = range === 'week' ? week[0] : range === '30' ? iso(addDays(parseISO(today), -30)) : range === 'month' ? today.slice(0, 8) + '01' : '0000-00-00'
  const to = range === 'week' ? week[6] : '9999-12-31'
  const needle = q.trim().toLowerCase()
  const list = store.timeEntries.filter(e => {
    if (e.date < from || e.date > to) return false
    if (billing === 'billable' && e.billable === false) return false
    if (billing === 'nonbillable' && e.billable !== false) return false
    if (billing === 'unbilled') { const s = status.get(e.id)?.status; if (s !== 'unbilled' && s !== 'partial') return false }
    if (!needle) return true
    const job = store.jobs.find(j => j.id === e.job_id)
    const client = store.clients.find(c => c.id === job?.client_id)
    return [e.notes, job?.name, job?.job_number, client?.name].some(v => v?.toLowerCase().includes(needle))
  })
  const byDate = new Map<string, TimeEntry[]>()
  for (const e of list) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e])
  const phaseName = (id: string | null) => { const p = store.phases.find(x => x.id === id); return p ? phaseLabel(p) : 'General' }
  const total = sum(list.map(entryHours))
  function exportCsv() {
    downloadCSV('time-entries.csv', ['Date', 'Job #', 'Job', 'Client', 'Phase', 'Notes', 'Hours', 'Billable', 'Rate', 'Value', 'Billing status'], list.filter(e => e.hours != null).map(e => {
      const job = store.jobs.find(j => j.id === e.job_id)
      const h = status.get(e.id)
      return [e.date, job?.job_number, job?.name, store.clients.find(c => c.id === job?.client_id)?.name, phaseName(e.phase_id), e.notes, e.hours, e.billable === false ? 'No' : 'Yes', e.rate, h ? Math.round(h.amount * 100) / 100 : null, h ? HOUR_STATUS_LABEL[h.status] : '']
    }))
  }
  return <section className="card entries-card">
    <div className="card-head wrap-head">
      <h2>Entries <span className="sub">{fmtHours(total)} · {list.length} entr{list.length === 1 ? 'y' : 'ies'}</span></h2>
      <div className="row wrap">
        <Segmented size="sm" label="Date range" value={range} onChange={setRange} options={[{ value: 'week', label: 'This sheet week' }, { value: '30', label: '30 days' }, { value: 'month', label: 'This month' }, { value: 'all', label: 'All' }]} />
        <select className="input sm" style={{ width: 'auto' }} value={billing} onChange={e => setBilling(e.target.value as typeof billing)} aria-label="Billing filter">
          <option value="all">All hours</option><option value="billable">Billable</option><option value="nonbillable">Non-billable</option><option value="unbilled">Not billed yet</option>
        </select>
        <div className="input-wrap" style={{ width: 200 }}><Search size={15} /><input className="input sm" value={q} onChange={e => setQ(e.target.value)} placeholder="Search notes, job…" aria-label="Search entries" /></div>
        <button className="btn sm" onClick={exportCsv}><Download size={14} /> CSV</button>
      </div>
    </div>
    {list.length === 0 ? <Empty compact icon={<Clock size={20} />} title="No entries">{range === 'week' ? 'Type hours into the timesheet above, or start a timer.' : 'Try a wider date range.'}</Empty> :
      [...byDate.entries()].map(([date, rows]) => <div key={date} className="entry-day">
        <div className="entry-date"><span>{fmtDate(date, 'long').replace(/, \d{4}$/, '')}</span><span className="num">{fmtHours(sum(rows.map(entryHours)))}</span></div>
        {rows.map(e => { const job = store.jobs.find(j => j.id === e.job_id); const h = status.get(e.id); const running = e.started_at && e.hours == null; return <button key={e.id} className="entry-row" onClick={() => edit.time(e)}>
          <span className="entry-hours num">{running ? <span className="badge ok">Running</span> : fmtHours(e.hours)}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="strong truncate" style={{ display: 'block' }}>{job?.name ?? 'Deleted job'}<span className="muted" style={{ fontWeight: 400 }}> · {phaseName(e.phase_id)}</span></span>
            {e.notes && <span className="small soft truncate" style={{ display: 'block' }}>{e.notes}</span>}
          </span>
          <span className="hide-sm">{e.billable === false ? <span className="badge">Non-billable</span> : h ? <span className={`badge money-${h.status}`}>{HOUR_STATUS_LABEL[h.status]}</span> : null}</span>
          <span className="hide-sm num small muted" style={{ width: 70, textAlign: 'right' }}>{h && e.billable !== false ? fmtMoney(h.amount) : ''}</span>
        </button> })}
      </div>)}
  </section>
}
