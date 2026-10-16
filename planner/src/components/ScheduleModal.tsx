// "Schedule hours" form opened from the Gantt chart. Lists each day in the
// chosen range so different days can get different hours (4h Wed, 2h Thu...).
// Blank or 0 removes that day from the schedule.
import { useMemo, useState } from 'react'
import { addDays, format, isWeekend, parseISO } from 'date-fns'
import { useData } from '../lib/store'
import { fmtHours, sum } from '../lib/utils'
import { Modal, PersonSelect } from './ui'

export function ScheduleModal({ jobId, phaseId, from, to, onClose }: { jobId: string; phaseId: string | null; from: string; to: string; onClose: () => void }) {
  const { jobs, phases, schedule, me, settings, profiles, insert, update, remove, toast } = useData()
  const job = jobs.find(j => j.id === jobId)
  const jobPhases = phases.filter(p => p.job_id === jobId)
  const [phase, setPhase] = useState<string | null>(phaseId ?? jobPhases.find(p => p.status !== 'complete')?.id ?? jobPhases[0]?.id ?? null)
  const ph = jobPhases.find(p => p.id === phase)
  const [who, setWho] = useState<string>(ph?.assignee_id ?? me?.id ?? '')
  const [start, setStart] = useState(from)
  const [end, setEnd] = useState(to < from ? from : to)
  const [skipWeekends, setSkipWeekends] = useState(!(from === to && isWeekend(parseISO(from))))
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const days = useMemo(() => {
    const out: string[] = []
    for (let d = parseISO(start); format(d, 'yyyy-MM-dd') <= end && out.length < 120; d = addDays(d, 1)) {
      if (skipWeekends && isWeekend(d)) continue
      out.push(format(d, 'yyyy-MM-dd'))
    }
    return out
  }, [start, end, skipWeekends])

  const existing = (date: string) => schedule.find(s => s.job_id === jobId && s.phase_id === phase && s.user_id === who && s.date === date)
  const otherWork = (date: string) => sum(schedule.filter(s => s.user_id === who && s.date === date && !(s.job_id === jobId && s.phase_id === phase)).map(s => s.hours))
  const person = profiles.find(p => p.id === who)
  const dailyCap = (person?.weekly_hours || settings.weekly_capacity || 40) / 5

  // Suggested hours for new days: spread what's left of the phase estimate, max 8 a day.
  const scheduledElsewhere = sum(schedule.filter(s => s.phase_id === phase && s.phase_id && !(s.user_id === who && days.includes(s.date))).map(s => s.hours))
  const remaining = Math.max(0, (ph?.estimate_hours ?? 0) - scheduledElsewhere)
  const newDays = days.filter(d => !existing(d)).length
  const suggest = ph && ph.estimate_hours > 0 && remaining > 0 && newDays > 0 ? Math.min(8, Math.max(0.5, Math.round((remaining / newDays) * 2) / 2)) : Math.min(8, dailyCap)

  const value = (date: string) => edits[date] ?? (existing(date) ? String(existing(date)!.hours) : String(suggest))
  const total = sum(days.map(d => Number(value(d)) || 0))

  async function save() {
    if (!who) { toast('Pick a person', 'error'); return }
    setSaving(true)
    for (const date of days) {
      const hrs = Number(value(date)) || 0
      const ex = existing(date)
      if (ex && hrs <= 0) await remove('schedule_entries', ex.id)
      else if (ex && hrs !== ex.hours) await update('schedule_entries', ex.id, { hours: hrs })
      else if (!ex && hrs > 0) await insert('schedule_entries', { job_id: jobId, phase_id: phase, user_id: who, date, hours: hrs })
    }
    setSaving(false)
    toast(`Scheduled ${fmtHours(total)}`)
    onClose()
  }
  async function clearAll() {
    const ids = days.map(existing).filter(Boolean).map(e => e!.id)
    if (ids.length === 0) { onClose(); return }
    if (!confirm(`Remove ${ids.length} scheduled day(s)?`)) return
    for (const id of ids) await remove('schedule_entries', id)
    onClose()
  }

  return (
    <Modal title="Schedule hours" onClose={onClose} footer={<>
      <button className="btn danger left" onClick={clearAll}>Clear these days</button>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={saving}>Save {fmtHours(total)}</button>
    </>}>
      <p className="small muted" style={{ marginTop: 0 }}>{job?.job_number && `${job.job_number} · `}{job?.name}</p>
      <div className="row">
        <div className="field">
          <label>Phase</label>
          <select value={phase ?? ''} onChange={e => { setPhase(e.target.value || null); setEdits({}) }}>
            {jobPhases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="">General (no phase)</option>
          </select>
        </div>
        <div className="field"><label>Who</label><PersonSelect value={who} onChange={v => { setWho(v ?? ''); setEdits({}) }} allowNone={false} /></div>
      </div>
      <div className="row">
        <div className="field"><label>From</label><input type="date" value={start} onChange={e => { if (e.target.value) { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value) } }} /></div>
        <div className="field"><label>To</label><input type="date" value={end} min={start} onChange={e => e.target.value && setEnd(e.target.value)} /></div>
        <label className="chip" style={{ marginTop: 18 }}><input type="checkbox" style={{ width: 16, minHeight: 0, margin: 0 }} checked={skipWeekends} onChange={e => setSkipWeekends(e.target.checked)} /> Skip weekends</label>
      </div>
      <div className="row small" style={{ marginBottom: 8 }}>
        <span className="muted">Set every day to</span>
        {[2, 4, 6, 8].map(h => <button key={h} className="btn sm" onClick={() => setEdits(Object.fromEntries(days.map(d => [d, String(h)])))}>{h}h</button>)}
      </div>
      <div className="sched-days">
        {days.length === 0 && <p className="small muted">No days in this range.</p>}
        {days.map(d => {
          const other = otherWork(d)
          const mine = Number(value(d)) || 0
          const over = other + mine > dailyCap
          return (
            <div key={d} className="sched-day">
              <span className="sched-date">{format(parseISO(d), 'EEE, MMM d')}</span>
              <input type="number" min="0" max="24" step="0.5" value={value(d)} onChange={e => setEdits(x => ({ ...x, [d]: e.target.value }))} aria-label={`Hours on ${d}`} />
              <span className="tiny muted">h</span>
              <span className={`tiny ${over ? 'warn-text bold' : 'muted'}`}>{other > 0 ? `+ ${fmtHours(other)} other work${over ? ' · over a full day' : ''}` : over ? 'over a full day' : ''}</span>
            </div>
          )
        })}
      </div>
      {ph && <p className="small muted mt">{ph.name}: estimate {fmtHours(ph.estimate_hours)} · scheduled {fmtHours(scheduledElsewhere + total)} with these days.</p>}
    </Modal>
  )
}
