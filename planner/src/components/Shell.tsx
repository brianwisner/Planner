// The app frame: sidebar on desktop, compact top bar + bottom tabs + "+" button
// on phones, the timer, search, keyboard shortcuts and toasts.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Briefcase, Building2, CalendarDays, CircleDollarSign, Clock, Ellipsis, ExternalLink, FileText, History, Keyboard, MapPin, Play,
  Plus, Ruler, Search, Settings, Square, Sun, Wallet, X,
} from 'lucide-react'
import { useData } from '../lib/store'
import { runningTimers, startTimer, elapsedLabel } from '../lib/timer'
import { useStopTimer } from './useTimerActions'
import { lateCount as countLate } from '../lib/views'
import { todayISO } from '../lib/utils'
import { useEditors } from './editors'
import { CommandPalette } from './CommandPalette'
import { Menu, Modal, Avatar, type MenuEntry } from './ui'
import { BrandMark } from './Brand'
import { DEMO } from '../lib/supabase'

const SHEAR_WALL_URL = `${import.meta.env.BASE_URL}shear-wall/`
// The demo is published in demo/, one folder below the planner and classic/.
const CLASSIC_URL = DEMO ? '../classic/' : `${import.meta.env.BASE_URL}classic/`

interface NavItem { to: string; label: string; icon: typeof Sun; end?: boolean; phone?: boolean }
const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: Sun, end: true, phone: true },
  { to: '/jobs', label: 'Jobs', icon: Briefcase, phone: true },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays, phone: true },
  { to: '/time', label: 'Time', icon: Clock, phone: true },
  { to: '/money', label: 'Money', icon: CircleDollarSign },
  { to: '/clients', label: 'Clients', icon: Building2 },
]


export function Shell({ children }: { children: ReactNode }) {
  const store = useData()
  const { settings, me, error, online } = store
  const edit = useEditors()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [palette, setPalette] = useState(false)
  const [help, setHelp] = useState(false)
  const [sheet, setSheet] = useState<'new' | 'more' | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)

  const today = todayISO()
  const lateCount = useMemo(() => countLate(store, today), [store, today])

  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    const on = () => setOffline(false), off = () => setOffline(true)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Keyboard shortcuts (desktop). Ignored while typing or when a dialog is open.
  useEffect(() => {
    let pendingG = 0
    const GO: Record<string, string> = { t: '/', j: '/jobs', s: '/schedule', h: '/time', m: '/money', c: '/clients' }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); return }
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.overlay')) return
      const now = Date.now()
      if (pendingG && now - pendingG < 1200 && GO[e.key]) { e.preventDefault(); navigate(GO[e.key]); pendingG = 0; return }
      pendingG = 0
      switch (e.key) {
        case '/': e.preventDefault(); setPalette(true); break
        case 'n': e.preventDefault(); edit.task(); break
        case 'l': e.preventDefault(); edit.time(); break
        case 'J': e.preventDefault(); edit.job(); break
        case '?': e.preventDefault(); setHelp(true); break
        case 'g': pendingG = now; break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [edit, navigate])

  const newItems: MenuEntry[] = [
    { label: 'Log hours', icon: <Clock size={16} />, onSelect: () => edit.time(), hint: <kbd>L</kbd> },
    { label: 'New task', icon: <CalendarDays size={16} />, onSelect: () => edit.task(), hint: <kbd>N</kbd> },
    { label: 'Site visit', icon: <MapPin size={16} />, onSelect: () => edit.task(undefined, { is_site_visit: true, due_date: today }) },
    'sep',
    { label: 'New job', icon: <Briefcase size={16} />, onSelect: () => edit.job() },
    { label: 'New client', icon: <Building2 size={16} />, onSelect: () => edit.client() },
    'sep',
    { label: 'Record deposit', icon: <Wallet size={16} />, onSelect: () => edit.deposit() },
    { label: 'Add charge', icon: <FileText size={16} />, onSelect: () => edit.charge() },
  ]

  return <div className="app">
    <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to content</a>

    <aside className="sidebar" aria-label="Main">
      <NavLink to="/" className="brand" aria-label={`${settings.company_name} — Today`}>
        <BrandMark />
        <span className="brand-text"><span className="brand-name">{settings.company_name}</span><span className="brand-sub" style={{ display: 'block' }}>Planner</span></span>
      </NavLink>
      <nav className="nav">
        {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} title={n.label}>
          <n.icon size={19} /><span>{n.label}</span>
          {n.to === '/' && lateCount > 0 && <span className="count danger" aria-label={`${lateCount} late`}>{lateCount}</span>}
        </NavLink>)}
      </nav>
      <div className="spacer" />
      <nav className="nav">
        <a href={SHEAR_WALL_URL} target="_blank" rel="noreferrer" title="Shear wall analyzer"><Ruler size={19} /><span>Shear wall tool</span></a>
        <NavLink to="/settings" title="Settings"><Settings size={19} /><span>Settings</span></NavLink>
      </nav>
      <div className="sidebar-foot">
        <button className="me-chip" onClick={() => setHelp(true)} title="Keyboard shortcuts">
          <Avatar name={me?.full_name || me?.email || '?'} color={me?.color} />
          <span className="me-text grow" style={{ minWidth: 0 }}><span className="who truncate" style={{ display: 'block' }}>{me?.full_name || 'You'}</span><span className="what">Shortcuts: press ?</span></span>
        </button>
      </div>
    </aside>

    <div className="main">
      <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
        <button className="search-trigger" onClick={() => setPalette(true)} aria-label="Search and commands">
          <Search size={16} /><span>Search jobs, clients, tasks…</span><kbd>/</kbd>
        </button>
        {offline ? <span className="badge danger sync-badge">Offline</span> : error ? <span className="badge danger sync-badge" title={error}>Sync problem</span> : !online && <span className="badge warn sync-badge" title="Live updates are paused; the app refreshes when you come back to the tab.">Reconnecting…</span>}
        <div className="spacer" />
        <TimerControl />
        <Menu label="Create" items={newItems} trigger={p => <button className="btn primary" {...p}><Plus size={17} /> New</button>} />
      </header>

      <header className="mobile-top">
        <BrandMark small />
        <span className="title truncate">{settings.company_name}</span>
        <TimerControl compact />
        <button className="btn icon" onClick={() => setPalette(true)} aria-label="Search"><Search size={20} /></button>
      </header>

      {DEMO && <div className="demo-banner" role="note">Demo with made-up data — try anything, nothing is saved. <a href="../">Open the real planner</a></div>}
      <main id="main" className="content" tabIndex={-1}>{children}</main>
    </div>

    <nav className="bottom-nav" aria-label="Main">
      {NAV.filter(n => n.phone).map(n => <NavLink key={n.to} to={n.to} end={n.end}>
        <n.icon size={22} />{n.label}
        {n.to === '/' && lateCount > 0 && <span className="count danger">{lateCount}</span>}
      </NavLink>)}
      <button className={NAV.some(n => !n.phone && pathname.startsWith(n.to)) || pathname.startsWith('/settings') ? 'active' : ''} onClick={() => setSheet('more')} aria-haspopup="dialog"><Ellipsis size={22} />More</button>
    </nav>
    <button className="fab" onClick={() => setSheet('new')} aria-label="Add something new"><Plus size={26} /></button>

    {sheet === 'new' && <Modal title="Add" onClose={() => setSheet(null)}>
      <div className="sheet-list">
        <SheetButton icon={<Clock size={19} />} tone="ok" label="Log hours" desc="Record time you already worked" onClick={() => { setSheet(null); edit.time() }} />
        <SheetButton icon={<CalendarDays size={19} />} tone="accent" label="New task" desc="Something to do on a job" onClick={() => { setSheet(null); edit.task() }} />
        <SheetButton icon={<MapPin size={19} />} tone="visit" label="Site visit" desc="Shows on the calendar with a time" onClick={() => { setSheet(null); edit.task(undefined, { is_site_visit: true, due_date: today }) }} />
        <SheetButton icon={<Briefcase size={19} />} label="New job" onClick={() => { setSheet(null); edit.job() }} />
        <SheetButton icon={<Building2 size={19} />} label="New client" onClick={() => { setSheet(null); edit.client() }} />
        <SheetButton icon={<Wallet size={19} />} tone="warn" label="Record deposit" onClick={() => { setSheet(null); edit.deposit() }} />
        <SheetButton icon={<FileText size={19} />} label="Add charge" desc="Mileage, printing, fees" onClick={() => { setSheet(null); edit.charge() }} />
      </div>
    </Modal>}
    {sheet === 'more' && <Modal title="More" onClose={() => setSheet(null)}>
      <div className="sheet-list">
        <SheetLink to="/money" icon={<CircleDollarSign size={19} />} tone="ok" label="Money" desc="Invoices, deposits, unbilled work, reports" onDone={() => setSheet(null)} />
        <SheetLink to="/clients" icon={<Building2 size={19} />} tone="accent" label="Clients" desc="Contacts and client history" onDone={() => setSheet(null)} />
        <SheetLink to="/settings" icon={<Settings size={19} />} label="Settings" desc="Rates, calendar sync, appearance" onDone={() => setSheet(null)} />
        <a href={SHEAR_WALL_URL} target="_blank" rel="noreferrer"><span className="ico"><Ruler size={19} /></span><span className="grow">Shear wall tool<span className="desc">SDPWS segmented shear wall analyzer</span></span><ExternalLink size={16} className="muted" /></a>
        <a href={CLASSIC_URL}><span className="ico"><History size={19} /></span><span className="grow">Classic version<span className="desc">The previous design, same data</span></span></a>
      </div>
    </Modal>}

    {palette && <CommandPalette onClose={() => setPalette(false)} onHelp={() => { setPalette(false); setHelp(true) }} />}
    {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
    <Toasts />
  </div>
}

function SheetButton({ icon, label, desc, tone, onClick }: { icon: ReactNode; label: string; desc?: string; tone?: string; onClick: () => void }) {
  return <button onClick={onClick}><span className={`ico ${tone ?? ''}`}>{icon}</span><span className="grow">{label}{desc && <span className="desc">{desc}</span>}</span></button>
}
function SheetLink({ to, icon, label, desc, tone, onDone }: { to: string; icon: ReactNode; label: string; desc?: string; tone?: string; onDone: () => void }) {
  return <NavLink to={to} onClick={onDone}><span className={`ico ${tone ?? ''}`}>{icon}</span><span className="grow">{label}{desc && <span className="desc">{desc}</span>}</span></NavLink>
}

/** Running timer chip with Stop, or a Start timer button listing open jobs. */
export function TimerControl({ compact }: { compact?: boolean }) {
  const store = useData()
  const edit = useEditors()
  const timers = runningTimers(store)
  const running = timers[0]
  const stop = useStopTimer()
  const navigate = useNavigate()
  const [, tick] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!running) return; const id = setInterval(() => tick(n => n + 1), 15000); return () => clearInterval(id) }, [running])
  if (running) {
    const job = store.jobs.find(j => j.id === running.job_id)
    return <div className="timer-chip" role="status">
      <span className="pulse" />
      <button className="clock" style={{ border: 0, background: 'none', color: 'inherit', font: 'inherit', padding: 0 }} onClick={() => edit.time(running)} title="Edit this timer">{elapsedLabel(running.started_at!)}</button>
      <span className="job truncate">{timers.length > 1 ? `${timers.length} timers running` : job?.name}</span>
      {timers.length > 1
        ? <button className="stop" onClick={() => navigate('/time')}>{compact ? '!' : 'Review'}</button>
        : <button className="stop" disabled={busy} onClick={async () => { setBusy(true); await stop(running); setBusy(false) }} aria-label="Stop timer and save hours"><Square size={12} fill="currentColor" />{compact ? '' : 'Stop'}</button>}
    </div>
  }
  if (compact) return null
  const jobs = store.jobs.filter(j => j.status === 'active')
  const items: MenuEntry[] = jobs.length
    ? [{ section: 'Start a timer on…' }, ...jobs.slice(0, 14).map(j => ({ label: <span className="truncate" style={{ display: 'block' }}>{j.name}</span>, icon: <Play size={14} />, onSelect: () => void startTimer(store, { job_id: j.id }) }))]
    : [{ label: 'Add a job first', disabled: true }]
  return <Menu label="Start timer" items={items} trigger={p => <button className="btn" {...p}><Play size={15} /> Start timer</button>} />
}

function Toasts() {
  const { toasts, dismissToast } = useData()
  return <div className="toasts" role="status" aria-live="polite">
    {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>
      <span>{t.msg}</span>
      {t.action && <button className="toast-action" onClick={() => { void t.action!.run(); dismissToast(t.id) }}>{t.action.label}</button>}
      <button className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><X size={15} /></button>
    </div>)}
  </div>
}

const SHORTCUTS: [string, string][] = [
  ['/  or  Ctrl K', 'Search and commands'],
  ['N', 'New task'],
  ['L', 'Log hours'],
  ['Shift J', 'New job'],
  ['G then T', 'Go to Today'],
  ['G then J', 'Go to Jobs'],
  ['G then S', 'Go to Schedule'],
  ['G then H', 'Go to Time (hours)'],
  ['G then M', 'Go to Money'],
  ['G then C', 'Go to Clients'],
  ['Esc', 'Close a pop-up'],
]

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return <Modal size="narrow" title={<span className="row"><Keyboard size={18} /> Keyboard shortcuts</span>} onClose={onClose}>
    <table className="table"><tbody>{SHORTCUTS.map(([k, v]) => <tr key={k}><td className="nowrap">{k.split('  or  ').map((part, i) => <span key={i}>{i > 0 && <span className="muted"> or </span>}{part.split(' ').map(x => <kbd key={x} style={{ marginRight: 3 }}>{x}</kbd>)}</span>)}</td><td>{v}</td></tr>)}</tbody></table>
  </Modal>
}
