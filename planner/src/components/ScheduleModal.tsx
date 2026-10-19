// Saved plans remain editable at their original phase/owner; new plans use the workflow.
import { useId, useMemo, useRef, useState } from 'react'
import { addDays, format, isWeekend, parseISO } from 'date-fns'
import { useData } from '../lib/store'
import { fmtHours, sum } from '../lib/utils'
import { workPhase } from '../lib/calc'
import { isWorkflowPhase, jobPhaseGroups, phaseLabel } from '../lib/phases'
import { Modal } from './ui'

function validDay(value: string) {
  const date = parseISO(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && format(date, 'yyyy-MM-dd') === value
}

export function ScheduleModal({ jobId, phaseId, from, to, onClose }: { jobId: string; phaseId: string | null; from: string; to: string; onClose: () => void }) {
  const { jobs, phases, schedule, me, settings, insert, update, remove, refresh, toast } = useData()
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const busy = useRef(false)
  const job = jobs.find(job => job.id === jobId)
  const groups = jobPhaseGroups(phases, jobId)
  const passedHistory = groups.history.find(phase => phase.id === phaseId && schedule.some(entry => entry.job_id === jobId && entry.phase_id === phase.id))
  const [phase, setPhase] = useState<string | null>(() => groups.workflow.some(phase => phase.id === phaseId) || passedHistory ? phaseId : workPhase(phases, jobId)?.id ?? null)
  const ph = groups.all.find(candidate => candidate.id === phase)
  const historical = Boolean(ph && !isWorkflowPhase(ph))
  const who = me?.id ?? ''
  const [start, setStart] = useState(from)
  const [end, setEnd] = useState(to < from ? from : to)
  const [skipWeekends, setSkipWeekends] = useState(validDay(from) && !(from === to && isWeekend(parseISO(from))))
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<'save' | 'clear' | null>(null)
  const [error, setError] = useState('')
  const close = () => { if (!busy.current) onClose() }
  const range = useMemo(() => {
    const out: string[] = []
    if (validDay(start) && validDay(end)) for (let day = parseISO(start); format(day, 'yyyy-MM-dd') <= end && out.length <= 120; day = addDays(day, 1)) {
      if (!skipWeekends || !isWeekend(day)) out.push(format(day, 'yyyy-MM-dd'))
    }
    return { days: out.slice(0, 120), limited: out.length > 120 }
  }, [start, end, skipWeekends])
  const days = range.days
  const rangeError = !validDay(start) || !validDay(end) ? 'Enter valid start and end dates.' : start > end ? 'The end date must be on or after the start date.' : range.limited ? 'Choose a range with no more than 120 included days.' : ''
  const ownRows = (date: string) => schedule.filter(entry => entry.job_id === jobId && entry.phase_id === phase && entry.user_id === who && entry.date === date)
  const existing = (date: string) => ownRows(date)[0]
  const duplicates = days.filter(date => ownRows(date).length > 1)
  const activeJobIds = new Set(jobs.filter(job => job.status === 'active').map(job => job.id))
  const otherWork = (date: string) => sum(schedule.filter(entry => activeJobIds.has(entry.job_id) && entry.date === date &&
    !(entry.job_id === jobId && entry.phase_id === phase && entry.user_id === who)).map(entry => entry.hours))
  const additionalPlans = schedule.filter(entry => entry.job_id === jobId && entry.phase_id === phase && entry.user_id !== who && days.includes(entry.date))
  const dailyCap = (me?.weekly_hours || settings.weekly_capacity || 40) / 5
  const scheduledElsewhere = sum(schedule.filter(entry => entry.job_id === jobId && entry.phase_id === phase && !(entry.user_id === who && days.includes(entry.date))).map(entry => entry.hours))
  const remaining = Math.max(0, (ph?.estimate_hours ?? 0) - scheduledElsewhere)
  const newDays = days.filter(day => !existing(day)).length
  const suggest = historical ? 0 : ph && ph.estimate_hours > 0 && remaining > 0 && newDays > 0 ? Math.min(8, Math.max(0.5, Math.round((remaining / newDays) * 2) / 2)) : Math.min(8, dailyCap)
  const value = (date: string) => duplicates.includes(date) ? String(sum(ownRows(date).map(row => row.hours))) : historical && !existing(date) ? '0' : edits[date] ?? (existing(date) ? String(existing(date)!.hours) : String(suggest))
  const total = sum(days.map(day => Number(value(day)) || 0))
  const existingDays = days.filter(day => existing(day))
  async function bestEffortRefresh() { try { await refresh('schedule_entries') } catch { /* Keep the inline failure and draft even if refresh is offline. */ } }

  async function save() {
    if (busy.current) return
    if (!who) { setError('Your account is still loading. Try again in a moment.'); return }
    if (!job || phase && !ph) { setError('This job or phase is no longer available. Close the form and choose it again.'); return }
    if (rangeError) { setError(rangeError); return }
    if (formRef.current?.querySelector('input[type="number"]:not([readonly]):not(:disabled):invalid') || days.some(day => !duplicates.includes(day) && (!Number.isFinite(Number(value(day))) || Number(value(day)) < 0 || Number(value(day)) > 24))) {
      setError('Enter between zero and 24 hours for each day. Blank or zero clears a saved day.'); return
    }
    busy.current = true; setPending('save'); setError('')
    try {
      for (const date of days) {
        if (duplicates.includes(date)) continue
        const hours = Number(value(date)) || 0, saved = existing(date)
        let success = true
        if (saved && hours <= 0) success = await remove('schedule_entries', saved.id)
        else if (saved && hours !== saved.hours) success = await update('schedule_entries', saved.id, { hours })
        else if (!saved && hours > 0 && !historical) success = Boolean(await insert('schedule_entries', { job_id: jobId, phase_id: phase, user_id: who, date, hours }))
        if (!success) { await bestEffortRefresh(); setError('A planned day could not be saved. Some earlier days may already be saved. Your draft is kept; check the saved plans before trying again.'); return }
      }
      toast(`Saved ${fmtHours(total)} of your planned work`)
      onClose()
    } catch { await bestEffortRefresh(); setError('Could not confirm the save. Some days may already be saved. Your draft is kept; check the saved plans before trying again.') }
    finally { busy.current = false; setPending(null) }
  }
  async function clearAll() {
    if (busy.current || !existingDays.length || !confirm(`Remove your ${existingDays.length} saved day(s) in this range? Additional saved plans stay unchanged.`)) return
    busy.current = true; setPending('clear'); setError('')
    try {
      for (const row of existingDays.flatMap(ownRows)) if (!await remove('schedule_entries', row.id)) {
        await bestEffortRefresh(); setError('A planned day could not be cleared. Some earlier days may already be cleared. Your draft is kept; check the saved plans before trying again.'); return
      }
      toast('Your saved plans were cleared')
      onClose()
    } catch { await bestEffortRefresh(); setError('Could not confirm the clear. Your draft is kept; check the saved plans before trying again.') }
    finally { busy.current = false; setPending(null) }
  }

  return <Modal title="Schedule hours" onClose={close} footer={<>
    <button className="btn danger left" disabled={pending !== null || !existingDays.length || Boolean(rangeError)} onClick={clearAll}>{pending === 'clear' ? 'Clearing…' : 'Clear these days'}</button>
    <button className="btn" disabled={pending !== null} onClick={close}>Cancel</button>
    <button type="submit" form={formId} className="btn primary" disabled={pending !== null || !days.length || Boolean(rangeError) || historical && !existingDays.length}>{pending === 'save' ? 'Saving…' : `Save ${fmtHours(total)}`}</button>
  </>}>
    <p className="small muted" style={{ marginTop: 0 }}>{job?.job_number && `${job.job_number} · `}{job?.name}</p>
    {(error || rangeError) && <p className="danger-text small" role="alert">{error || rangeError}</p>}
    {historical && <p className="small muted">Planning history keeps existing saved plans. Change or clear your saved dates here; new dates cannot receive hours on this retired phase.</p>}
    {duplicates.length > 0 && <p className="small muted" role="status">{duplicates.length} saved date(s) contain multiple plans under your account. Their combined hours are read-only and stay unchanged on Save. Clear these days removes your saved rows, including duplicates.</p>}
    <form ref={formRef} id={formId} noValidate onSubmit={event => { event.preventDefault(); void save() }}><fieldset className="editor-fields" disabled={pending !== null}>
      <div className="field"><label htmlFor={`${formId}-phase`}>Phase</label><select id={`${formId}-phase`} value={phase ?? ''} onChange={event => { setPhase(event.target.value || null); setEdits({}); setError('') }}>
        {groups.workflow.map(phase => <option key={phase.id} value={phase.id}>{phaseLabel(phase)}</option>)}
        {(passedHistory || historical) && <option value={passedHistory?.id ?? ph!.id}>Planning history (saved plans only)</option>}
        <option value="">General (no phase)</option>
      </select></div>
      <div className="row"><div className="field"><label htmlFor={`${formId}-from`}>From</label><input id={`${formId}-from`} type="date" value={start} onChange={event => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value) }} /></div><div className="field"><label htmlFor={`${formId}-to`}>To</label><input id={`${formId}-to`} type="date" value={end} min={start} onChange={event => setEnd(event.target.value)} /></div><label className="chip" style={{ marginTop: 18 }}><input type="checkbox" style={{ width: 16, minHeight: 0, margin: 0 }} checked={skipWeekends} onChange={event => setSkipWeekends(event.target.checked)} /> Skip weekends</label></div>
      <div className="row small" style={{ marginBottom: 8 }}><span className="muted">Set editable days to</span>{[2, 4, 6, 8].map(hours => <button type="button" key={hours} className="btn sm" onClick={() => setEdits(Object.fromEntries(days.filter(day => !historical || existing(day)).map(day => [day, String(hours)])))}>{hours}h</button>)}</div>
      <div className="sched-days">{!days.length && <p className="small muted">No days in this range.</p>}{days.map(day => {
        const other = otherWork(day), mine = Number(value(day)) || 0
        const over = other + (job?.status === 'active' ? mine : 0) > dailyCap
        return <div key={day} className="sched-day"><span className="sched-date">{format(parseISO(day), 'EEE, MMM d')}</span><input type="number" min="0" max="24" step="any" disabled={historical && !existing(day)} readOnly={duplicates.includes(day)} value={value(day)} onChange={event => setEdits(previous => ({ ...previous, [day]: event.target.value }))} aria-label={`Hours on ${day}`} /><span className="tiny muted">h</span><span className={`tiny ${over ? 'warn-text bold' : 'muted'}`}>{historical && !existing(day) ? 'No saved plan to edit' : other > 0 ? `+ ${fmtHours(other)} other active plans${over ? ' · over a full day' : ''}` : over ? 'over a full day' : ''}</span></div>
      })}</div>
      {additionalPlans.length > 0 && <p className="small muted">Additional saved plans: {fmtHours(sum(additionalPlans.map(entry => entry.hours)))} in this range. This form changes only your saved plans.</p>}
      {ph && <p className="small muted mt">{phaseLabel(ph)}: {historical ? 'retained saved plans' : `estimate ${fmtHours(ph.estimate_hours)}`} · scheduled {fmtHours(scheduledElsewhere + total)} with these days.</p>}
      {job?.status !== 'active' && <p className="small muted">These saved plans are outside active-job capacity until this job is Active.</p>}
    </fieldset></form>
  </Modal>
}
