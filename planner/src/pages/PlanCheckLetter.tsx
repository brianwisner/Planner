// The plan check response letter: each reviewer comment with your response.
// "Print / Save as PDF" makes the PDF to send with the revised drawings.
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CheckCircle2, Mail, Printer, Send } from 'lucide-react'
import { useData } from '../lib/store'
import { EMAIL_TARGET, useEmailLink } from '../lib/email'
import { Empty } from '../components/ui'
import { Letterhead, Signature } from '../components/Letterhead'
import { commentLabel, markRoundSent, roundComments, roundWord } from '../lib/planCheck'
import { fmtDate, todayISO } from '../lib/utils'
import './letter.css'

const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

export function PlanCheckLetter() {
  const { id = '', roundId = '' } = useParams()
  const store = useData()
  const emailLink = useEmailLink()
  const [quote, setQuote] = useState(true)
  const round = store.planRounds.find(r => r.id === roundId && r.job_id === id)
  const job = store.jobs.find(j => j.id === id)
  if (!round || !job) return <div className="card" style={{ marginTop: 20 }}><Empty title="Letter not found" action={<Link className="btn" to={job ? `/jobs/${job.id}?tab=plancheck` : '/jobs'}>Back</Link>}>The comments may have been deleted.</Empty></div>

  const comments = roundComments(store, round.id)
  const missing = comments.filter(c => !c.response.trim()).length
  const date = round.sent_date ?? todayISO()
  const greeting = round.reviewer.trim() ? round.reviewer.trim() : 'Plan Reviewer'
  const owner = store.me?.full_name || store.settings.company_name
  const subject = `Plan check responses — ${job.name}${round.permit_number ? ` (${round.permit_number})` : ''}`
  const body = `Hello${round.reviewer ? ` ${round.reviewer.split(' ')[0]}` : ''},\n\nAttached are our responses to the ${roundWord(round.round)} round of plan review comments for ${job.name}${job.address ? `, ${job.address}` : ''}${round.permit_number ? ` (permit ${round.permit_number})` : ''}.\n\nThank you,\n${owner}\n${store.settings.company_name}`

  return <div className="letter-page">
    <div className="letter-toolbar no-print">
      <Link className="btn ghost back-link" to={`/jobs/${job.id}?tab=plancheck`} title={`Back to ${job.name}`}><ArrowLeft size={16} /><span className="truncate">{job.name}</span></Link>
      <div className="grow" />
      <label className="switch small"><input type="checkbox" checked={quote} onChange={e => setQuote(e.target.checked)} /> Include the comments</label>
      <a className="btn" href={emailLink('', subject, body)} {...EMAIL_TARGET} aria-label="Email"><Mail size={16} /> <span className="hide-sm">Email</span></a>
      {round.sent_date
        ? <span className="badge ok lg"><CheckCircle2 size={14} /> Sent {fmtDate(round.sent_date)}</span>
        : <button className="btn" onClick={() => void markRoundSent(store, round)}><Send size={15} /> <span className="hide-sm">Mark sent</span><span className="show-sm">Sent</span></button>}
      <button className="btn primary" onClick={() => window.print()}><Printer size={16} /> <span className="hide-sm">Print / Save as PDF</span><span className="show-sm">PDF</span></button>
    </div>
    {missing > 0 && <div className="form-note warn letter-warn no-print"><AlertTriangle size={16} style={{ flex: 'none', marginTop: 1 }} />{missing} comment{missing === 1 ? ' has' : 's have'} no response yet. {missing === 1 ? 'It shows' : 'They show'} as “Response to follow” in the letter.</div>}
    <p className="letter-tip no-print hide-sm">Tip: choose “Save as PDF” in the print window, then attach it with the revised sheets.</p>

    <article className="letter-doc" aria-label="Plan check response letter">
      <Letterhead />
      <p className="ltr-to">{longDate(date)}</p>
      <div className="ltr-to">
        {round.agency && <div>{round.agency}</div>}
        {round.reviewer && <div>Attn: {round.reviewer}</div>}
      </div>
      <dl className="ltr-re">
        <dt>Re:</dt>
        <dd>
          <div className="ltr-strong">Plan review responses{round.round > 1 ? ` — round ${round.round}` : ''}</div>
          <div>{job.name}</div>
          {job.address && <div>{job.address}</div>}
          {round.permit_number && <div>Permit / plan check no. {round.permit_number}</div>}
          {job.job_number && <div className="ltr-muted">Our job no. {job.job_number}</div>}
        </dd>
      </dl>
      <p className="ltr-p">Dear {greeting}:</p>
      <p className="ltr-p">Below are our responses to your {round.round > 1 ? `${roundWord(round.round)} round of ` : ''}structural plan review comments{round.received_date ? ` dated ${longDate(round.received_date)}` : ''}.{quote ? ' Your comments are repeated in italics, followed by our response.' : ''}</p>
      {round.notes.trim() && <p className="ltr-p">{round.notes.trim()}</p>}

      <ol className="ltr-comments">
        {comments.map((c, i) => <li key={c.id} className="ltr-comment">
          <span className="ltr-num">{commentLabel(c, i)}.</span>
          <div>
            {quote && <div className="ltr-q">{c.comment}</div>}
            <div className="ltr-a">{quote && <strong>Response: </strong>}{c.response.trim() || <span className="ltr-missing">Response to follow.</span>}</div>
          </div>
        </li>)}
      </ol>

      <p className="ltr-p" style={{ marginTop: 18 }}>Please contact me if you have any questions.</p>
      <Signature lead="Sincerely," />
    </article>
  </div>
}
