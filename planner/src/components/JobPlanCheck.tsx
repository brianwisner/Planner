// The job page's Plan check tab: each round of the reviewer's comments, your
// response to each one, a tick when it's done, and the response letter.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, ClipboardCheck, Ellipsis, FileText, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useData } from '../lib/store'
import { commentLabel, jobRounds, markRoundSent, parseComments, roundComments, startPlanCheckWork } from '../lib/planCheck'
import type { PlanCheckComment, PlanCheckRound } from '../lib/types'
import { fmtDate, todayISO } from '../lib/utils'
import { Empty, Field, Menu, Modal, Progress, TaskCheck, useConfirm, type MenuEntry } from './ui'
import './planCheck.css'

export function JobPlanCheck({ jobId }: { jobId: string }) {
  const store = useData()
  const rounds = jobRounds(store, jobId)
  const latest = rounds[rounds.length - 1]
  const [adding, setAdding] = useState<{ round?: PlanCheckRound } | null>(null)
  const [editing, setEditing] = useState<PlanCheckRound | null>(null)

  return <div className="stack loose">
    {!latest
      ? <section className="card"><Empty icon={<ClipboardCheck size={22} />} title="No plan check comments yet"
        action={<button className="btn primary" onClick={() => setAdding({})}><Plus size={16} /> Add comments</button>}>
        When the reviewer's comment letter comes in, paste it here. Each comment becomes a line to answer and tick off, and the planner writes the response letter for you.
      </Empty></section>
      : <>
        {[...rounds].reverse().map(r => <RoundCard key={r.id} round={r} latest={r.id === latest.id} onAdd={() => setAdding({ round: r })} onEdit={() => setEditing(r)} />)}
        {latest.sent_date && <button className="btn soft pc-next" onClick={() => setAdding({})}><Plus size={16} /> Next round of comments</button>}
      </>}
    {adding && <AddCommentsDialog jobId={jobId} round={adding.round} previous={latest} onClose={() => setAdding(null)} />}
    {editing && <RoundEditor round={editing} onClose={() => setEditing(null)} />}
  </div>
}

/* ---------------- One round ---------------- */

function RoundCard({ round, latest, onAdd, onEdit }: { round: PlanCheckRound; latest: boolean; onAdd: () => void; onEdit: () => void }) {
  const store = useData()
  const navigate = useNavigate()
  const comments = roundComments(store, round.id)
  const done = comments.filter(c => c.done).length
  const [open, setOpen] = useState(latest)
  const [editing, setEditing] = useState<PlanCheckComment | null>(null)
  const letter = `/jobs/${round.job_id}/plan-check/${round.id}`
  const menu: MenuEntry[] = [
    { label: 'Add more comments', icon: <Plus size={15} />, onSelect: onAdd },
    { label: 'Edit details', icon: <Pencil size={15} />, onSelect: onEdit },
    round.sent_date
      ? { label: 'Not sent yet', icon: <Send size={15} />, onSelect: () => void store.update('plan_check_rounds', round.id, { sent_date: null }) }
      : { label: 'Mark responses sent', icon: <Send size={15} />, onSelect: () => void markRoundSent(store, round) },
  ]
  const facts = [round.permit_number && `Permit ${round.permit_number}`, round.reviewer && `Reviewer: ${round.reviewer}`, round.received_date && `Comments dated ${fmtDate(round.received_date)}`].filter(Boolean)

  return <section className="card pc-round">
    <div className="card-head">
      <button className="pc-round-title" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        <h2>Round {round.round}{round.agency && <span className="sub">{round.agency}</span>}</h2>
      </button>
      <div className="row">
        {round.sent_date ? <span className="badge ok">Sent {fmtDate(round.sent_date)}</span> : <span className={`badge ${done === comments.length && comments.length ? 'ok' : ''}`}>{done} of {comments.length} done</span>}
        <Link className="btn sm hide-sm" to={letter}><FileText size={15} /> Response letter</Link>
        <Menu label="Round actions" items={[{ label: 'Response letter', icon: <FileText size={15} />, onSelect: () => navigate(letter) }, ...menu]} trigger={p => <button className="btn ghost icon sm" aria-label="Round actions" {...p}><Ellipsis size={17} /></button>} />
      </div>
    </div>
    {open && <>
      <div className="pc-round-meta">
        {facts.length > 0 && <span className="small muted">{facts.join(' · ')}</span>}
        {comments.length > 0 && <Progress value={done} max={comments.length} tone={done === comments.length ? 'ok' : undefined} />}
      </div>
      {!round.sent_date && comments.length > 0 && done === comments.length && <div className="form-note info pc-ready">
        <span className="grow">Every comment is answered. Print the response letter, send it with the revised sheets, then mark it sent.</span>
        <Link className="btn sm primary" to={letter}><FileText size={15} /> Response letter</Link>
        <button className="btn sm" onClick={() => void markRoundSent(store, round)}><Send size={15} /> Mark sent</button>
      </div>}
      {comments.length === 0
        ? <Empty compact title="No comments in this round" action={<button className="btn sm soft" onClick={onAdd}><Plus size={14} /> Add comments</button>} />
        : <ol className="pc-list">{comments.map((c, i) => <CommentRow key={c.id} comment={c} label={commentLabel(c, i)} onEdit={() => setEditing(c)} />)}</ol>}
      <div className="card-foot row between wrap">
        <button className="btn ghost sm" onClick={onAdd}><Plus size={15} /> Add comments</button>
        <Link className="btn sm show-sm" to={letter}><FileText size={15} /> Response letter</Link>
      </div>
    </>}
    {editing && <CommentEditor comment={editing} onClose={() => setEditing(null)} />}
  </section>
}

function CommentRow({ comment, label, onEdit }: { comment: PlanCheckComment; label: string; onEdit: () => void }) {
  const store = useData()
  return <li className={`pc-comment ${comment.done ? 'done' : ''}`}>
    <TaskCheck done={comment.done} label={`comment ${label}`} onToggle={() => void store.update('plan_check_comments', comment.id, { done: !comment.done })} />
    <div className="pc-body">
      <div className="pc-text"><span className="pc-num">{label}</span>{comment.comment}</div>
      <ResponseBox comment={comment} />
    </div>
    <button className="btn ghost icon sm" aria-label={`Edit comment ${label}`} onClick={onEdit}><Pencil size={15} /></button>
  </li>
}

/** Type a response; it saves when you click away. */
function ResponseBox({ comment }: { comment: PlanCheckComment }) {
  const store = useData()
  const [text, setText] = useState(comment.response)
  const [seen, setSeen] = useState(comment.response)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Show changes saved elsewhere unless you're typing here.
  if (comment.response !== seen && !focused) { setSeen(comment.response); setText(comment.response) }
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px` } }, [text])
  const save = () => { setFocused(false); if (text.trim() !== comment.response) void store.update('plan_check_comments', comment.id, { response: text.trim() }) }
  return <textarea ref={ref} rows={1} className="input pc-response" value={text} aria-label="Response" placeholder="Your response, e.g. “Added detail 4/S2.”"
    onFocus={() => setFocused(true)} onChange={e => setText(e.target.value)} onBlur={save}
    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur() }} />
}

/* ---------------- Adding comments ---------------- */

function AddCommentsDialog({ jobId, round, previous, onClose }: { jobId: string; round?: PlanCheckRound; previous?: PlanCheckRound; onClose: () => void }) {
  const store = useData()
  const [text, setText] = useState('')
  const [info, setInfo] = useState(() => ({
    agency: previous?.agency ?? '', permit_number: previous?.permit_number ?? '', reviewer: previous?.reviewer ?? '', received_date: todayISO(),
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const parsed = useMemo(() => parseComments(text), [text])
  const nextRound = previous ? previous.round + 1 : 1

  async function save() {
    if (busy) return
    if (!parsed.length) { setError('Paste or type at least one comment.'); return }
    setBusy(true); setError('')
    let target = round
    if (!target) {
      target = await store.insert('plan_check_rounds', { job_id: jobId, round: nextRound, agency: info.agency.trim(), permit_number: info.permit_number.trim(), reviewer: info.reviewer.trim(), received_date: info.received_date || null }) ?? undefined
      if (!target) { setBusy(false); setError('The comments were not saved. Check your connection and try again.'); return }
    }
    const start = Math.max(0, ...roundComments(store, target.id).map(c => c.sort_order))
    const added = await store.insertMany('plan_check_comments', parsed.map((p, i) => ({ round_id: target.id, number: p.number, comment: p.comment, sort_order: start + i + 1 })))
    if (!added) {
      if (!round) await store.remove('plan_check_rounds', target.id)
      setBusy(false); setError('The comments were not saved. Check your connection and try again.'); return
    }
    store.toast(`${added.length} comment${added.length === 1 ? '' : 's'} added`)
    await startPlanCheckWork(store, jobId)
    onClose()
  }

  const title = round ? `Add comments to round ${round.round}` : nextRound > 1 ? `Round ${nextRound} comments` : 'Add plan check comments'
  return <Modal title={title} subtitle="Paste them straight from the reviewer's letter or PDF" size="wide" onClose={() => { if (!busy) onClose() }}
    footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={() => void save()} disabled={busy || !parsed.length}>{busy ? 'Saving…' : parsed.length ? `Add ${parsed.length} comment${parsed.length === 1 ? '' : 's'}` : 'Add comments'}</button></>}>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-fields">
      {!round && <div className="field-grid">
        <Field label="Reviewing agency" htmlFor="pc-agency"><input id="pc-agency" className="input" value={info.agency} onChange={e => setInfo(x => ({ ...x, agency: e.target.value }))} placeholder="e.g. City of Bellingham Permit Center" /></Field>
        <Field label="Permit / plan check number" htmlFor="pc-permit"><input id="pc-permit" className="input" value={info.permit_number} onChange={e => setInfo(x => ({ ...x, permit_number: e.target.value }))} placeholder="e.g. BLD2026-0388" /></Field>
        <Field label="Reviewer" htmlFor="pc-reviewer"><input id="pc-reviewer" className="input" value={info.reviewer} onChange={e => setInfo(x => ({ ...x, reviewer: e.target.value }))} placeholder="Optional" /></Field>
        <Field label="Date of the comment letter" htmlFor="pc-date"><input id="pc-date" className="input" type="date" value={info.received_date} onChange={e => setInfo(x => ({ ...x, received_date: e.target.value }))} /></Field>
      </div>}
      <Field label="Comments" htmlFor="pc-text" hint="Numbered comments (1., 2), S-3 …) are split up for you, with wrapped lines kept together. Without numbers, each paragraph becomes a comment.">
        <textarea id="pc-text" className="input pc-paste" autoFocus value={text} onChange={e => setText(e.target.value)} placeholder={'1. Provide the hold-down schedule on the shear wall plan.\n2. Show the footing size under the new post.\n3. …'} />
      </Field>
      {parsed.length > 0 && <div className="pc-preview" aria-live="polite">
        <div className="small strong">{parsed.length} comment{parsed.length === 1 ? '' : 's'} found</div>
        <ol>{parsed.map((p, i) => <li key={i}><span className="pc-num">{p.number || i + 1}</span><span className="clamp-2">{p.comment}</span></li>)}</ol>
      </div>}
    </div>
  </Modal>
}

/* ---------------- Editing ---------------- */

function CommentEditor({ comment, onClose }: { comment: PlanCheckComment; onClose: () => void }) {
  const store = useData()
  const confirm = useConfirm()
  const [d, setD] = useState({ number: comment.number, comment: comment.comment, response: comment.response, done: comment.done })
  const [busy, setBusy] = useState(false)
  async function save() {
    if (busy) return
    if (!d.comment.trim()) { store.toast('The comment cannot be empty.', 'error'); return }
    setBusy(true)
    const ok = await store.update('plan_check_comments', comment.id, { number: d.number.trim(), comment: d.comment.trim(), response: d.response.trim(), done: d.done })
    setBusy(false)
    if (ok) onClose()
  }
  async function del() {
    if (busy || !await confirm({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) return
    setBusy(true)
    const ok = await store.remove('plan_check_comments', comment.id)
    setBusy(false)
    if (ok) onClose()
  }
  return <Modal title="Edit comment" onClose={() => { if (!busy) onClose() }} footer={<>
    <button className="btn ghost danger left" onClick={() => void del()} disabled={busy}><Trash2 size={15} /> Delete</button>
    <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
    <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
  </>}>
    <form className="form-fields" onSubmit={e => { e.preventDefault(); void save() }}>
      <div className="field-grid pc-edit-grid">
        <Field label="Number" htmlFor="pce-num"><input id="pce-num" className="input" value={d.number} onChange={e => setD(x => ({ ...x, number: e.target.value }))} placeholder="e.g. 3" /></Field>
        <label className="switch pc-done-switch"><input type="checkbox" checked={d.done} onChange={e => setD(x => ({ ...x, done: e.target.checked }))} /> Done</label>
      </div>
      <Field label="Reviewer's comment" htmlFor="pce-comment"><textarea id="pce-comment" className="input" rows={4} value={d.comment} onChange={e => setD(x => ({ ...x, comment: e.target.value }))} /></Field>
      <Field label="Your response" htmlFor="pce-response"><textarea id="pce-response" className="input" rows={4} autoFocus value={d.response} onChange={e => setD(x => ({ ...x, response: e.target.value }))} /></Field>
    </form>
  </Modal>
}

function RoundEditor({ round, onClose }: { round: PlanCheckRound; onClose: () => void }) {
  const store = useData()
  const confirm = useConfirm()
  const [d, setD] = useState({ agency: round.agency, reviewer: round.reviewer, permit_number: round.permit_number, received_date: round.received_date ?? '', sent_date: round.sent_date ?? '', notes: round.notes })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof d>(k: K, v: string) => setD(x => ({ ...x, [k]: v }))
  async function save() {
    if (busy) return
    setBusy(true)
    const ok = await store.update('plan_check_rounds', round.id, { agency: d.agency.trim(), reviewer: d.reviewer.trim(), permit_number: d.permit_number.trim(), received_date: d.received_date || null, sent_date: d.sent_date || null, notes: d.notes.trim() })
    setBusy(false)
    if (ok) onClose()
  }
  async function del() {
    const count = roundComments(store, round.id).length
    if (busy || !await confirm({ title: `Delete round ${round.round}?`, body: `Its ${count} comment${count === 1 ? '' : 's'} and your responses will be deleted.`, confirmLabel: 'Delete round', danger: true })) return
    setBusy(true)
    const ok = await store.remove('plan_check_rounds', round.id)
    setBusy(false)
    if (ok) onClose()
  }
  return <Modal title={`Round ${round.round} details`} onClose={() => { if (!busy) onClose() }} footer={<>
    <button className="btn ghost danger left" onClick={() => void del()} disabled={busy}>Delete round</button>
    <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
    <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
  </>}>
    <form className="form-fields" onSubmit={e => { e.preventDefault(); void save() }}>
      <Field label="Reviewing agency" htmlFor="pcr-agency"><input id="pcr-agency" className="input" autoFocus value={d.agency} onChange={e => set('agency', e.target.value)} /></Field>
      <div className="field-grid">
        <Field label="Permit / plan check number" htmlFor="pcr-permit"><input id="pcr-permit" className="input" value={d.permit_number} onChange={e => set('permit_number', e.target.value)} /></Field>
        <Field label="Reviewer" htmlFor="pcr-reviewer"><input id="pcr-reviewer" className="input" value={d.reviewer} onChange={e => set('reviewer', e.target.value)} /></Field>
        <Field label="Date of the comment letter" htmlFor="pcr-received"><input id="pcr-received" className="input" type="date" value={d.received_date} onChange={e => set('received_date', e.target.value)} /></Field>
        <Field label="Responses sent" htmlFor="pcr-sent"><input id="pcr-sent" className="input" type="date" value={d.sent_date} onChange={e => set('sent_date', e.target.value)} /></Field>
      </div>
      <Field label="Note in the response letter" htmlFor="pcr-notes" hint="Printed after the opening line, e.g. which revised sheets are attached.">
        <textarea id="pcr-notes" className="input" rows={3} value={d.notes} onChange={e => set('notes', e.target.value)} placeholder="Revised sheets S1 and S2 and the updated calculations are attached." />
      </Field>
    </form>
  </Modal>
}
