// Sign-in screen. Accounts are created by the owner in the Supabase dashboard
// (Authentication → Users → Invite), or with the sign-up form below if you
// turn on "Allow new users to sign up" in Supabase.
import { useState, type FormEvent } from 'react'
import { isConfigured, supabase } from '../lib/supabase'

export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setMsg(error.message)
      } else if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
        if (error) setMsg(error.message)
        else setMsg('Account created. If email confirmation is on, check your inbox, then sign in.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
        setMsg(error ? error.message : 'Check your email for a reset link.')
      }
    } finally { setBusy(false) }
  }

  if (!isConfigured) {
    return (
      <div className="login"><div className="card">
        <h1>Almost there</h1>
        <p>The app has not been connected to its database yet. Follow the README: add the two Supabase values as GitHub repository variables, then re-run the deploy.</p>
      </div></div>
    )
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand">
          <h1>Wisner Engineering</h1>
          <div className="muted small">Project Planner</div>
        </div>
        {mode === 'signup' && <div className="field"><label>Your name</label><input value={name} onChange={e => setName(e.target.value)} required /></div>}
        <div className="field"><label>Email</label><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></div>
        {mode !== 'reset' && <div className="field"><label>Password</label><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></div>}
        {msg && <p className="small" style={{ color: msg.startsWith('Check') || msg.startsWith('Account') ? 'var(--ok)' : 'var(--danger)' }}>{msg}</p>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
        <div className="center small mt">
          {mode === 'signin' && <><a href="#" onClick={e => { e.preventDefault(); setMode('reset') }}>Forgot password?</a> · <a href="#" onClick={e => { e.preventDefault(); setMode('signup') }}>Create account</a></>}
          {mode !== 'signin' && <a href="#" onClick={e => { e.preventDefault(); setMode('signin') }}>Back to sign in</a>}
        </div>
      </form>
    </div>
  )
}

/** Shown after accepting an invite or clicking a password-reset link. */
export function SetPassword({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 6) { setMsg('Use at least 6 characters.'); return }
    if (pw !== pw2) { setMsg('The two passwords do not match.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw, data: name ? { full_name: name } : undefined })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    if (name.trim()) {
      const { data } = await supabase.auth.getUser()
      if (data.user) await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', data.user.id)
    }
    onDone()
  }
  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand"><h1>Welcome</h1><div className="muted small">Choose a password to finish setting up your account</div></div>
        <div className="field"><label>Your name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Optional" /></div>
        <div className="field"><label>New password</label><input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required minLength={6} autoFocus /></div>
        <div className="field"><label>Repeat password</label><input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required /></div>
        {msg && <p className="small danger-text">{msg}</p>}
        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>Save and continue</button>
      </form>
    </div>
  )
}
