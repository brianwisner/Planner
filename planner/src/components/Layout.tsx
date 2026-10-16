// The app shell: left sidebar (desktop), bottom tabs (phone), top bar with
// search and quick-add, running-timer pill, toasts, and keyboard shortcuts.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useData } from '../lib/store'
import { timerHours } from '../lib/calc'
import { fmtHours } from '../lib/utils'
import { TaskModal, TimeModal } from './editors'
import { SearchPalette } from './SearchPalette'
import { ShortcutsModal, useShortcuts } from './Shortcuts'
import { Avatar, Icon } from './ui'

const NAV: { to: string; label: string; icon: string; mobile?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', mobile: true },
  { to: '/jobs', label: 'Jobs', icon: 'jobs', mobile: true },
  { to: '/clients', label: 'Clients', icon: 'clients' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar', mobile: true },
  { to: '/time', label: 'Time', icon: 'time', mobile: true },
  { to: '/billing', label: 'Billing', icon: 'billing' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
  { to: '/settings', label: 'Settings', icon: 'settings', mobile: true },
]

export function Layout({ children }: { children: ReactNode }) {
  const { settings, me, toasts, online, error, timeEntries, jobs, update } = useData()
  const [netOffline, setNetOffline] = useState(!navigator.onLine)
  useEffect(() => {
    const on = () => setNetOffline(false), off = () => setNetOffline(true)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  const [quickAdd, setQuickAdd] = useState(false)
  const [search, setSearch] = useState(false)
  const [logTime, setLogTime] = useState(false)
  const [help, setHelp] = useState(false)

  const actions = useMemo(() => ({
    quickAdd: () => setQuickAdd(true), search: () => setSearch(true), logTime: () => setLogTime(true), help: () => setHelp(true),
  }), [])
  useShortcuts(actions)

  // Each new page starts at the top (filters and tabs within a page keep their place).
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  const running = timeEntries.find(e => e.user_id === me?.id && e.started_at && e.hours == null)
  const stopTimer = useCallback(async () => {
    if (!running) return
    const hours = timerHours(running)
    await update('time_entries', running.id, { hours, started_at: null })
  }, [running, update])

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">{settings.company_name}<small>Project Planner</small></div>
        <nav>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} />{n.label}</NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="user">
          <Avatar userId={me?.id} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.full_name ?? '…'}</div>
            <a href="#" style={{ color: 'rgba(255,255,255,0.7)' }} onClick={e => { e.preventDefault(); setHelp(true) }}>Shortcuts <kbd style={{ background: 'transparent', color: 'inherit', borderColor: 'rgba(255,255,255,0.3)' }}>?</kbd></a>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="search" onClick={() => setSearch(true)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setSearch(true) }}>
            <Icon name="search" size={16} /> <span>Search…</span><kbd>/</kbd>
          </div>
          {running && (
            <button className="timer-pill" onClick={stopTimer} title="Click to stop the timer">
              <span className="dot" /> <TimerClock startedAt={running.started_at!} /> · {jobs.find(j => j.id === running.job_id)?.name?.slice(0, 24)} <Icon name="stop" size={12} />
            </button>
          )}
          {netOffline ? <span className="badge overdue">Offline</span> : !online && <span className="badge ok hide-mobile" title="Live updates from other devices are paused. The app refreshes when you switch back to this tab.">Live sync paused</span>}
          {error && <span className="badge overdue" title={error}>Sync problem</span>}
          <div className="grow" />
          <button className="btn hide-mobile" onClick={() => setLogTime(true)} title="Log hours (t)"><Icon name="time" size={16} /> Log hours</button>
          <button className="btn primary" onClick={() => setQuickAdd(true)} title="Quick add task (n)"><Icon name="plus" size={16} /> <span className="hide-mobile">Task</span></button>
        </div>
        <main className="content">{children}</main>
      </div>

      <nav className="bottom-tabs">
        {NAV.filter(n => n.mobile).map(n => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} />{n.label}</NavLink>
        ))}
      </nav>

      {quickAdd && <TaskModal onClose={() => setQuickAdd(false)} />}
      {logTime && <TimeModal onClose={() => setLogTime(false)} />}
      {search && <SearchPalette onClose={() => setSearch(false)} />}
      {help && <ShortcutsModal onClose={() => setHelp(false)} />}

      <div className="toasts">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
      </div>
    </div>
  )
}

export function TimerClock({ startedAt }: { startedAt: string }) {
  const [, force] = useState(0)
  useEffect(() => { const id = setInterval(() => force(n => n + 1), 30000); return () => clearInterval(id) }, [])
  const hrs = (Date.now() - new Date(startedAt).getTime()) / 3600000
  return <span>{fmtHours(Math.round(hrs * 100) / 100)}</span>
}
