// Settings: your profile, business defaults, appearance, calendar sync,
// reminders, installing on a phone, and links to other tools.
import { useState } from 'react'
import { Bell, Briefcase, CalendarDays, Copy, Download, ExternalLink, History, Keyboard, LogOut, Moon, Monitor, Palette, Ruler, Smartphone, Sun, Trash2, User } from 'lucide-react'
import { useData } from '../lib/store'
import { DEMO, SUPABASE_URL, supabase } from '../lib/supabase'
import { applyTheme, savedTheme, type Theme } from '../lib/theme'
import { enableNotifications } from '../lib/reminders'
import { buildICS, calendarItems } from '../lib/calendar'
import { downloadText, fmtMoney, todayISO } from '../lib/utils'
import { Avatar, Field, NumberInput, Segmented, useConfirm } from '../components/ui'
import './settings.css'

const COLORS = ['#2f5bea', '#0b8a7e', '#7a3fe4', '#d97a06', '#cf2f7d', '#12813f', '#e35a12', '#0e7490']

export function Settings() {
  const store = useData()
  const { settings, me, clients, update, remove, refresh, signOut, toast } = store
  const confirm = useConfirm()

  const [profile, setProfile] = useState(() => ({
    full_name: me?.full_name ?? '', hourly_rate: me?.hourly_rate ?? null as number | null, weekly_hours: me?.weekly_hours ?? 40 as number | null, color: me?.color ?? COLORS[0],
  }))
  const [business, setBusiness] = useState(() => ({
    company_name: settings.company_name, default_rate: settings.default_rate as number | null, weekly_capacity: settings.weekly_capacity as number | null,
  }))
  const [busy, setBusy] = useState<'profile' | 'business' | 'password' | 'sample' | null>(null)
  const [pw, setPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [theme, setTheme] = useState<Theme>(savedTheme)
  const [notifMsg, setNotifMsg] = useState('')

  const feedUrl = me ? `${SUPABASE_URL ?? 'https://your-project.supabase.co'}/functions/v1/ics?token=${me.ics_token}` : ''
  const sample = clients.filter(c => c.is_sample)
  const base = import.meta.env.BASE_URL

  async function saveProfile() {
    if (!me || busy) return
    if (profile.hourly_rate != null && profile.hourly_rate < 0) { toast('Your rate cannot be negative.', 'error'); return }
    if (profile.weekly_hours == null || profile.weekly_hours <= 0 || profile.weekly_hours > 120) { toast('Enter the hours per week you can work (1–120).', 'error'); return }
    setBusy('profile')
    const ok = await update('profiles', me.id, { full_name: profile.full_name.trim() || me.full_name, hourly_rate: profile.hourly_rate, weekly_hours: profile.weekly_hours, color: profile.color })
    setBusy(null)
    if (ok) toast('Profile saved')
  }
  async function saveBusiness() {
    if (busy) return
    if (business.default_rate == null || business.default_rate < 0) { toast('Enter a default hourly rate (zero or more).', 'error'); return }
    if (business.weekly_capacity == null || business.weekly_capacity <= 0) { toast('Enter a weekly capacity greater than zero.', 'error'); return }
    setBusy('business')
    const ok = await update('settings', 1, { company_name: business.company_name.trim() || 'Wisner Engineering', default_rate: business.default_rate, weekly_capacity: business.weekly_capacity })
    setBusy(null)
    if (ok) toast('Business settings saved')
  }
  async function changePassword() {
    if (busy) return
    if (pw.length < 6) { setPwMsg({ text: 'Use at least 6 characters.', ok: false }); return }
    setBusy('password'); setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(null)
    if (error) setPwMsg({ text: error.message, ok: false })
    else { setPw(''); setPwMsg({ text: 'Password changed. Use it next time you sign in.', ok: true }) }
  }
  function pickTheme(t: Theme) { setTheme(t); applyTheme(t) }
  async function copyFeed() {
    try { await navigator.clipboard.writeText(feedUrl); toast('Calendar link copied') }
    catch { toast('Could not copy automatically — select the link and copy it.', 'error') }
  }
  function downloadMonth() {
    const month = todayISO().slice(0, 7)
    const items = calendarItems(store).filter(i => !i.done && i.date.startsWith(month))
    downloadText(`wisner-${month}.ics`, buildICS(items, `${settings.company_name} — ${month}`), 'text/calendar')
    toast(`Downloaded ${items.length} calendar item${items.length === 1 ? '' : 's'}`)
  }
  async function removeSample() {
    if (busy) return
    if (!await confirm({ title: 'Remove the sample data?', body: `This deletes the ${sample.length} sample client${sample.length === 1 ? '' : 's'} and all of their jobs, tasks, hours and invoices. Your own records are not touched.`, confirmLabel: 'Remove sample data', danger: true })) return
    setBusy('sample')
    let ok = true
    for (const c of sample) ok = (await remove('clients', c.id)) && ok
    await refresh()
    setBusy(null)
    toast(ok ? 'Sample data removed' : 'Some sample data could not be removed. Try again.', ok ? 'ok' : 'error')
  }

  return <div className="settings-page">
    <div className="page-head">
      <div className="titles"><h1>Settings</h1><p className="lede">Your rates, calendar sync and how the app looks.</p></div>
      <div className="actions"><button className="btn" onClick={() => void signOut()}><LogOut size={16} /> Sign out</button></div>
    </div>

    <div className="settings-grid">
      <div className="stack loose">
        <section className="card">
          <div className="card-head"><h2><User size={17} className="muted" /> Your profile</h2></div>
          <form className="card-body form-fields" onSubmit={e => { e.preventDefault(); void saveProfile() }}>
            <div className="row" style={{ gap: 14 }}>
              <Avatar name={profile.full_name || me?.email || '?'} color={profile.color} size="lg" />
              <Field label="Name" htmlFor="set-name" className="grow"><input id="set-name" className="input" value={profile.full_name} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} /></Field>
            </div>
            <div className="field-grid">
              <Field label="Your hourly rate" htmlFor="set-rate" hint="Leave blank to use the business default.">
                <NumberInput id="set-rate" value={profile.hourly_rate} onChange={v => setProfile(p => ({ ...p, hourly_rate: v }))} step={5} min={0} prefix="$" suffix="/ hour" placeholder={String(settings.default_rate)} />
              </Field>
              <Field label="Hours you can work per week" htmlFor="set-hours" hint="Used to show how booked up you are.">
                <NumberInput id="set-hours" value={profile.weekly_hours} onChange={v => setProfile(p => ({ ...p, weekly_hours: v }))} step={1} min={1} suffix="hours" />
              </Field>
            </div>
            <Field label="Color">
              <div className="color-row" role="radiogroup" aria-label="Profile color">
                {COLORS.map(c => <button key={c} type="button" role="radio" aria-checked={profile.color === c} aria-label={c} className={`color-dot ${profile.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setProfile(p => ({ ...p, color: c }))} />)}
              </div>
            </Field>
            <div className="row between wrap">
              <span className="small muted">Signed in as {me?.email ?? '—'}</span>
              <button className="btn primary" disabled={busy !== null}>{busy === 'profile' ? 'Saving…' : 'Save profile'}</button>
            </div>
          </form>
          <form className="card-foot settings-password" onSubmit={e => { e.preventDefault(); void changePassword() }}>
            <Field label="New password" htmlFor="set-pw" className="grow">
              <input id="set-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 6 characters" />
            </Field>
            <button className="btn" disabled={busy !== null || !pw}>{busy === 'password' ? 'Saving…' : 'Change password'}</button>
            {pwMsg && <p className={`small ${pwMsg.ok ? 'ok-text' : 'danger-text'}`} role="status" style={{ flexBasis: '100%' }}>{pwMsg.text}</p>}
          </form>
        </section>

        <section className="card">
          <div className="card-head"><h2><Briefcase size={17} className="muted" /> Business</h2></div>
          <form className="card-body form-fields" onSubmit={e => { e.preventDefault(); void saveBusiness() }}>
            <Field label="Company name" htmlFor="set-company"><input id="set-company" className="input" value={business.company_name} onChange={e => setBusiness(b => ({ ...b, company_name: e.target.value }))} /></Field>
            <div className="field-grid">
              <Field label="Default hourly rate" htmlFor="set-default-rate"><NumberInput id="set-default-rate" value={business.default_rate} onChange={v => setBusiness(b => ({ ...b, default_rate: v }))} step={5} min={0} prefix="$" suffix="/ hour" /></Field>
              <Field label="Default weekly capacity" htmlFor="set-capacity"><NumberInput id="set-capacity" value={business.weekly_capacity} onChange={v => setBusiness(b => ({ ...b, weekly_capacity: v }))} step={1} min={1} suffix="hours" /></Field>
            </div>
            <p className="form-note small">Changing a rate only affects hours logged from now on. Hours already logged keep the rate they were saved with{settings.default_rate ? ` (currently ${fmtMoney(settings.default_rate)}/h by default)` : ''}.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy !== null}>{busy === 'business' ? 'Saving…' : 'Save business settings'}</button></div>
          </form>
        </section>

        <section className="card">
          <div className="card-head"><h2><Palette size={17} className="muted" /> Appearance</h2></div>
          <div className="card-body stack">
            <p className="small soft">Dark mode is easier on the eyes at night. “System” follows your device.</p>
            <Segmented label="Appearance" value={theme} onChange={pickTheme} options={[
              { value: 'system', label: 'System', icon: <Monitor size={15} /> },
              { value: 'light', label: 'Light', icon: <Sun size={15} /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={15} /> },
            ]} />
          </div>
        </section>
      </div>

      <div className="stack loose">
        <section className="card" id="calendar">
          <div className="card-head"><h2><CalendarDays size={17} className="muted" /> Google Calendar sync</h2></div>
          <div className="card-body stack">
            <p className="small soft">Your deadlines and site visits can appear in Google Calendar on every device. Google checks for changes a few times a day.</p>
            {DEMO && <p className="form-note warn small">Demo mode: this is a sample link and won't work in Google Calendar.</p>}
            <Field label="Your private calendar link" htmlFor="set-feed" hint="Keep it private — anyone with the link can see your schedule.">
              <div className="row">
                <input id="set-feed" className="input" readOnly value={feedUrl} onFocus={e => e.target.select()} />
                <button className="btn" type="button" onClick={() => void copyFeed()} disabled={!feedUrl}><Copy size={15} /> Copy</button>
              </div>
            </Field>
            <ol className="steps">
              <li>Click <b>Copy</b> above.</li>
              <li>Open Google Calendar's <b>From URL</b> page with the button below.</li>
              <li>Paste the link into <b>URL of calendar</b> and click <b>Add calendar</b>.</li>
            </ol>
            <div className="row wrap">
              <a className="btn primary" href={`https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(feedUrl)}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open Google Calendar</a>
              <button className="btn" type="button" onClick={downloadMonth}><Download size={15} /> Download this month (.ics)</button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2><Bell size={17} className="muted" /> Reminders</h2></div>
          <div className="card-body stack">
            <p className="small soft">Get one notification a day, when you open the app, listing anything overdue or due today.</p>
            <div><button className="btn" onClick={async () => setNotifMsg(await enableNotifications())}><Bell size={15} /> Turn on reminders on this device</button></div>
            {notifMsg && <p className="small" role="status">{notifMsg}</p>}
            <p className="tiny muted">On iPhone or iPad, add the app to your Home Screen first (see below), then turn reminders on from there.</p>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2><Smartphone size={17} className="muted" /> Put it on your phone</h2></div>
          <div className="card-body install">
            <div><span className="strong">iPhone / iPad</span><p className="small soft">Open this page in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</p></div>
            <div><span className="strong">Android</span><p className="small soft">Open this page in Chrome, tap <b>⋮</b>, then <b>Add to Home screen</b>.</p></div>
            <p className="tiny muted">It then opens full-screen like a regular app.</p>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Other tools</h2></div>
          <div className="sheet-list settings-links">
            <a href={`${base}shear-wall/`} target="_blank" rel="noreferrer"><span className="ico"><Ruler size={19} /></span><span className="grow">Shear wall analyzer<span className="desc">SDPWS segmented shear wall tool</span></span><ExternalLink size={16} className="muted" /></a>
            <a href={`${base}classic/`}><span className="ico"><History size={19} /></span><span className="grow">Classic version<span className="desc">The previous design — it uses the same data, so anything you change shows up in both</span></span></a>
            <div className="settings-keys"><span className="ico"><Keyboard size={19} /></span><span className="grow">Keyboard shortcuts<span className="desc">Press <kbd>?</kbd> anywhere to see them</span></span></div>
          </div>
        </section>

        {sample.length > 0 && <section className="card danger-card">
          <div className="card-head"><h2>Sample data</h2></div>
          <div className="card-body stack">
            <p className="small soft">The app came with {sample.length} sample client{sample.length === 1 ? '' : 's'} so you could see how things work. Remove them when you're ready to start for real.</p>
            <div><button className="btn danger" onClick={() => void removeSample()} disabled={busy !== null}><Trash2 size={15} /> {busy === 'sample' ? 'Removing…' : 'Remove sample data'}</button></div>
          </div>
        </section>}
      </div>
    </div>
  </div>
}
