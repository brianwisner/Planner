// The job page's Site visits tab: every visit report, newest first.
import { Link } from 'react-router-dom'
import { Camera, CheckCircle2, FileText, MapPin, Plus } from 'lucide-react'
import { useData } from '../lib/store'
import { listItems, usePhotoUrls } from '../lib/siteVisits'
import type { SiteVisit } from '../lib/types'
import { fmtDate } from '../lib/utils'
import { Empty } from './ui'
import './siteVisits.css'

export function JobSiteVisits({ jobId }: { jobId: string }) {
  const store = useData()
  const visits = store.siteVisits.filter(v => v.job_id === jobId)
  const newLink = `/jobs/${jobId}/visits/new`
  return <section className="card">
    <div className="card-head">
      <h2>Site visit reports <span className="count">{visits.length}</span></h2>
      <Link className="btn sm primary" to={newLink}><Plus size={15} /> New report</Link>
    </div>
    {visits.length === 0
      ? <Empty icon={<MapPin size={22} />} title="No site visit reports yet" action={<Link className="btn primary" to={newLink}><Camera size={16} /> Start a report</Link>}>
        At the site, open this job on your phone and start a report: take photos and type (or dictate) what you see. Back at your desk, print it as a PDF and email it.
      </Empty>
      : <ul className="list">{visits.map(v => <VisitRow key={v.id} visit={v} />)}</ul>}
  </section>
}

function VisitRow({ visit }: { visit: SiteVisit }) {
  const store = useData()
  const photos = store.sitePhotos.filter(p => p.visit_id === visit.id)
  const urls = usePhotoUrls(photos.slice(0, 3).map(p => p.path))
  const fixes = listItems(visit.corrections).length
  const notes = listItems(visit.observations).length
  const date = new Date(`${visit.visit_date}T12:00:00`)
  return <li className="sv-row">
    <Link className="sv-row-main" to={`/jobs/${visit.job_id}/visits/${visit.id}`}>
      <span className="sv-date" aria-hidden="true"><span>{date.toLocaleDateString('en-US', { month: 'short' })}</span><strong>{date.getDate()}</strong></span>
      <span className="sv-row-text">
        <span className="title">{visit.purpose.trim() || 'Site visit'}</span>
        <span className="meta">
          {fmtDate(visit.visit_date, 'long')}
          {photos.length > 0 && ` · ${photos.length} photo${photos.length === 1 ? '' : 's'}`}
          {notes > 0 && ` · ${notes} observation${notes === 1 ? '' : 's'}`}
          {fixes > 0 && <span className="warn-text"> · {fixes} to correct</span>}
        </span>
      </span>
      {photos.length > 0 && <span className="sv-thumbs hide-sm" aria-hidden="true">{photos.slice(0, 3).map(p => urls[p.path] ? <img key={p.id} src={urls[p.path]} alt="" /> : <span key={p.id} className="sv-thumb-wait" />)}</span>}
      {visit.sent_date ? <span className="badge ok"><CheckCircle2 size={12} />Sent {fmtDate(visit.sent_date)}</span> : <span className="badge">Draft</span>}
    </Link>
    <Link className="btn ghost icon sm" to={`/jobs/${visit.job_id}/visits/${visit.id}/report`} aria-label="Open the printable report" title="Printable report"><FileText size={16} /></Link>
  </li>
}
