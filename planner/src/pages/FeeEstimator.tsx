// Money → Fee estimator: suggests a fee from a job type's usual hours, blended
// with the real hours on finished jobs of that type, and saves it to a job.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Calculator, ClipboardCopy, Pencil, Plus, Save } from 'lucide-react'
import { useData } from '../lib/store'
import { useEditors } from '../components/editors'
import { Empty, Field, NumberInput, useConfirm } from '../components/ui'
import { estimateHours, FEE_PHASES, FEE_PHASE_LABEL, finishedJobs, halfHours, roundFee, splitFee, STARTER_WEIGHT } from '../lib/estimate'
import { jobPhaseGroups } from '../lib/phases'
import type { Job } from '../lib/types'
import { fmtHourlyRate, fmtHours, fmtMoney } from '../lib/utils'

const PROPOSAL_LABEL = { design: 'Design (calculations and drawings)', plan_check: 'Plan check responses', construction: 'Construction support' } as const

export function FeeEstimator({ jobId, typeId, patch }: { jobId: string; typeId: string; patch: (n: Record<string, string | null>) => void }) {
  const store = useData()
  const edit = useEditors()
  const confirm = useConfirm()
  const job = store.jobs.find(j => j.id === jobId)
  const type = store.jobTypes.find(t => t.id === (typeId || job?.job_type_id))
  const baseRate = store.me?.hourly_rate ?? store.settings.default_rate
  const [rate, setRate] = useState<number | null>(baseRate)
  const [feeOverride, setFeeOverride] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const est = useMemo(() => type ? estimateHours(store, type, job?.id) : null, [store, type, job?.id])
  const r = rate ?? 0
  const suggested = est ? roundFee(est.total * r) : 0
  const fee = feeOverride ?? suggested
  const split = est ? splitFee(fee, est.hours) : null
  const maxHours = est ? Math.max(1, ...FEE_PHASES.map(k => Math.max(est.hours[k], est.starter[k]))) : 1
  const openJobs = store.jobs.filter(j => j.status === 'active' || j.status === 'on_hold')

  function pickType(id: string) { patch({ type: id || null }); setFeeOverride(null) }
  function pickJob(id: string) {
    const j = store.jobs.find(x => x.id === id)
    patch({ job: id || null, type: j?.job_type_id ? null : type?.id ?? null })
    setFeeOverride(null)
  }

  async function saveToJob(target: Job) {
    if (!est || !type || saving) return
    const phases = jobPhaseGroups(store.phases, target.id).workflow.filter(p => (FEE_PHASES as readonly string[]).includes(p.kind))
    const next = phases.map(p => ({ phase: p, hours: halfHours(est.hours[p.kind as typeof FEE_PHASES[number]]) }))
    const replacing = (target.fee != null && target.fee !== fee) || next.some(n => n.phase.estimate_hours > 0 && n.phase.estimate_hours !== n.hours)
    if (replacing && !await confirm({
      title: `Replace the fee and estimates on ${target.name}?`,
      body: `Fee ${fmtMoney(target.fee)} → ${fmtMoney(fee)}. ${next.map(n => `${FEE_PHASE_LABEL[n.phase.kind as typeof FEE_PHASES[number]]} ${fmtHours(n.phase.estimate_hours)} → ${fmtHours(n.hours)}`).join(', ')}. You can undo this right after.`,
      confirmLabel: 'Replace',
    })) return
    const before = { fee: target.fee, job_type_id: target.job_type_id, phases: phases.map(p => ({ id: p.id, estimate_hours: p.estimate_hours })) }
    setSaving(true)
    const results = await Promise.all([
      store.update('jobs', target.id, { fee, job_type_id: type.id }),
      ...next.map(n => store.update('phases', n.phase.id, { estimate_hours: n.hours })),
    ])
    setSaving(false)
    if (results.every(Boolean)) store.toast(`Saved ${fmtMoney(fee)} and phase estimates to ${target.name}`, 'ok', {
      label: 'Undo',
      run: () => Promise.all([
        store.update('jobs', target.id, { fee: before.fee, job_type_id: before.job_type_id }),
        ...before.phases.map(p => store.update('phases', p.id, { estimate_hours: p.estimate_hours })),
      ]),
    })
  }

  async function copyProposal() {
    if (!split) return
    const lines = [
      `Structural engineering fee${job ? ` — ${job.name}` : ''}`,
      '',
      ...FEE_PHASES.filter(k => split[k] > 0).map(k => `${PROPOSAL_LABEL[k]}: ${fmtMoney(split[k])}`),
      `Total: ${fmtMoney(fee)}`,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      store.toast('Fee breakdown copied. Paste it into your proposal.')
    } catch {
      store.toast('Could not copy. Your browser blocked the clipboard.', 'error')
    }
  }

  if (!store.jobTypes.length) return <section className="card">
    <Empty icon={<Calculator size={22} />} title="Set up your job types" action={<button className="btn primary" onClick={() => edit.jobType(undefined, t => pickType(t.id))}><Plus size={16} /> Add a job type</button>}>
      List the kinds of jobs you do (ADU, beam replacement, retaining wall…) with the hours each usually takes. The estimator turns that into a fee, and gets more accurate as jobs of each type are finished.
    </Empty>
  </section>

  return <div className="est-layout">
      <section className="card card-pad est-pick-card">
        <div className="field-grid est-pickers">
          <Field label="Job type" htmlFor="est-type">
            <div className="row">
              <select id="est-type" className="input" value={type?.id ?? ''} onChange={e => pickType(e.target.value)}>
                {!type && <option value="">Choose a job type…</option>}
                {store.jobTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {type && <button className="btn icon" aria-label={`Edit ${type.name}`} title="Edit this job type" onClick={() => edit.jobType(type)}><Pencil size={15} /></button>}
              <button className="btn icon" aria-label="New job type" title="New job type" onClick={() => edit.jobType(undefined, t => pickType(t.id))}><Plus size={16} /></button>
            </div>
          </Field>
          <Field label="For job" htmlFor="est-job" hint="Optional. Pick one to save the fee to it.">
            <select id="est-job" className="input" value={job?.id ?? ''} onChange={e => pickJob(e.target.value)}>
              <option value="">No job, just estimating</option>
              {job && !openJobs.includes(job) && <option value={job.id}>{job.name}</option>}
              {openJobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `${j.job_number} · ` : ''}{j.name}</option>)}
            </select>
          </Field>
          <Field label="Your rate" htmlFor="est-rate">
            <NumberInput id="est-rate" value={rate} onChange={v => { setRate(v); setFeeOverride(null) }} step={5} min={0} prefix="$" suffix="/h" />
          </Field>
        </div>
      </section>

    <div className="stack loose est-details">
      {!type || !est ? <section className="card"><Empty compact icon={<Calculator size={20} />} title="Choose a job type">The estimate is based on that type's usual hours.</Empty></section> : <>
        <section className="card">
          <div className="card-head"><h2>Typical hours <span className="sub">{fmtHours(est.total)}</span></h2></div>
          <div className="card-body">
            {est.total <= 0 ? <p className="small muted">"{type.name}" has no hours yet. <button className="btn ghost xs" onClick={() => edit.jobType(type)}>Add your usual hours</button></p> :
              <ul className="est-phases">{FEE_PHASES.map(k => {
                const avg = est.finished.length ? est.finished.reduce((a, f) => a + f.hours[k], 0) / est.finished.length : null
                return <li key={k} data-stage={k}>
                  <div className="row between"><span className="strong small">{FEE_PHASE_LABEL[k]}</span><span className="small num"><strong>{fmtHours(est.hours[k])}</strong>{split && <span className="muted"> · {fmtMoney(split[k])}</span>}</span></div>
                  <div className="est-phase-track" aria-hidden="true">
                    <span className="est-phase-bar" style={{ width: `${est.hours[k] / maxHours * 100}%` }} />
                    {est.hasStarter && <span className="est-phase-tick" style={{ left: `${est.starter[k] / maxHours * 100}%` }} title="Your starter number" />}
                  </div>
                  <div className="tiny muted">{[est.hasStarter && `Starter ${fmtHours(est.starter[k])}`, avg != null && `finished jobs averaged ${fmtHours(avg)}`].filter(Boolean).join(' · ')}</div>
                </li>
              })}</ul>}
            <p className="tiny muted est-basis">
              {est.finished.length === 0
                ? 'Based on your starter numbers. Mark jobs of this type Complete and their real hours get blended in.'
                : est.hasStarter
                  ? `Blends your starter numbers (counted as ${STARTER_WEIGHT} jobs) with ${est.finished.length} finished job${est.finished.length === 1 ? '' : 's'}. The tick marks show your starter numbers.`
                  : `Average of ${est.finished.length} finished job${est.finished.length === 1 ? '' : 's'}.`}
            </p>
          </div>
        </section>

        <FinishedTable typeId={type.id} typeName={type.name} exceptJobId={job?.id} />
      </>}

      <JobTypesCard activeId={type?.id} onPick={pickType} />
    </div>

    {est && type && <aside className="card est-result" aria-live="polite">
      <div className="est-result-top">
        <span className="small muted">Suggested fee</span>
        <span className="est-fee num">{fmtMoney(suggested)}</span>
        <span className="small muted">{fmtHours(est.total)} × {fmtHourlyRate(r)}, rounded up to the next $50</span>
      </div>
      {est.low != null && est.high != null && <p className="small est-range">Finished jobs ran <strong>{fmtHours(est.low)} – {fmtHours(est.high)}</strong>, or {fmtMoney(roundFee(est.low * r))} – {fmtMoney(roundFee(est.high * r))} at this rate.</p>}
      {est.earnedPerHour != null && <p className={`small est-range ${est.earnedPerHour < r * 0.9 ? 'warn-text' : ''}`}>
        {est.earnedPerHour < r * 0.9 && <AlertTriangle size={14} className="inline-ico" />} Your fees on finished jobs worked out to <strong>{fmtHourlyRate(est.earnedPerHour)}</strong>{est.earnedPerHour < r * 0.9 ? `, less than your ${fmtHourlyRate(r)} rate.` : '.'}
      </p>}
      <div className="est-result-body">
        <Field label="Fee to quote" htmlFor="est-fee">
          <NumberInput id="est-fee" value={fee} onChange={v => setFeeOverride(v ?? 0)} step={50} min={0} prefix="$" />
        </Field>
        {feeOverride != null && feeOverride !== suggested && <button className="btn ghost xs" onClick={() => setFeeOverride(null)}>Use suggested {fmtMoney(suggested)}</button>}
        {split && fee > 0 && <ul className="est-split">{FEE_PHASES.filter(k => split[k] > 0).map(k => <li key={k} data-stage={k}><span className="dot" />{FEE_PHASE_LABEL[k]}<strong className="num">{fmtMoney(split[k])}</strong></li>)}</ul>}
        <div className="stack">
          {job
            ? <button className="btn primary" disabled={saving || fee <= 0} onClick={() => void saveToJob(job)}><Save size={16} /> {saving ? 'Saving…' : `Save to ${job.job_number || 'job'}`}</button>
            : <p className="tiny muted">Pick a job above to save this fee and the phase hours to it.</p>}
          <button className="btn" disabled={fee <= 0} onClick={() => void copyProposal()}><ClipboardCopy size={16} /> Copy for proposal</button>
        </div>
        {job && <p className="tiny muted">Saving sets the job's fee, its type, and the hour estimates on its Design, Plan check and Construction phases. <Link to={`/jobs/${job.id}`}>Open job</Link></p>}
      </div>
    </aside>}
  </div>
}

function FinishedTable({ typeId, typeName, exceptJobId }: { typeId: string; typeName: string; exceptJobId?: string }) {
  const store = useData()
  const list = useMemo(() => finishedJobs(store, typeId, exceptJobId), [store, typeId, exceptJobId])
  return <section className="card">
    <div className="card-head"><h2>Finished {typeName} jobs <span className="count">{list.length}</span></h2></div>
    {list.length === 0 ? <Empty compact title="None finished yet">When a job of this type is marked Complete, its logged hours show up here and shape the estimate.</Empty> :
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Job</th><th className="num hide-sm">Design</th><th className="num hide-sm">Plan check</th><th className="num hide-sm">Construction</th><th className="num">Total</th><th className="num">Fee</th><th className="num hide-sm">Earned per hour</th></tr></thead>
        <tbody>{list.map(f => <tr key={f.job.id}>
          <td><Link to={`/jobs/${f.job.id}`} className="strong">{f.job.name}</Link>{f.job.job_number && <div className="tiny muted">{f.job.job_number}</div>}</td>
          {FEE_PHASES.map(k => <td key={k} className="num hide-sm">{f.hours[k] ? fmtHours(f.hours[k]) : <span className="muted">—</span>}</td>)}
          <td className="num strong">{fmtHours(f.total)}</td>
          <td className="num">{f.revenue > 0 ? fmtMoney(f.revenue) : <span className="muted">—</span>}</td>
          <td className="num hide-sm">{f.revenue > 0 && f.allHours > 0 ? fmtHourlyRate(f.revenue / f.allHours) : <span className="muted">—</span>}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>
}

function JobTypesCard({ activeId, onPick }: { activeId?: string; onPick: (id: string) => void }) {
  const store = useData()
  const edit = useEditors()
  const counts = (id: string) => store.jobs.filter(j => j.job_type_id === id).length
  return <section className="card">
    <div className="card-head"><h2>Job types</h2><button className="btn sm" onClick={() => edit.jobType(undefined, t => onPick(t.id))}><Plus size={15} /> Add</button></div>
    <ul className="list">{store.jobTypes.map(t => { const total = Number(t.design_hours) + Number(t.plan_check_hours) + Number(t.construction_hours); const n = counts(t.id); return <li key={t.id} className={`list-row ${t.id === activeId ? 'est-type-on' : ''}`}>
      <button className="grow est-type-pick" onClick={() => onPick(t.id)}>
        <span className="title">{t.name}</span>
        <span className="meta">{total > 0 ? `Starter ${fmtHours(total)}` : 'No starter hours'} · {n} job{n === 1 ? '' : 's'}</span>
      </button>
      <button className="btn ghost icon sm" aria-label={`Edit ${t.name}`} onClick={() => edit.jobType(t)}><Pencil size={15} /></button>
    </li> })}</ul>
  </section>
}
