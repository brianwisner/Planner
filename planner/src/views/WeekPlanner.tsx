// Week planner: type the hours you plan to spend on each job each day.
// Totals show against your available hours, with deadlines on the day they fall.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, format, parseISO } from 'date-fns'
import { CalendarClock, ChevronLeft, ChevronRight, Copy, MapPin } from 'lucide-react'
import { useData } from '../lib/store'
import { ownPlans, setPlannedHours } from '../lib/schedule'
import { hoursForPhase } from '../lib/calc'
import { jobPhaseGroups, phaseLabel } from '../lib/phases'
import { jobStage } from '../lib/stages'
import { openAgenda, mondayOf } from '../lib/views'
import { fmtHours, sum, todayISO } from '../lib/utils'
import { pref, setPref } from '../lib/theme'
import { Modal, NumberInput } from '../components/ui'
import './week-planner.css'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

export function WeekPlanner({ week, onWeek }: { week: string; onWeek: (monday: string) => void }) {
  const store = useData()
  const { jobs, schedule, timeEntries, phases, me, settings, clients } = store
  const [weekends, setWeekendsState] = useState(() => pref('plan.weekends', false))
  const setWeekends = (v: boolean) => { setWeekendsState(v); setPref('plan.weekends', v) }
  const [multi, setMulti] = useState<{ jobId: string; date: string } | null>(null)
  const today = todayISO()
  const monday = mondayOf(week)
  const days = useMemo(() => Array.from({ length: weekends ? 7 : 5 }, (_, i) => iso(addDays(parseISO(monday), i))), [monday, weekends])
  const daily = (me?.weekly_hours || settings.weekly_capacity || 40) / 5
  const activeIds = new Set(jobs.filter(j => j.status === 'active').map(j => j.id))
  const inWeek = (date: string) => date >= days[0] && date <= days[days.length - 1]

  // Active jobs in priority order, plus any other job with plans this week.
  const plannedJobs = new Set(schedule.filter(s => inWeek(s.date)).map(s => s.job_id))
  const rows = jobs.filter(j => j.status === 'active' || plannedJobs.has(j.id))

  const agenda = useMemo(() => openAgenda(store), [store])
  const dueOn = (date: string) => agenda.filter(i => i.date === date)
  const plannedOn = (date: string) => sum(schedule.filter(s => s.date === date && activeIds.has(s.job_id)).map(s => s.hours))
  const loggedOn = (date: string, jobId?: string) => sum(timeEntries.filter(e => e.date === date && e.hours != null && (!jobId || e.job_id === jobId)).map(e => e.hours))
  const weekPlanned = sum(days.map(plannedOn))
  const weekCapacity = days.filter(d => { const n = parseISO(d).getDay(); return n !== 0 && n !== 6 }).length * daily

  const prevMonday = iso(addDays(parseISO(monday), -7))
  const lastWeekOwn = schedule.filter(s => s.user_id === me?.id && s.date >= prevMonday && s.date < monday && activeIds.has(s.job_id))
  async function copyLastWeek() {
    let made = 0
    for (const s of lastWeekOwn) {
      const date = iso(addDays(parseISO(s.date), 7))
      if (ownPlans(store, s.job_id, date).length) continue
      if (await setPlannedHours(store, s.job_id, date, s.hours, s.phase_id) === true) made++
    }
    store.toast(made ? `Copied ${made} day${made === 1 ? '' : 's'} of plans from last week` : 'Nothing new to copy — this week already has those plans')
  }

  return <div className="planner">
    <div className="toolbar">
      <div className="btn-group">
        <button className="btn icon" aria-label="Previous week" onClick={() => onWeek(prevMonday)}><ChevronLeft size={18} /></button>
        <button className="btn" onClick={() => onWeek(mondayOf(today))} disabled={monday === mondayOf(today)}>This week</button>
        <button className="btn icon" aria-label="Next week" onClick={() => onWeek(iso(addDays(parseISO(monday), 7)))}><ChevronRight size={18} /></button>
      </div>
      <strong className="week-label">{format(parseISO(days[0]), 'MMM d')} – {format(parseISO(days[days.length - 1]), days[0].slice(5, 7) === days[days.length - 1].slice(5, 7) ? 'd, yyyy' : 'MMM d, yyyy')}</strong>
      <div className="grow" />
      <span className={`week-total ${weekPlanned > weekCapacity + 0.01 ? 'over' : ''}`}><strong className="num">{fmtHours(weekPlanned)}</strong> planned of {fmtHours(weekCapacity)}</span>
      <label className="switch small"><input type="checkbox" checked={weekends} onChange={e => setWeekends(e.target.checked)} />Weekends</label>
      {lastWeekOwn.length > 0 && <button className="btn sm" onClick={() => void copyLastWeek()} title="Copy last week's planned hours into empty days this week"><Copy size={14} /> Copy last week</button>}
    </div>

    <div className="card plan-card">
      <div className="plan-scroll">
        <table className="plan-table" style={{ ['--days' as string]: days.length }}>
          <thead>
            <tr>
              <th className="plan-job-col">Job</th>
              {days.map(d => { const due = dueOn(d); const visits = due.filter(i => i.kind === 'site_visit'); return <th key={d} className={`plan-day ${d === today ? 'today' : ''}`}>
                <span className="pd-name">{format(parseISO(d), 'EEE')}</span><span className="pd-date">{format(parseISO(d), 'MMM d')}</span>
                {due.length > 0 && <span className="pd-due" title={due.map(i => `• ${i.title} (${i.jobName})`).join('\n')}>{visits.length ? <MapPin size={11} /> : <CalendarClock size={11} />}{due.length}</span>}
              </th> })}
              <th className="plan-sum hide-sm">Week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(job => {
              const st = jobStage(phases, job.id)
              const wf = jobPhaseGroups(phases, job.id).workflow.filter(p => p.status !== 'complete')
              const left = sum(wf.map(p => Math.max(0, p.estimate_hours - hoursForPhase(timeEntries, p.id))))
              const jobWeek = sum(schedule.filter(s => s.job_id === job.id && inWeek(s.date)).map(s => s.hours))
              const client = clients.find(c => c.id === job.client_id)
              return <tr key={job.id} data-stage={job.status === 'active' ? st.stage : 'hold'}>
                <th className="plan-job-col" scope="row">
                  <span className="pj"><span className="dot" style={{ background: 'var(--stage)' }} /><Link to={`/jobs/${job.id}`} className="pj-name truncate">{job.name}</Link></span>
                  <span className="pj-sub truncate">{client?.name}{left > 0 ? ` · ${fmtHours(left)} left` : ''}{job.status !== 'active' ? ' · not active' : ''}</span>
                </th>
                {days.map(d => <DayCell key={d} jobId={job.id} date={d} today={today} logged={loggedOn(d, job.id)} onMulti={() => setMulti({ jobId: job.id, date: d })} />)}
                <td className="plan-sum hide-sm num">{jobWeek ? fmtHours(jobWeek) : '–'}</td>
              </tr>
            })}
            {rows.length === 0 && <tr><td colSpan={days.length + 2} className="muted" style={{ padding: 24, textAlign: 'center' }}>No active jobs to plan.</td></tr>}
          </tbody>
          <tfoot>
            <tr>
              <th className="plan-job-col">Planned / available</th>
              {days.map(d => { const p = plannedOn(d); const wk = [0, 6].includes(parseISO(d).getDay()); const cap = wk ? 0 : daily; const over = p > cap + 0.01; return <td key={d} className={`plan-total ${over ? 'over' : ''}`}>
                <span className="num strong">{fmtHours(p)}</span>
                <span className="cap-bar"><span style={{ width: `${cap ? Math.min(100, p / cap * 100) : p ? 100 : 0}%` }} /></span>
                <span className="tiny muted num">{cap ? `of ${fmtHours(cap)}` : 'day off'}</span>
              </td> })}
              <td className="plan-sum hide-sm num strong">{fmtHours(weekPlanned)}</td>
            </tr>
            <tr className="logged-row">
              <th className="plan-job-col">Logged</th>
              {days.map(d => <td key={d} className="num tiny">{loggedOn(d) ? fmtHours(loggedOn(d)) : '–'}</td>)}
              <td className="plan-sum hide-sm num tiny">{fmtHours(sum(days.map(d => loggedOn(d))))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    <p className="tiny muted mt">Planned hours are your intentions, not time worked. Typing hours plans them on the job's current phase; clear a box to remove it.</p>
    {multi && <MultiPhaseDay jobId={multi.jobId} date={multi.date} onClose={() => setMulti(null)} />}
  </div>
}

function DayCell({ jobId, date, today, logged, onMulti }: { jobId: string; date: string; today: string; logged: number; onMulti: () => void }) {
  const store = useData()
  const own = ownPlans(store, jobId, date)
  const others = store.schedule.filter(s => s.job_id === jobId && s.date === date && s.user_id !== store.me?.id)
  const value = sum(own.map(r => r.hours))
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  async function commit() {
    if (draft == null) return
    const n = draft.trim() === '' ? 0 : Number(draft)
    if (!Number.isFinite(n) || n < 0 || n > 24) { store.toast('Enter hours between 0 and 24', 'error'); setDraft(null); return }
    if (n === value) { setDraft(null); return }
    setSaving(true)
    const result = await setPlannedHours(store, jobId, date, Math.round(n * 4) / 4)
    setSaving(false)
    setDraft(null)
    if (result === 'multi') onMulti()
  }
  const label = `Planned hours on ${format(parseISO(date), 'EEEE MMM d')}`
  return <td className={`plan-cell ${date === today ? 'today' : ''} ${value ? 'has' : ''}`}>
    {own.length > 1
      ? <button className="plan-input multi" onClick={onMulti} aria-label={`${label} (several phases)`}>{fmtHours(value)}</button>
      : <input className="plan-input" inputMode="decimal" aria-label={label} disabled={saving}
          value={draft ?? (value ? String(value) : '')} placeholder="·"
          onChange={e => setDraft(e.target.value)} onBlur={() => void commit()}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() } }} />}
    {(logged > 0 || others.length > 0) && <span className="plan-note">{logged > 0 && <span title="Hours logged this day">✓{fmtHours(logged)}</span>}{others.length > 0 && <span title="Planned by someone else"> +{fmtHours(sum(others.map(o => o.hours)))}</span>}</span>}
  </td>
}

/** When a day has plans on several phases, edit each one separately. */
function MultiPhaseDay({ jobId, date, onClose }: { jobId: string; date: string; onClose: () => void }) {
  const store = useData()
  const rows = ownPlans(store, jobId, date)
  const [values, setValues] = useState<Record<string, number | null>>(() => Object.fromEntries(rows.map(r => [r.id, r.hours])))
  const job = store.jobs.find(j => j.id === jobId)
  async function save() {
    for (const r of rows) {
      const v = values[r.id] ?? 0
      if (v <= 0) await store.remove('schedule_entries', r.id)
      else if (v !== r.hours) await store.update('schedule_entries', r.id, { hours: v })
    }
    onClose()
  }
  return <Modal size="narrow" title="Planned hours" subtitle={`${job?.name} · ${format(parseISO(date), 'EEEE, MMM d')}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => void save()}>Save</button></>}>
    <div className="stack">
      {rows.map(r => { const p = store.phases.find(x => x.id === r.phase_id); return <div key={r.id} className="row between">
        <span>{p ? phaseLabel(p) : 'General'}</span>
        <div style={{ width: 120 }}><NumberInput value={values[r.id]} onChange={v => setValues(x => ({ ...x, [r.id]: v }))} step={0.5} min={0} suffix="h" ariaLabel={`Hours for ${p?.name ?? 'general'}`} /></div>
      </div> })}
      <p className="tiny muted">Set a phase to 0 to remove its plan for this day.</p>
    </div>
  </Modal>
}
