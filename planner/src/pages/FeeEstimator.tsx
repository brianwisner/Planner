// Money → Fee estimator: suggests a fee from a job type's usual hours, blended
// with the real hours on finished jobs of that type. The owner adjusts hours,
// site visits, an allowance and rush premium; saving keeps the quote so the
// job's real hours can be compared with it later.
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Calculator, ClipboardCopy, EyeOff, Mail, Pencil, Plus, RotateCcw, Save, Sparkles, Undo2 } from 'lucide-react'
import { useData } from '../lib/store'
import { EMAIL_TARGET, useEmailLink } from '../lib/email'
import { useEditors } from '../components/editors'
import { Empty, Field, Modal, NumberInput, useConfirm } from '../components/ui'
import { guessJobType } from '../lib/jobTyping'
import {
  closeoutReasons, estimateHours, excludedJobs, fallbackHours, FEE_PHASES, FEE_PHASE_LABEL, finishedJobs, halfHours, overruns, pastEvidence, perUnit, priceEstimate,
  proposalText, quotedHours, splitFee, STARTER_WEIGHT, unitScale, type Estimate, type FeePhase, type PastEvidence, type PhaseHours,
} from '../lib/estimate'
import { jobPhaseGroups } from '../lib/phases'
import type { Job, JobType, PastJob } from '../lib/types'
import { fmtDate, fmtHourlyRate, fmtHours, fmtMoney } from '../lib/utils'

export function FeeEstimator({ jobId, typeId, patch }: { jobId: string; typeId: string; patch: (n: Record<string, string | null>) => void }) {
  const store = useData()
  const edit = useEditors()
  const job = store.jobs.find(j => j.id === jobId)
  // A job without a type gets one guessed from its name and scope.
  const guessed = job && !job.job_type_id && !typeId ? guessJobType(store, job) : null
  const type = store.jobTypes.find(t => t.id === (typeId || job?.job_type_id)) ?? guessed?.type
  const [rate, setRate] = useState<number | null>(store.me?.hourly_rate ?? store.settings.default_rate)
  const openJobs = store.jobs.filter(j => j.status === 'active' || j.status === 'on_hold')

  const pickType = (id: string) => patch({ type: id || null })
  function pickJob(id: string) {
    const j = store.jobs.find(x => x.id === id)
    patch({ job: id || null, type: j?.job_type_id ? null : type?.id ?? null })
  }

  if (!store.jobTypes.length) return <section className="card">
    <Empty icon={<Calculator size={22} />} title="Set up your job types" action={<button className="btn primary" onClick={() => edit.jobType(undefined, t => pickType(t.id))}><Plus size={16} /> Add a job type</button>}>
      List the kinds of jobs you do (ADU, beam replacement, retaining wall…) with the hours each usually takes. The estimator turns that into a fee, and gets more accurate as jobs of each type are finished.
    </Empty>
  </section>

  const picker = <section className="card card-pad est-pick-card">
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
      <Field label="For job" htmlFor="est-job" hint="Optional. Pick one to save the quote to it.">
        <select id="est-job" className="input" value={job?.id ?? ''} onChange={e => pickJob(e.target.value)}>
          <option value="">No job, just estimating</option>
          {job && !openJobs.includes(job) && <option value={job.id}>{job.name}</option>}
          {openJobs.map(j => <option key={j.id} value={j.id}>{j.job_number ? `${j.job_number} · ` : ''}{j.name}</option>)}
        </select>
      </Field>
      <Field label="Your rate" htmlFor="est-rate">
        <NumberInput id="est-rate" value={rate} onChange={setRate} step={5} min={0} prefix="$" suffix="/h" />
      </Field>
    </div>
    {guessed && <p className="tiny muted est-guess"><Sparkles size={12} className="inline-ico" /> Type guessed from the job's name and scope{guessed.matched.length ? ` (“${guessed.matched[0]}”)` : ''}. Saving the quote sets it on the job.</p>}
  </section>

  if (!type) return <div className="est-layout">
    {picker}
    <div className="stack loose est-details">
      <section className="card"><Empty compact icon={<Calculator size={20} />} title="Choose a job type">The estimate starts from that type's usual hours.</Empty></section>
      <JobTypesCard onPick={pickType} />
    </div>
  </div>

  // A new type or job starts a fresh estimate; the rate carries over.
  return <EstimateBody key={`${type.id}:${job?.id ?? ''}`} type={type} job={job} rate={rate ?? 0} picker={picker} onPickType={pickType} />
}

function EstimateBody({ type, job, rate, picker, onPickType }: { type: JobType; job?: Job; rate: number; picker: ReactNode; onPickType: (id: string) => void }) {
  const store = useData()
  const edit = useEditors()
  const confirm = useConfirm()
  const emailLink = useEmailLink()
  const { settings } = store
  const est = useMemo(() => estimateHours(store, type, job?.id), [store, type, job?.id])
  const client = store.clients.find(c => c.id === job?.client_id)

  const [hours, setHours] = useState<Partial<PhaseHours>>({})
  const usualVisits = Number(type.site_visits) || 0
  const [visits, setVisits] = useState<number | null>(usualVisits)
  const [visitHours, setVisitHours] = useState<number | null>(Number(settings.site_visit_hours) || 0)
  const [allowance, setAllowance] = useState<number | null>(0)
  const [rush, setRush] = useState<number | null>(0)
  const [size, setSize] = useState<number | null>(job?.size ?? null)
  const [feeOverride, setFeeOverride] = useState<number | null>(null)
  const [feeNote, setFeeNote] = useState('')
  const [showBreakdown, setShowBreakdown] = useState(true)
  const [saving, setSaving] = useState(false)

  // No hours for this type yet: start from the average of your other types.
  const fallback = est.total <= 0 ? fallbackHours(store, type.id) : null
  const source = fallback?.hours ?? est.hours
  const typical: PhaseHours = { design: quarter(source.design), plan_check: quarter(source.plan_check), construction: quarter(source.construction) }
  const past = pastEvidence(store, type.id)
  const base: PhaseHours = { design: hours.design ?? typical.design, plan_check: hours.plan_check ?? typical.plan_check, construction: hours.construction ?? typical.construction }
  const extraVisitHours = ((visits ?? 0) - usualVisits) * (visitHours ?? 0)
  const priced = priceEstimate({ hours: base, visits: visits ?? 0, usualVisits, visitHours: visitHours ?? 0, allowance: allowance ?? 0, rushPercent: rush ?? 0, rate, minimumFee: Number(settings.minimum_fee) || 0 })
  const fee = feeOverride ?? priced.suggested
  const diff = fee - priced.suggested
  const split = splitFee(fee, priced.phases)
  const maxHours = Math.max(1, ...FEE_PHASES.map(k => Math.max(base[k], est.starter[k], est.hours[k])))
  const flags = overruns(est.finished)
  const reasons = closeoutReasons(est.finished)
  const unit = type.size_unit.trim()
  const pu = unit ? perUnit(est.finished) : null
  const text = proposalText(settings.proposal_template, { job, client: client?.name, fee, split, showBreakdown, visits: visits ?? 0, retainerPercent: Number(settings.retainer_percent) || 0, today: new Date() })
  const edited = FEE_PHASES.some(k => hours[k] != null && hours[k] !== typical[k])

  async function saveToJob(target: Job) {
    if (saving) return
    if (diff !== 0 && !feeNote.trim() && !await confirm({ title: 'Save without a reason?', body: `Your fee is ${fmtMoney(Math.abs(diff))} ${diff < 0 ? 'below' : 'above'} the suggestion. A short reason helps when you look back at this job.`, confirmLabel: 'Save anyway' })) return
    const phases = jobPhaseGroups(store.phases, target.id).workflow.filter(p => (FEE_PHASES as readonly string[]).includes(p.kind))
    const next = phases.map(p => ({ phase: p, hours: halfHours(priced.phases[p.kind as FeePhase]) }))
    const replacing = (target.fee != null && target.fee !== fee) || next.some(n => n.phase.estimate_hours > 0 && n.phase.estimate_hours !== n.hours)
    if (replacing && !await confirm({
      title: `Replace the fee and estimates on ${target.name}?`,
      body: `Fee ${fmtMoney(target.fee)} → ${fmtMoney(fee)}. ${next.map(n => `${FEE_PHASE_LABEL[n.phase.kind as FeePhase]} ${fmtHours(n.phase.estimate_hours)} → ${fmtHours(n.hours)}`).join(', ')}. Earlier quotes stay on record, and you can undo this right after.`,
      confirmLabel: 'Replace',
    })) return
    const before = { fee: target.fee, job_type_id: target.job_type_id, size: target.size, phases: phases.map(p => ({ id: p.id, estimate_hours: p.estimate_hours })) }
    setSaving(true)
    const quote = await store.insert('quotes', {
      job_id: target.id, job_type_id: type.id, rate, size,
      design_hours: halfHours(priced.phases.design), plan_check_hours: halfHours(priced.phases.plan_check), construction_hours: halfHours(priced.phases.construction),
      site_visits: visits ?? 0, visit_hours: visitHours ?? 0, allowance_hours: allowance ?? 0, rush_percent: rush ?? 0,
      suggested_fee: priced.suggested, fee, fee_note: feeNote.trim(),
    })
    const results = quote ? await Promise.all([
      store.update('jobs', target.id, { fee, job_type_id: type.id, size }),
      ...next.map(n => store.update('phases', n.phase.id, { estimate_hours: n.hours })),
    ]) : [false]
    setSaving(false)
    if (quote && results.every(Boolean)) store.toast(`Quote of ${fmtMoney(fee)} saved to ${target.name}`, 'ok', {
      label: 'Undo',
      run: () => Promise.all([
        store.remove('quotes', quote.id),
        store.update('jobs', target.id, { fee: before.fee, job_type_id: before.job_type_id, size: before.size }),
        ...before.phases.map(p => store.update('phases', p.id, { estimate_hours: p.estimate_hours })),
      ]),
    })
  }

  async function copyProposal() {
    try {
      await navigator.clipboard.writeText(text)
      store.toast('Proposal copied. Paste it into your document or email.')
    } catch {
      store.toast('Could not copy. Your browser blocked the clipboard.', 'error')
    }
  }

  return <div className="est-layout">
    {picker}

    <div className="stack loose est-details">
      <section className="card">
        <div className="card-head"><h2>Hours <span className="sub">{fmtHours(priced.total)} total</span></h2>
          {edited && <button className="btn ghost xs" onClick={() => setHours({})}><RotateCcw size={13} /> Use typical hours</button>}
        </div>
        <div className="card-body">
          {est.total <= 0 && !edited && <p className="form-note small">{fallback
            ? <>"{type.name}" has no hours yet, so this is a best guess: the average of your other {fallback.types} job types. Adjust the hours below, or </>
            : <>"{type.name}" has no hours yet. Type your estimate below, or </>}<button className="btn ghost xs" onClick={() => edit.jobType(type)}>add usual hours to the job type</button>.</p>}
          <ul className="est-phases">{FEE_PHASES.map(k => {
            const avg = est.finished.length ? est.finished.reduce((a, f) => a + f.hours[k], 0) / est.finished.length : null
            const flag = flags.find(f => f.phase === k)
            return <li key={k} data-stage={k}>
              <div className="est-phase-row">
                <label className="strong small" htmlFor={`est-h-${k}`}>{FEE_PHASE_LABEL[k]}</label>
                <div className="est-phase-track" aria-hidden="true">
                  <span className="est-phase-bar" style={{ width: `${Math.min(100, base[k] / maxHours * 100)}%` }} />
                  {est.hasStarter && <span className="est-phase-tick" style={{ left: `${est.starter[k] / maxHours * 100}%` }} title="Your starter number" />}
                </div>
                <NumberInput id={`est-h-${k}`} className="est-h-input" value={base[k]} onChange={v => setHours(h => ({ ...h, [k]: v ?? 0 }))} step={0.5} min={0} suffix="h" />
              </div>
              <div className="tiny muted">{[
                `Typical ${fmtHours(est.hours[k])}`,
                est.hasStarter && `starter ${fmtHours(est.starter[k])}`,
                avg != null && `finished jobs averaged ${fmtHours(avg)}`,
              ].filter(Boolean).join(' · ')}</div>
              {flag && <div className="tiny warn-text"><AlertTriangle size={12} className="inline-ico" /> Ran over its quote on {flag.over} of the last {flag.of} jobs, by {fmtHours(flag.avgOver)} on average.</div>}
            </li>
          })}</ul>

          <div className="est-extras">
            <Field label="Site visits" htmlFor="est-visits" hint={extraVisitHours === 0 ? (usualVisits ? `${usualVisits} is usual for this type, already in Construction` : 'Each visit adds to Construction') : `${extraVisitHours > 0 ? '+' : '−'}${fmtHours(Math.abs(extraVisitHours))} on Construction (usual is ${usualVisits})`}>
              <div className="row est-visit-row">
                <NumberInput id="est-visits" value={visits} onChange={setVisits} step={1} min={0} ariaLabel="Number of site visits" />
                <span className="small muted">×</span>
                <NumberInput value={visitHours} onChange={setVisitHours} step={0.5} min={0} suffix="h" ariaLabel="Hours per visit, including travel" />
              </div>
            </Field>
            <Field label="Allowance for unknowns" htmlFor="est-allow" hint="Shared across the phases. For your eyes only.">
              <NumberInput id="est-allow" value={allowance} onChange={setAllowance} step={1} min={0} suffix="h" />
            </Field>
            <Field label="Rush premium" htmlFor="est-rush" hint="Added to the fee for a tight schedule.">
              <NumberInput id="est-rush" value={rush} onChange={setRush} step={5} min={0} suffix="%" />
            </Field>
            {unit && <Field label={`Size (${unit})`} htmlFor="est-size" hint="Saved with the quote, to compare similar jobs.">
              <NumberInput id="est-size" value={size} onChange={setSize} step={10} min={0} placeholder="Optional" />
            </Field>}
          </div>

          <Basis est={est} />
          {reasons.length > 0 && <p className="tiny muted" style={{ margin: '6px 0 0' }}>What you noted on finished jobs: {reasons.map(([r, n]) => `${r} (${n})`).join(', ')}.</p>}
        </div>
      </section>

      <FinishedTable typeId={type.id} type={type} exceptJobId={job?.id} />
      <JobTypesCard activeId={type.id} onPick={onPickType} />
    </div>

    <aside className="card est-result" aria-live="polite">
      <div className="est-result-top">
        <span className="small muted">Suggested fee</span>
        <span className="est-fee num">{fmtMoney(priced.suggested)}</span>
        <span className="small muted">
          {priced.minimumApplied
            ? `Your minimum fee. The hours come to ${fmtMoney(priced.raw)}.`
            : `${fmtHours(priced.total)} × ${fmtHourlyRate(rate)}${(rush ?? 0) > 0 ? ` + ${rush}% rush` : ''}, rounded up to the next $50`}
        </span>
      </div>
      <Evidence est={est} rate={rate} size={size} unit={unit} pu={pu} past={past} />
      <div className="est-result-body">
        <Field label="Fee to quote" htmlFor="est-fee">
          <NumberInput id="est-fee" value={fee} onChange={v => setFeeOverride(v ?? 0)} step={50} min={0} prefix="$" />
        </Field>
        {diff !== 0 && <div className="est-diff">
          <div className="row between"><span className={`small ${diff < 0 ? 'warn-text' : ''}`}>{fmtMoney(Math.abs(diff))} {diff < 0 ? 'below' : 'above'} the suggestion · {fee > 0 && priced.total > 0 ? `${fmtHourlyRate(fee / priced.total)} for these hours` : ''}</span>
            <button className="btn ghost xs" onClick={() => { setFeeOverride(null); setFeeNote('') }}><Undo2 size={13} /> Reset</button></div>
          <input className="input sm" value={feeNote} onChange={e => setFeeNote(e.target.value)} placeholder="Why? e.g. repeat client, matched last year's fee" aria-label="Reason for the different fee" />
        </div>}
        {fee > 0 && <ul className="est-split">{FEE_PHASES.filter(k => split[k] > 0).map(k => <li key={k} data-stage={k}><span className="dot" />{FEE_PHASE_LABEL[k]}<span className="tiny muted">{fmtHours(priced.phases[k])}</span><strong className="num">{fmtMoney(split[k])}</strong></li>)}</ul>}
        <label className="switch small"><input type="checkbox" checked={showBreakdown} onChange={e => setShowBreakdown(e.target.checked)} /> Show the fee by phase on the proposal</label>
        <div className="stack">
          {job
            ? <button className="btn primary" disabled={saving || fee <= 0} onClick={() => void saveToJob(job)}><Save size={16} /> {saving ? 'Saving…' : `Save quote to ${job.job_number || 'job'}`}</button>
            : <p className="tiny muted">Pick a job above to save this quote to it.</p>}
          <div className="est-actions-row">
            <button className="btn" disabled={fee <= 0} onClick={() => void copyProposal()}><ClipboardCopy size={16} /> Copy proposal</button>
            {client?.email && <a className="btn" href={emailLink(client.email, `Proposal: ${job?.name ?? type.name}`, text)} {...EMAIL_TARGET}><Mail size={16} /> Email</a>}
          </div>
        </div>
        <details className="est-preview">
          <summary className="small">Preview proposal</summary>
          <pre>{text}</pre>
          <p className="tiny muted">Change the wording in <Link to="/settings#estimator">Settings → Fee estimator</Link>.</p>
        </details>
        {job && <p className="tiny muted">Saving keeps this quote on the job, and sets the job's fee, type, size and the hour estimates on its Design, Plan check and Construction phases. <Link to={`/jobs/${job.id}`}>Open job</Link></p>}
      </div>
    </aside>
  </div>
}

const quarter = (n: number) => Math.round(n * 4) / 4

function Basis({ est }: { est: Estimate }) {
  const n = est.finished.length
  return <>
    <p className="tiny muted est-basis">
      {n === 0
        ? est.hasStarter ? 'Starter estimate only. Mark jobs of this type Complete and their real hours get blended in.' : 'No starter hours and no finished jobs yet.'
        : est.hasStarter
          ? `Based on your starter estimate (counted as ${STARTER_WEIGHT} jobs) and ${n} finished job${n === 1 ? '' : 's'}. The tick marks show your starter numbers.`
          : `Average of ${n} finished job${n === 1 ? '' : 's'}.`}
    </p>
    {est.unphased > 0 && <p className="tiny warn-text" style={{ margin: '6px 0 0' }}><AlertTriangle size={12} className="inline-ico" /> {fmtHours(est.unphased)} on finished jobs were logged with no phase and are counted as Design. Assign them a phase on each job's Hours tab for a cleaner estimate.</p>}
  </>
}

function Evidence({ est, rate, size, unit, pu, past }: { est: Estimate; rate: number; size: number | null; unit: string; pu: ReturnType<typeof perUnit>; past: PastEvidence | null }) {
  const covered = est.earnedPerHour != null && est.rateThen ? est.earnedPerHour / est.rateThen : null
  const scale = pu ? unitScale(pu.hours) : 1
  return <>
    {past && <p className="small est-range">
      Before the planner you charged <strong>{past.jobs.length === 1 ? fmtMoney(past.low) : `${fmtMoney(past.low)} to ${fmtMoney(past.high)}`}</strong> for {past.jobs.length} job{past.jobs.length === 1 ? '' : 's'} like this{past.jobs.length >= 3 ? `, middle ${fmtMoney(past.middle)}` : ''}.
    </p>}
    {est.low != null && est.high != null && <p className="small est-range">
      Past jobs ranged from <strong>{fmtHours(est.low)} to {fmtHours(est.high)}</strong>{est.median != null ? `, middle job ${fmtHours(est.median)}` : ''}. At {fmtHourlyRate(rate)} that's {fmtMoney(est.low * rate)} to {fmtMoney(est.high * rate)}.
    </p>}
    {est.earnedPerHour != null && <p className={`small est-range ${covered != null && covered < 0.9 ? 'warn-text' : ''}`}>
      {covered != null && covered < 0.9 && <AlertTriangle size={14} className="inline-ico" />} Finished jobs earned <strong>{fmtHourlyRate(est.earnedPerHour)}</strong>
      {covered != null && ` — ${Math.round(covered * 100)}% of the ${fmtHourlyRate(est.rateThen)} you were charging then`}. Counts every hour, including bidding and client changes.
    </p>}
    {pu && <p className="small est-range">
      Past jobs took {fmtHours(pu.hours * scale)} per {scale > 1 ? scale.toLocaleString() + ' ' : ''}{unit}{pu.fee != null ? ` and earned ${fmtMoney(pu.fee * scale)} per ${scale > 1 ? scale.toLocaleString() + ' ' : ''}${unit}` : ''}
      {size ? ` — about ${fmtHours(pu.hours * size)}${pu.fee != null ? ` / ${fmtMoney(pu.fee * size)}` : ''} at this size` : ''}. A cross-check only ({pu.jobs} job{pu.jobs === 1 ? '' : 's'}).
    </p>}
  </>
}

function FinishedTable({ typeId, type, exceptJobId }: { typeId: string; type: JobType; exceptJobId?: string }) {
  const store = useData()
  const list = useMemo(() => finishedJobs(store, typeId, exceptJobId), [store, typeId, exceptJobId])
  const left = excludedJobs(store, typeId).filter(j => j.id !== exceptJobId)
  const records = store.pastJobs.filter(p => p.job_type_id === typeId)
  const unit = type.size_unit.trim()
  function setRecordUse(p: PastJob, use: boolean) {
    void store.update('past_jobs', p.id, { use_in_estimates: use }).then(ok => {
      if (ok) store.toast(use ? `${p.name} is back in your estimates` : `${p.name} left out of estimates`, 'ok', { label: 'Undo', run: () => store.update('past_jobs', p.id, { use_in_estimates: !use }) })
    })
  }
  function setUse(job: Job, use: boolean) {
    const before = { use_in_estimates: job.use_in_estimates, estimate_note: job.estimate_note }
    void store.update('jobs', job.id, { use_in_estimates: use }).then(ok => {
      if (ok) store.toast(use ? `${job.name} is back in your estimates` : `${job.name} left out of estimates. Add a reason in the job's details.`, 'ok', { label: 'Undo', run: () => store.update('jobs', job.id, before) })
    })
  }
  return <section className="card">
    <div className="card-head"><h2>Finished {type.name} jobs <span className="count">{list.length}</span></h2></div>
    {list.length === 0 ? <Empty compact title="None finished yet">When a job of this type is marked Complete, its logged hours show up here and shape the estimate.</Empty> :
      <div className="table-wrap"><table className="table est-table">
        <thead><tr><th>Job</th>{unit && <th className="num hide-sm">Size</th>}<th className="num hide-sm">Design</th><th className="num hide-sm">Plan check</th><th className="num hide-sm">Construction</th><th className="num">Total</th><th className="num">Fee</th><th className="num hide-sm">Per hour</th><th /></tr></thead>
        <tbody>{list.map(f => { const q = f.quote ? quotedHours(f.quote) : null; return <tr key={f.job.id}>
          <td>
            <Link to={`/jobs/${f.job.id}`} className="strong">{f.job.name}</Link>
            <div className="tiny muted">{[f.job.job_number, f.job.closeout_reason].filter(Boolean).join(' · ')}</div>
            {f.unphased > 0 && <Link to={`/jobs/${f.job.id}?tab=time`} className="badge warn est-badge">{fmtHours(f.unphased)} with no phase</Link>}
          </td>
          {unit && <td className="num hide-sm">{f.job.size ? f.job.size.toLocaleString() : <span className="muted">—</span>}</td>}
          {FEE_PHASES.map(k => <td key={k} className="num hide-sm">{f.hours[k] ? fmtHours(f.hours[k]) : <span className="muted">—</span>}{q && <div className={`tiny ${f.hours[k] - q[k] >= 1 ? 'danger-text' : 'muted'}`}>quoted {fmtHours(q[k])}</div>}</td>)}
          <td className="num strong">{fmtHours(f.total)}</td>
          <td className="num">{f.revenue > 0 ? fmtMoney(f.revenue) : <span className="muted">—</span>}</td>
          <td className="num hide-sm">{f.revenue > 0 && f.allHours > 0 ? fmtHourlyRate(f.revenue / f.allHours) : <span className="muted">—</span>}</td>
          <td className="right"><button className="btn ghost icon xs" onClick={() => setUse(f.job, false)} aria-label={`Leave ${f.job.name} out of estimates`} title="Leave out of estimates (e.g. it stopped early or the hours are incomplete)"><EyeOff size={14} /></button></td>
        </tr> })}</tbody>
      </table></div>}
    {left.length > 0 && <div className="card-foot est-left">
      <span className="tiny muted">Left out of estimates:</span>
      {left.map(j => <span key={j.id} className="est-left-item small"><Link to={`/jobs/${j.id}`}>{j.name}</Link>{j.estimate_note && <span className="muted"> ({j.estimate_note})</span>}<button className="btn ghost xs" onClick={() => setUse(j, true)}>Use again</button></span>)}
    </div>}
    {records.length > 0 && <>
      <div className="card-head est-records-head"><h2>From your records <span className="count">{records.length}</span></h2><span className="sub">Before the planner: invoices, emails and files</span></div>
      <div className="table-wrap"><table className="table est-table">
        <thead><tr><th>Job</th><th className="hide-sm">When</th>{unit && <th className="num hide-sm">Size</th>}<th className="num">Fee</th><th /></tr></thead>
        <tbody>{records.map(p => <tr key={p.id} className={p.use_in_estimates === false ? 'est-off' : ''}>
          <td><span className="strong">{p.name}</span><div className="tiny muted clamp-2">{[p.client, p.scope].filter(Boolean).join(' · ')}</div>{p.source && <div className="tiny muted">{p.source}</div>}</td>
          <td className="hide-sm nowrap small">{p.date ? fmtDate(p.date) + ' ' + p.date.slice(0, 4) : '—'}</td>
          {unit && <td className="num hide-sm">{p.size ? p.size.toLocaleString() : <span className="muted">—</span>}</td>}
          <td className="num">{p.fee != null ? fmtMoney(p.fee) : <span className="muted">—</span>}{p.hours != null && <div className="tiny muted">{fmtHours(p.hours)}</div>}</td>
          <td className="right">{p.use_in_estimates === false
            ? <button className="btn ghost xs" onClick={() => setRecordUse(p, true)}>Use again</button>
            : <button className="btn ghost icon xs" onClick={() => setRecordUse(p, false)} aria-label={`Leave ${p.name} out of estimates`} title="Leave out of estimates"><EyeOff size={14} /></button>}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>
}

function JobTypesCard({ activeId, onPick }: { activeId?: string; onPick: (id: string) => void }) {
  const store = useData()
  const edit = useEditors()
  const [sorting, setSorting] = useState(false)
  const counts = (id: string) => store.jobs.filter(j => j.job_type_id === id).length
  const untyped = store.jobs.filter(j => !j.job_type_id && j.status !== 'archived')
  return <section className="card">
    <div className="card-head"><h2>Job types</h2><button className="btn sm" onClick={() => edit.jobType(undefined, t => onPick(t.id))}><Plus size={15} /> Add</button></div>
    {untyped.length > 0 && <div className="est-untyped">
      <span className="small">{untyped.length} job{untyped.length === 1 ? ' has' : 's have'} no type, so the estimator can't learn from {untyped.length === 1 ? 'it' : 'them'}.</span>
      <button className="btn sm soft" onClick={() => setSorting(true)}><Sparkles size={14} /> Sort them</button>
    </div>}
    {sorting && <SortJobs jobs={untyped} onClose={() => setSorting(false)} />}
    <ul className="list">{store.jobTypes.map(t => { const total = Number(t.design_hours) + Number(t.plan_check_hours) + Number(t.construction_hours); const n = counts(t.id); return <li key={t.id} className={`list-row ${t.id === activeId ? 'est-type-on' : ''}`}>
      <button className="grow est-type-pick" onClick={() => onPick(t.id)}>
        <span className="title">{t.name}</span>
        <span className="meta">{total > 0 ? `Starter ${fmtHours(total)}` : 'No starter hours'}{Number(t.site_visits) > 0 ? ` · ${t.site_visits} visit${Number(t.site_visits) === 1 ? '' : 's'}` : ''} · {n} job{n === 1 ? '' : 's'}</span>
      </button>
      <button className="btn ghost icon sm" aria-label={`Edit ${t.name}`} onClick={() => edit.jobType(t)}><Pencil size={15} /></button>
    </li> })}</ul>
  </section>
}

/** Suggest a type for every job without one, and save them all at once. */
function SortJobs({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  const store = useData()
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(jobs.map(j => [j.id, guessJobType(store, j)?.type.id ?? ''])))
  const [busy, setBusy] = useState(false)
  const chosen = jobs.filter(j => picks[j.id])
  async function save() {
    if (busy || !chosen.length) return
    setBusy(true)
    const results = await Promise.all(chosen.map(j => store.update('jobs', j.id, { job_type_id: picks[j.id] })))
    setBusy(false)
    const done = chosen.filter((_, i) => results[i])
    store.toast(`Set the type on ${done.length} job${done.length === 1 ? '' : 's'}`, 'ok', { label: 'Undo', run: () => Promise.all(done.map(j => store.update('jobs', j.id, { job_type_id: null }))) })
    onClose()
  }
  return <Modal title="Sort jobs into types" subtitle="Guessed from each job's name and scope. Change any that are wrong, or leave them blank." size="wide" onClose={onClose}
    footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !chosen.length} onClick={() => void save()}>{busy ? 'Saving…' : `Save ${chosen.length} type${chosen.length === 1 ? '' : 's'}`}</button></>}>
    <ul className="list est-sort-list">{jobs.map(j => { const g = guessJobType(store, j); return <li key={j.id} className="list-row">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title truncate">{j.name}</div>
        <div className="meta truncate">{[store.clients.find(c => c.id === j.client_id)?.name, j.description].filter(Boolean).join(' · ') || 'No scope written'}{g && picks[j.id] === g.type.id ? ` · guessed from “${g.matched[0] ?? g.type.name}”` : ''}</div>
      </div>
      <select className="input sm est-sort-select" value={picks[j.id] ?? ''} aria-label={`Type for ${j.name}`} onChange={e => setPicks(p => ({ ...p, [j.id]: e.target.value }))}>
        <option value="">No type</option>
        {store.jobTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </li> })}</ul>
  </Modal>
}
