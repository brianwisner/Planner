// Settings: company name, rates, your profile, team list, Google Calendar
// feed link, reminders, and sample-data cleanup.
import { useEffect, useState } from 'react'
import { useData } from '../lib/store'
import { SUPABASE_URL, supabase } from '../lib/supabase'
import { enableNotifications } from '../lib/reminders'
import { clearGoogleCache, disconnectGoogle, listGoogleCalendars, signInWithGoogle, type GoogleCalendar } from '../lib/google'
import { Avatar } from '../components/ui'

export function Settings() {
  const { settings, me, profiles, clients, update, remove, signOut, toast, refresh, googleConnected, googleTokens } = useData()
  const [company, setCompany] = useState(settings.company_name)
  const [rate, setRate] = useState(String(settings.default_rate))
  const [cap, setCap] = useState(String(settings.weekly_capacity))
  const [name, setName] = useState(me?.full_name ?? '')
  const [myRate, setMyRate] = useState(me?.hourly_rate != null ? String(me.hourly_rate) : '')
  const [myHours, setMyHours] = useState(String(me?.weekly_hours ?? 40))
  const [color, setColor] = useState(me?.color ?? '#1f6feb')
  const [notifMsg, setNotifMsg] = useState('')
  const [pw, setPw] = useState('')
  const [domains, setDomains] = useState(settings.allowed_email_domains.join(', '))
  const [gcals, setGcals] = useState<GoogleCalendar[] | null>(null)
  const [gerr, setGerr] = useState<string | null>(null)
  const myGoogle = googleTokens.find(t => t.user_id === me?.id)
  useEffect(() => {
    if (!googleConnected) { setGcals(null); return }
    listGoogleCalendars().then(r => { if (r.error) setGerr(r.error); else { setGerr(null); setGcals(r.data!.calendars) } })
  }, [googleConnected])

  const feedUrl = me && SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ics?token=${me.ics_token}` : ''
  const sample = clients.filter(c => c.is_sample)

  async function saveCompany() {
    const allowed = domains.split(/[,\s]+/).map(d => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean)
    await update('settings', 1, { company_name: company.trim() || 'Wisner Engineering', default_rate: Number(rate) || 0, weekly_capacity: Number(cap) || 40, allowed_email_domains: allowed })
    toast('Saved')
  }
  async function saveMe() {
    if (!me) return
    await update('profiles', me.id, { full_name: name.trim() || me.full_name, hourly_rate: myRate === '' ? null : Number(myRate), weekly_hours: Number(myHours) || 40, color })
    toast('Profile saved')
  }
  async function changePassword() {
    if (pw.length < 6) { toast('Password must be at least 6 characters', 'error'); return }
    const { error } = await supabase.auth.updateUser({ password: pw })
    toast(error ? error.message : 'Password changed', error ? 'error' : 'ok'); setPw('')
  }
  async function removeSample() {
    if (!confirm(`Delete the ${sample.length} sample clients and all their jobs, tasks, hours and invoices?`)) return
    for (const c of sample) await remove('clients', c.id)
    await refresh()
    toast('Sample data removed')
  }

  return (
    <div>
      <div className="page-header"><h1>Settings</h1><div className="actions"><button className="btn" onClick={signOut}>Sign out</button></div></div>
      <div className="grid cols-2">
        <div>
          <div className="card">
            <h2>Your profile</h2>
            <div className="row"><Avatar userId={me?.id} size="lg" /><div className="field grow"><label>Name</label><input value={name} onChange={e => setName(e.target.value)} /></div></div>
            <div className="row">
              <div className="field"><label>Your hourly rate ($) — blank uses company default</label><input type="number" value={myRate} onChange={e => setMyRate(e.target.value)} placeholder={String(settings.default_rate)} /></div>
              <div className="field"><label>Hours per week you can book</label><input type="number" value={myHours} onChange={e => setMyHours(e.target.value)} /></div>
              <div className="field" style={{ flex: '0 0 80px' }}><label>Color</label><input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ padding: 2, height: 40 }} /></div>
            </div>
            <button className="btn primary" onClick={saveMe}>Save profile</button>
            <div className="row mt"><div className="field grow"><label>New password</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" /></div><button className="btn" style={{ marginTop: 8 }} onClick={changePassword}>Change password</button></div>
            <p className="small muted">Signed in as {me?.email}</p>
          </div>

          <div className="card">
            <h2>Company</h2>
            <div className="field"><label>Company name</label><input value={company} onChange={e => setCompany(e.target.value)} /></div>
            <div className="row">
              <div className="field"><label>Default hourly rate ($)</label><input type="number" value={rate} onChange={e => setRate(e.target.value)} /></div>
              <div className="field"><label>Default weekly capacity (hours)</label><input type="number" value={cap} onChange={e => setCap(e.target.value)} /></div>
            </div>
            <div className="field"><label>Who may sign in — allowed email domains (comma separated, blank = anyone you invite)</label><input value={domains} onChange={e => setDomains(e.target.value)} placeholder="e.g. wisnerengineering.com" /></div>
            <button className="btn primary" onClick={saveCompany}>Save</button>
          </div>

          <div className="card">
            <h2>Team</h2>
            <ul className="list">{profiles.map(p => <li key={p.id}><Avatar userId={p.id} /><div className="title"><div className="bold">{p.full_name}</div><div className="meta">{p.email} · {p.weekly_hours} h/wk{p.hourly_rate != null && ` · $${p.hourly_rate}/h`}</div></div></li>)}</ul>
            <p className="small muted mt">To add a staff member: in your Supabase dashboard go to <b>Authentication → Users → Add user → Invite</b>, enter their email, and they will receive a link to set a password. See the README.</p>
          </div>
        </div>

        <div>
          <div className="card" id="google">
            <h2>Google account &amp; calendar</h2>
            {googleConnected ? <>
              <p className="small">Connected as <b>{myGoogle?.email ?? me?.email}</b>. Events from the calendars ticked below show up on your Calendar page and Dashboard. Only you can see them.</p>
              {gerr && <p className="small danger-text">Could not load calendars ({gerr}). Click Reconnect.</p>}
              {gcals && (
                <ul className="list">
                  {gcals.map(c => {
                    const chosen = me?.google_calendar_ids?.length ? me.google_calendar_ids : gcals.filter(x => x.primary).map(x => x.id)
                    const on = chosen.includes(c.id)
                    return (
                      <li key={c.id}>
                        <input type="checkbox" style={{ width: 18, minHeight: 0 }} checked={on} onChange={async () => {
                          const next = on ? chosen.filter(id => id !== c.id) : [...chosen, c.id]
                          if (me) { await update('profiles', me.id, { google_calendar_ids: next }); clearGoogleCache() }
                        }} />
                        <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color ?? '#0e7490', display: 'inline-block' }} />
                        <div className="title">{c.name}{c.primary && <span className="tiny muted"> · main calendar</span>}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="row mt">
                <button className="btn" onClick={() => signInWithGoogle()}>Reconnect</button>
                <button className="btn danger" onClick={async () => { if (me && confirm('Stop showing your Google Calendar in the planner?')) { await disconnectGoogle(me.id); clearGoogleCache(); await refresh('google_tokens'); toast('Google Calendar disconnected') } }}>Disconnect</button>
              </div>
            </> : <>
              <p className="small">Connect your work Google account to sign in with it and to see your Google Calendar events alongside job deadlines. The planner only reads your calendar; it never changes it.</p>
              <button className="btn primary" onClick={async () => { const err = await signInWithGoogle(); if (err) toast(err, 'error') }}>Connect Google account</button>
            </>}
          </div>

          <div className="card" id="calendar">
            <h2>Planner → Google Calendar feed</h2>
            <p className="small">Deadlines and site visits appear in Google Calendar automatically once you subscribe to your personal feed. Google refreshes subscribed calendars a few times a day.</p>
            {feedUrl ? <>
              <div className="field"><label>Your private calendar feed link</label><input readOnly value={feedUrl} onFocus={e => e.target.select()} /></div>
              <div className="row"><button className="btn" onClick={() => { navigator.clipboard?.writeText(feedUrl); toast('Link copied') }}>Copy link</button>
                <a className="btn" href={`https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(feedUrl)}`} target="_blank" rel="noreferrer">Open Google Calendar "From URL" page</a></div>
              <ol className="small mt" style={{ paddingLeft: 18 }}>
                <li>Click <b>Copy link</b>.</li>
                <li>Click the Google Calendar button. On the page that opens, paste the link into the <b>URL of calendar</b> box and click <b>Add calendar</b>.</li>
                <li>It appears under "Other calendars" on every device signed into your Google account.</li>
              </ol>
              <p className="small muted">Add <code>&amp;mine=1</code> to the end of the link to include only items assigned to you.</p>
            </> : <p className="small muted">Available once connected to Supabase.</p>}
          </div>

          <div className="card">
            <h2>Reminders</h2>
            <p className="small">Turn on browser notifications to get a once-a-day reminder of anything overdue or due today when you open the app. On iPhone/iPad, first add the app to your Home Screen (Share → Add to Home Screen).</p>
            <button className="btn" onClick={async () => setNotifMsg(await enableNotifications())}>Turn on reminders on this device</button>
            {notifMsg && <p className="small mt">{notifMsg}</p>}
          </div>

          {sample.length > 0 && (
            <div className="card">
              <h2>Sample data</h2>
              <p className="small">The app came with {sample.length} sample clients and their jobs so you could see how things work. When you are ready to start for real, remove them.</p>
              <button className="btn danger" onClick={removeSample}>Remove sample data</button>
            </div>
          )}

          <div className="card">
            <h2>Keyboard shortcuts</h2>
            <p className="small muted">Press <kbd>?</kbd> anywhere to see them.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
