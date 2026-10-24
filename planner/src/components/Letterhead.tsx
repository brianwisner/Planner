/* eslint-disable react-refresh/only-export-components */
// The top and bottom of printed reports and letters: company name and
// letterhead lines (Settings → Letters and reports), and the signature.
import type { ReactNode } from 'react'
import { useData } from '../lib/store'
import '../pages/letter.css'

export const letterheadLines = (text: string | null | undefined) => (text ?? '').split('\n').map(s => s.trim()).filter(Boolean)

export function Letterhead({ title, facts }: { title?: string; facts?: [string, ReactNode][] }) {
  const { settings } = useData()
  const email = settings.business_email?.trim()
  return <header className="ltr-head">
    <div>
      <div className="ltr-company">{settings.company_name}</div>
      {letterheadLines(settings.letterhead).map((line, i) => <div key={i} className="ltr-muted">{line}</div>)}
      {email && <div className="ltr-muted">{email}</div>}
    </div>
    {title && <div className="ltr-title-block">
      <div className="ltr-title">{title}</div>
      {facts && <dl className="ltr-facts">{facts.map(([k, v]) => <div key={k} className="ltr-fact"><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </div>}
  </header>
}

/** Sign-off lines: Settings → Signature, else your name. */
export function Signature({ lead }: { lead: string }) {
  const { settings, me } = useData()
  const lines = letterheadLines(settings.signature)
  const shown = lines.length ? lines : [me?.full_name || settings.company_name]
  return <div className="ltr-sign">
    <p>{lead}</p>
    <div className="ltr-sign-space" />
    {shown.map((line, i) => <div key={i} className={i === 0 ? 'ltr-strong' : 'ltr-muted'}>{line}</div>)}
    {lines.length > 0 && <div className="ltr-muted">{settings.company_name}</div>}
  </div>
}
