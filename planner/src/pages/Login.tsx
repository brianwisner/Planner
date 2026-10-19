// Sign-in, password reset and "choose a password" screens.
import { useState, type FormEvent } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { isConfigured, supabase } from '../lib/supabase'
import { BrandMark } from '../components/Brand'
import './login.css'

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="login">
    <section className="login-art" aria-hidden="true">
      <div className="login-art-inner">
        <div className="row"><BrandMark /><strong>Wisner Engineering</strong></div>
        <h2>Every job, every hour, every invoice — in one calm place.</h2>
        <ul>
          <li>See what needs you today</li>
          <li>Move jobs from bid to construction</li>
          <li>Track time and bill it in a few clicks</li>
        </ul>
      </div>
      <svg className="login-truss" viewBox="0 0 600 160" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round">
        <path d="M20 140H580M76 40H524" />
        <path d="M20 140 76 40 132 140 188 40 244 140 300 40 356 140 412 40 468 140 524 40 580 140" />
      </svg>
    </section>
    <section className="login-panel">{children}</section>
  </div>
}

function Message({ text, ok }: { text: string; ok?: boolean }) {
  return <div className={ok ? 'form-note info' : 'form-error'} role="alert">{ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}<span>{text}</span></div>
}

export function Login() {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setMsg({ text: error.message === 'Invalid login credentials' ? 'That email and password don’t match. Try again or reset your password.' : error.message })
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
        setMsg(error ? { text: error.message } : { text: 'Check your email for a link to choose a new password.', ok: true })
      }
    } finally { setBusy(false) }
  }

  if (!isConfigured) return <Frame><div className="login-card"><h1>Almost there</h1><p className="muted">This copy of the app isn't connected to its database yet. See planner/README.md.</p></div></Frame>

  return <Frame>
    <form className="login-card" onSubmit={submit}>
      <div className="login-mobile-brand"><BrandMark /><strong>Wisner Engineering</strong></div>
      <h1>{mode === 'signin' ? 'Sign in' : 'Reset password'}</h1>
      <p className="muted small">{mode === 'signin' ? 'Welcome back.' : 'We’ll email you a link to choose a new password.'}</p>
      {msg && <Message {...msg} />}
      <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></div>
      {mode === 'signin' && <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></div>}
      <button className="btn primary lg block" disabled={busy}>{busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Send reset link'}</button>
      <button type="button" className="btn ghost block" onClick={() => { setMode(mode === 'signin' ? 'reset' : 'signin'); setMsg(null) }}>{mode === 'signin' ? 'Forgot your password?' : 'Back to sign in'}</button>
    </form>
  </Frame>
}

/** Shown after accepting an invite or clicking a password-reset link. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 6) { setMsg('Use at least 6 characters.'); return }
    if (pw !== pw2) { setMsg('The two passwords don’t match.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    onDone()
  }
  return <Frame>
    <form className="login-card" onSubmit={submit}>
      <h1>Choose a password</h1>
      <p className="muted small">You’ll use it to sign in on any device.</p>
      {msg && <Message text={msg} />}
      <div className="field"><label htmlFor="pw1">New password</label><input id="pw1" className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required minLength={6} autoFocus /></div>
      <div className="field"><label htmlFor="pw2">Repeat it</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required /></div>
      <button className="btn primary lg block" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
    </form>
  </Frame>
}
