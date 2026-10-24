// One site visit: photos and notes, made for a phone at the site. Everything
// saves as you type. A new visit (/jobs/:id/visits/new) is only created once
// something is typed or a photo is added, so opening it by mistake leaves nothing behind.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Camera, Check, ChevronRight, CloudOff, Ellipsis, FileText, Loader2, Trash2, X } from 'lucide-react'
import { useData } from '../lib/store'
import { addPhotos, deletePhoto, deleteVisit, DEFAULT_VISIT_CLOSING, usePhotoUrls, visitClosing, visitDateFor, visitTaskFor } from '../lib/siteVisits'
import type { Job, SitePhoto, SiteVisit } from '../lib/types'
import { fmtDate, todayISO } from '../lib/utils'
import { Empty, Field, Menu, useConfirm } from '../components/ui'
import '../components/siteVisits.css'

type Draft = Pick<SiteVisit, 'visit_date' | 'purpose' | 'weather' | 'present' | 'observations' | 'corrections' | 'conclusion'>
const FIELDS: (keyof Draft)[] = ['visit_date', 'purpose', 'weather', 'present', 'observations', 'corrections', 'conclusion']

export function SiteVisitPage() {
  const { id = '', visitId = '' } = useParams()
  const store = useData()
  const job = store.jobs.find(j => j.id === id)
  const visit = visitId === 'new' ? undefined : store.siteVisits.find(v => v.id === visitId && v.job_id === id)
  if (!job || (visitId !== 'new' && !visit)) return <div className="card" style={{ marginTop: 20 }}><Empty title="Site visit not found" action={<Link className="btn" to={job ? `/jobs/${job.id}?tab=visits` : '/jobs'}>Back</Link>}>It may have been deleted.</Empty></div>
  // Keyed by job so the form keeps what you typed when a new visit gets saved.
  return <VisitEditor key={job.id} job={job} visit={visit} />
}

function VisitEditor({ job, visit }: { job: Job; visit?: SiteVisit }) {
  const store = useData()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [params] = useSearchParams()
  const [task] = useState(() => visit ? undefined : store.tasks.find(t => t.id === params.get('task') && t.job_id === job.id) ?? visitTaskFor(store, job.id))
  const [draft, setDraft] = useState<Draft>(() => visit ? pick(visit) : {
    visit_date: visitDateFor(task),
    purpose: task?.title.replace(/^site visit\s*[:—–-]\s*/i, '') ?? '',
    weather: '', present: '', observations: '', corrections: '', conclusion: visitClosing(store.settings),
  })
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved')

  // Saving: changes wait 0.8 s after you stop typing, then go in one update.
  const idRef = useRef<string | null>(visit?.id ?? null)
  const draftRef = useRef(draft)
  const pending = useRef<Partial<Draft>>({})
  const timer = useRef<number | undefined>(undefined)
  const creating = useRef<Promise<string | null> | null>(null)
  const mounted = useRef(true)
  const storeRef = useRef(store)
  useEffect(() => { storeRef.current = store })

  const ensureSaved = useCallback((): Promise<string | null> => {
    if (idRef.current) return Promise.resolve(idRef.current)
    creating.current ??= (async () => {
      const s = storeRef.current
      const sent = { ...draftRef.current }
      setStatus('saving')
      const row = await s.insert('site_visits', { ...sent, job_id: job.id, task_id: task?.id ?? null, user_id: s.me?.id ?? null })
      creating.current = null
      if (!row) { setStatus('error'); return null }
      idRef.current = row.id
      // Keep anything typed while it was being created.
      pending.current = Object.fromEntries(FIELDS.filter(k => draftRef.current[k] !== sent[k]).map(k => [k, draftRef.current[k]]))
      setStatus('saved')
      if (mounted.current) navigate(`/jobs/${job.id}/visits/${row.id}`, { replace: true })
      return row.id
    })()
    return creating.current
  }, [job.id, task, navigate])

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!Object.keys(pending.current).length) return
    // A new visit is created with everything typed so far; a failed create
    // keeps the changes and the next edit tries again.
    if (!idRef.current && !await ensureSaved()) return
    const patch = pending.current
    if (!idRef.current || !Object.keys(patch).length) return
    pending.current = {}
    setStatus('saving')
    const ok = await storeRef.current.update('site_visits', idRef.current, patch)
    if (!ok) pending.current = { ...patch, ...pending.current }
    if (mounted.current) setStatus(ok ? 'saved' : 'error')
  }, [ensureSaved])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; void flush() }
  }, [flush])

  const set = (k: keyof Draft, v: string) => {
    setDraft(d => { const next = { ...d, [k]: v }; draftRef.current = next; return next })
    pending.current[k] = v
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), 800)
  }

  const discardPending = () => { window.clearTimeout(timer.current); pending.current = {} }

  async function remove() {
    if (!visit) { discardPending(); navigate(`/jobs/${job.id}?tab=visits`); return }
    const photos = store.sitePhotos.filter(p => p.visit_id === visit.id).length
    if (!await confirm({ title: 'Delete this site visit?', body: `The notes${photos ? ` and ${photos} photo${photos === 1 ? '' : 's'}` : ''} will be deleted.`, confirmLabel: 'Delete', danger: true })) return
    discardPending()
    if (await deleteVisit(store, visit)) { store.toast('Site visit deleted'); navigate(`/jobs/${job.id}?tab=visits`) }
  }

  const reportLink = visit ? `/jobs/${job.id}/visits/${visit.id}/report` : null
  return <div className="sv-page">
    <div className="crumbs"><Link to="/jobs">Jobs</Link><ChevronRight size={14} /><Link to={`/jobs/${job.id}?tab=visits`}>{job.name}</Link></div>
    <div className="page-head">
      <div className="titles">
        <h1>Site visit</h1>
        <p className="lede"><SaveStatus status={status} isNew={!visit} />{visit?.sent_date && <span className="badge ok">Report sent {fmtDate(visit.sent_date)}</span>}</p>
      </div>
      <div className="actions">
        {reportLink ? <Link className="btn primary" to={reportLink} onClick={() => void flush()}><FileText size={16} /> Report</Link> : <button className="btn primary" disabled title="Add a note or photo first"><FileText size={16} /> Report</button>}
        <Menu label="More actions" items={[{ label: visit ? 'Delete this visit' : 'Discard', icon: <Trash2 size={15} />, danger: true, onSelect: () => void remove() }]} trigger={p => <button className="btn icon" aria-label="More actions" {...p}><Ellipsis size={18} /></button>} />
      </div>
    </div>

    <div className="sv-grid">
      <section className="card">
        <div className="card-body form-fields">
          <div className="field-grid">
            <Field label="Date" htmlFor="sv-date"><input id="sv-date" className="input" type="date" value={draft.visit_date} onChange={e => set('visit_date', e.target.value || todayISO())} /></Field>
            <Field label="What you looked at" htmlFor="sv-purpose"><input id="sv-purpose" className="input" value={draft.purpose} onChange={e => set('purpose', e.target.value)} placeholder="e.g. Shear wall nailing before drywall" /></Field>
            <Field label="Who was there" htmlFor="sv-present"><input id="sv-present" className="input" value={draft.present} onChange={e => set('present', e.target.value)} placeholder="e.g. Mike (Cascade Builders)" /></Field>
            <Field label="Weather" htmlFor="sv-weather"><input id="sv-weather" className="input" value={draft.weather} onChange={e => set('weather', e.target.value)} placeholder="Optional" /></Field>
          </div>
        </div>
      </section>

      <Photos jobId={job.id} visitId={visit?.id ?? null} ensureSaved={ensureSaved} />

      <section className="card">
        <div className="card-body form-fields">
          <Field label="What you saw" htmlFor="sv-obs" hint="One item per line; each line is numbered on the report. Tip: tap the microphone on your phone's keyboard to talk instead of type.">
            <textarea id="sv-obs" className="input sv-notes" value={draft.observations} onChange={e => set('observations', e.target.value)} placeholder={'Hold-downs installed per the plans\nEdge nailing at 4" o.c. on shear wall 3'} />
          </Field>
          <Field label="Needs to be corrected" htmlFor="sv-fix" hint="One item per line. Leave blank if nothing needs fixing.">
            <textarea id="sv-fix" className="input sv-notes short" value={draft.corrections} onChange={e => set('corrections', e.target.value)} placeholder="Add the missing hold-down at grid 3" />
          </Field>
          <Field label="Closing paragraph" htmlFor="sv-close" hint={<>Printed at the end of the report. {draft.conclusion.trim() !== DEFAULT_VISIT_CLOSING && <button type="button" className="link-btn" onClick={() => set('conclusion', visitClosing(store.settings))}>Use the standard wording</button>}</>}>
            <textarea id="sv-close" className="input sv-notes short" value={draft.conclusion} onChange={e => set('conclusion', e.target.value)} />
          </Field>
        </div>
      </section>
    </div>
  </div>
}

const pick = (v: SiteVisit): Draft => ({ visit_date: v.visit_date, purpose: v.purpose, weather: v.weather, present: v.present, observations: v.observations, corrections: v.corrections, conclusion: v.conclusion })

function SaveStatus({ status, isNew }: { status: 'saved' | 'saving' | 'error'; isNew: boolean }) {
  if (status === 'saving') return <span className="sv-status"><Loader2 size={14} className="spin" /> Saving…</span>
  if (status === 'error') return <span className="sv-status warn-text"><CloudOff size={14} /> Not saved yet — check your signal. Your notes are still here.</span>
  if (isNew) return <span className="sv-status">New visit · saves as you type</span>
  return <span className="sv-status"><Check size={14} /> Saved</span>
}

/* ---------------- Photos ---------------- */

function Photos({ jobId, visitId, ensureSaved }: { jobId: string; visitId: string | null; ensureSaved: () => Promise<string | null> }) {
  const store = useData()
  const photos = visitId ? store.sitePhotos.filter(p => p.visit_id === visitId) : []
  const urls = usePhotoUrls(photos.map(p => p.path))
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function add(files: File[]) {
    if (!files.length || uploading) return
    setUploading({ done: 0, total: files.length })
    const id = await ensureSaved()
    if (id) {
      const added = await addPhotos(store, { id, job_id: jobId }, files, done => setUploading({ done, total: files.length }))
      if (added) store.toast(`${added} photo${added === 1 ? '' : 's'} added`)
    }
    setUploading(null)
  }

  return <section className="card">
    <div className="card-head">
      <h2>Photos <span className="count">{photos.length}</span></h2>
      <button className="btn sm" onClick={() => input.current?.click()} disabled={Boolean(uploading)}><Camera size={15} /> Add photos</button>
    </div>
    <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; void add(files) }} />
    {photos.length === 0 && !uploading
      ? <button className="sv-drop" onClick={() => input.current?.click()}><Camera size={26} /><span className="strong">Take or add photos</span><span className="small muted">On a phone this opens the camera. Photos are shrunk before uploading so they go up quickly.</span></button>
      : <div className="sv-photos">
        {photos.map((p, i) => <PhotoTile key={p.id} photo={p} number={i + 1} url={urls[p.path]} />)}
        {uploading && Array.from({ length: uploading.total - uploading.done }, (_, i) => <div key={`up${i}`} className="sv-photo uploading"><div className="sv-photo-img"><Loader2 size={22} className="spin" /></div><span className="tiny muted">Uploading…</span></div>)}
      </div>}
  </section>
}

function PhotoTile({ photo, number, url }: { photo: SitePhoto; number: number; url?: string }) {
  const store = useData()
  const confirm = useConfirm()
  const [caption, setCaption] = useState(photo.caption)
  const [seen, setSeen] = useState(photo.caption)
  const [focused, setFocused] = useState(false)
  // Show a caption saved elsewhere unless you're typing here.
  if (photo.caption !== seen && !focused) { setSeen(photo.caption); setCaption(photo.caption) }
  const save = () => { setFocused(false); if (caption.trim() !== photo.caption) void store.update('site_photos', photo.id, { caption: caption.trim() }) }
  async function del() {
    if (!await confirm({ title: `Delete photo ${number}?`, confirmLabel: 'Delete', danger: true })) return
    void deletePhoto(store, photo)
  }
  return <figure className="sv-photo">
    <a className="sv-photo-img" href={url} target="_blank" rel="noreferrer" aria-label={`Open photo ${number} full size`}>
      {url ? <img src={url} alt={photo.caption || `Photo ${number}`} loading="lazy" /> : <Loader2 size={20} className="spin" />}
      <span className="sv-photo-num">{number}</span>
    </a>
    <button className="sv-photo-del" aria-label={`Delete photo ${number}`} onClick={() => void del()}><X size={15} /></button>
    <input className="input sm" value={caption} placeholder="Caption" aria-label={`Caption for photo ${number}`}
      onFocus={() => setFocused(true)} onChange={e => setCaption(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  </figure>
}
