// The printable site observation report. "Print / Save as PDF" makes the PDF;
// "Email" opens a Gmail message to the client ready to attach it.
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Mail, Pencil, Printer, Send } from 'lucide-react'
import { useData } from '../lib/store'
import { EMAIL_TARGET, useEmailLink } from '../lib/email'
import { listItems, usePhotoUrls } from '../lib/siteVisits'
import { Empty } from '../components/ui'
import { Letterhead, Signature } from '../components/Letterhead'
import { fmtDate, todayISO } from '../lib/utils'
import './letter.css'

const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

export function SiteVisitReport() {
  const { id = '', visitId = '' } = useParams()
  const store = useData()
  const emailLink = useEmailLink()
  const visit = store.siteVisits.find(v => v.id === visitId && v.job_id === id)
  const job = store.jobs.find(j => j.id === id)
  const photos = store.sitePhotos.filter(p => p.visit_id === visitId)
  const urls = usePhotoUrls(photos.map(p => p.path))
  if (!visit || !job) return <div className="card" style={{ marginTop: 20 }}><Empty title="Report not found" action={<Link className="btn" to={job ? `/jobs/${job.id}?tab=visits` : '/jobs'}>Back</Link>}>The site visit may have been deleted.</Empty></div>

  const client = store.clients.find(c => c.id === job.client_id)
  const observations = listItems(visit.observations)
  const corrections = listItems(visit.corrections)
  const reportDate = visit.sent_date ?? todayISO()
  const owner = store.me?.full_name || store.settings.company_name
  const subject = `Site observation report — ${job.name} (${fmtDate(visit.visit_date)})`
  const body = `Hi${client?.contact_name ? ` ${client.contact_name.split(' ')[0]}` : ''},\n\nAttached is my site observation report for ${job.name}${job.address ? `, ${job.address}` : ''}, from my visit on ${fmtDate(visit.visit_date, 'long')}.${corrections.length ? `\n\n${corrections.length === 1 ? 'One item needs' : `${corrections.length} items need`} to be corrected; please see the report.` : ''}\n\nThank you,\n${owner}\n${store.settings.company_name}`
  const markSent = async () => {
    if (await store.update('site_visits', visit.id, { sent_date: todayISO() }))
      store.toast('Report marked as sent', 'ok', { label: 'Undo', run: () => store.update('site_visits', visit.id, { sent_date: null }) })
  }

  return <div className="letter-page">
    <div className="letter-toolbar no-print">
      <Link className="btn ghost back-link" to={`/jobs/${job.id}?tab=visits`} title={`Back to ${job.name}`}><ArrowLeft size={16} /><span className="truncate">{job.name}</span></Link>
      <div className="grow" />
      <Link className="btn" to={`/jobs/${job.id}/visits/${visit.id}`} aria-label="Edit notes and photos"><Pencil size={15} /> <span className="hide-sm">Edit</span></Link>
      <a className="btn" href={emailLink(client?.email ?? '', subject, body)} {...EMAIL_TARGET} aria-label="Email client"><Mail size={16} /> <span className="hide-sm">Email client</span></a>
      {visit.sent_date
        ? <span className="badge ok lg"><CheckCircle2 size={14} /> Sent {fmtDate(visit.sent_date)}</span>
        : <button className="btn" onClick={() => void markSent()}><Send size={15} /> <span className="hide-sm">Mark sent</span><span className="show-sm">Sent</span></button>}
      <button className="btn primary" onClick={() => window.print()}><Printer size={16} /> <span className="hide-sm">Print / Save as PDF</span><span className="show-sm">PDF</span></button>
    </div>
    <p className="letter-tip no-print hide-sm">Tip: choose “Save as PDF” in the print window, then attach it to the Gmail message.</p>

    <article className="letter-doc" aria-label="Site observation report">
      <Letterhead title="Site observation report" facts={[
        ['Report date', fmtDate(reportDate, 'long').replace(/^\w+, /, '')],
        ...(job.job_number ? [['Job no.', job.job_number] as [string, string]] : []),
      ]} />

      <dl className="ltr-info">
        <dt>Project</dt><dd><span className="ltr-strong">{job.name}</span>{job.address && <>, {job.address}</>}</dd>
        {client && <><dt>Client</dt><dd>{client.name}</dd></>}
        <dt>Date of visit</dt><dd>{longDate(visit.visit_date)}</dd>
        {visit.purpose.trim() && <><dt>Purpose</dt><dd>{visit.purpose.trim()}</dd></>}
        {visit.present.trim() && <><dt>Present</dt><dd>{visit.present.trim()}</dd></>}
        {visit.weather.trim() && <><dt>Weather</dt><dd>{visit.weather.trim()}</dd></>}
      </dl>

      <h3 className="ltr-h">Observations</h3>
      {observations.length ? <ol className="ltr-list">{observations.map((o, i) => <li key={i}>{o}</li>)}</ol> : <p className="ltr-none">No observations recorded.</p>}

      <h3 className="ltr-h">Items requiring correction</h3>
      {corrections.length ? <ol className="ltr-list">{corrections.map((o, i) => <li key={i}>{o}</li>)}</ol> : <p className="ltr-none">None. No corrections were required at the time of this visit.</p>}

      {visit.conclusion.trim() && <p className="ltr-p" style={{ marginTop: 22 }}>{visit.conclusion.trim()}</p>}
      <Signature lead="Observed by" />

      {photos.length > 0 && <>
        <h3 className="ltr-h">Photos</h3>
        <div className="ltr-photos">
          {photos.map((p, i) => <figure key={p.id}>
            {urls[p.path] ? <img src={urls[p.path]} alt={p.caption || `Photo ${i + 1}`} /> : <div className="ltr-photo-wait" />}
            <figcaption><strong>Photo {i + 1}.</strong> {p.caption}</figcaption>
          </figure>)}
        </div>
      </>}
    </article>
  </div>
}
