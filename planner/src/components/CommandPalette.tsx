// Global search + quick commands (press / or Ctrl+K anywhere).
import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Briefcase, Building2, Calculator, CalendarDays, CheckSquare, CircleDollarSign, Clock, FileText, Keyboard, MapPin, Play, Plus, Search, Settings, Sun } from 'lucide-react'
import { useData } from '../lib/store'
import { startTimer } from '../lib/timer'
import { jobStage, STAGE_LABEL } from '../lib/stages'
import { todayISO } from '../lib/utils'
import { useEditors } from './editors'

interface Item { id: string; group: string; label: string; sub?: string; icon: ReactNode; run: () => void; keywords?: string }

export function CommandPalette({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const store = useData()
  const edit = useEditors()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const go = (to: string) => () => { onClose(); navigate(to) }
  const act = (fn: () => void) => () => { onClose(); fn() }

  const items: Item[] = (() => {
    const needle = q.trim().toLowerCase()
    const match = (...parts: (string | null | undefined)[]) => !needle || parts.some(p => p?.toLowerCase().includes(needle))
    const client = (id: string) => store.clients.find(c => c.id === id)?.name ?? ''
    const out: Item[] = []
    const commands: Item[] = [
      { id: 'c-time', group: 'Actions', label: 'Log hours', icon: <Clock size={16} />, run: act(() => edit.time()), keywords: 'time hours log' },
      { id: 'c-task', group: 'Actions', label: 'New task', icon: <Plus size={16} />, run: act(() => edit.task()), keywords: 'add todo' },
      { id: 'c-visit', group: 'Actions', label: 'New site visit', icon: <MapPin size={16} />, run: act(() => edit.task(undefined, { is_site_visit: true, due_date: todayISO() })), keywords: 'inspection observation' },
      { id: 'c-job', group: 'Actions', label: 'New job', icon: <Briefcase size={16} />, run: act(() => edit.job()), keywords: 'project add' },
      { id: 'c-client', group: 'Actions', label: 'New client', icon: <Building2 size={16} />, run: act(() => edit.client()), keywords: 'customer add' },
      { id: 'c-deposit', group: 'Actions', label: 'Record deposit', icon: <CircleDollarSign size={16} />, run: act(() => edit.deposit()), keywords: 'retainer payment money' },
      { id: 'c-estimate', group: 'Actions', label: 'Estimate a fee', icon: <Calculator size={16} />, run: go('/money?tab=estimate'), keywords: 'proposal quote bid price fee estimator' },
      { id: 'g-today', group: 'Go to', label: 'Today', icon: <Sun size={16} />, run: go('/'), keywords: 'home dashboard' },
      { id: 'g-jobs', group: 'Go to', label: 'Jobs', icon: <Briefcase size={16} />, run: go('/jobs'), keywords: 'board pipeline projects' },
      { id: 'g-schedule', group: 'Go to', label: 'Schedule', icon: <CalendarDays size={16} />, run: go('/schedule'), keywords: 'calendar plan timeline gantt week' },
      { id: 'g-time', group: 'Go to', label: 'Time', icon: <Clock size={16} />, run: go('/time'), keywords: 'timesheet hours' },
      { id: 'g-money', group: 'Go to', label: 'Money', icon: <CircleDollarSign size={16} />, run: go('/money'), keywords: 'billing invoices deposits reports' },
      { id: 'g-clients', group: 'Go to', label: 'Clients', icon: <Building2 size={16} />, run: go('/clients'), keywords: 'contacts customers' },
      { id: 'g-settings', group: 'Go to', label: 'Settings', icon: <Settings size={16} />, run: go('/settings'), keywords: 'rate calendar sync theme dark' },
      { id: 'g-keys', group: 'Go to', label: 'Keyboard shortcuts', icon: <Keyboard size={16} />, run: onHelp, keywords: 'help keys' },
    ]
    const jobs = store.jobs.filter(j => j.status !== 'archived' || needle).filter(j => match(j.name, j.job_number, j.address, client(j.client_id)))
    jobs.slice(0, needle ? 8 : 5).forEach(j => {
      const st = jobStage(store.phases, j.id)
      out.push({ id: `j-${j.id}`, group: 'Jobs', label: j.name, sub: [j.job_number, client(j.client_id), j.status === 'active' ? STAGE_LABEL[st.stage] : j.status.replace('_', ' ')].filter(Boolean).join(' · '), icon: <Briefcase size={16} />, run: go(`/jobs/${j.id}`) })
      if (needle && j.status === 'active') out.push({ id: `t-${j.id}`, group: 'Jobs', label: `Start timer on ${j.name}`, icon: <Play size={16} />, run: act(() => void startTimer(store, { job_id: j.id })) })
    })
    if (needle) {
      store.clients.filter(c => match(c.name, c.contact_name, c.email, c.phone)).slice(0, 5).forEach(c =>
        out.push({ id: `cl-${c.id}`, group: 'Clients', label: c.name, sub: [c.contact_name, c.phone].filter(Boolean).join(' · '), icon: <Building2 size={16} />, run: go(`/clients/${c.id}`) }))
      store.tasks.filter(t => t.status !== 'done' && match(t.title, t.description)).slice(0, 6).forEach(t =>
        out.push({ id: `tk-${t.id}`, group: 'Tasks', label: t.title, sub: store.jobs.find(j => j.id === t.job_id)?.name, icon: <CheckSquare size={16} />, run: act(() => edit.task(t)) }))
      store.invoices.filter(i => match(i.number, i.notes)).slice(0, 4).forEach(i =>
        out.push({ id: `iv-${i.id}`, group: 'Invoices', label: i.number, sub: store.jobs.find(j => j.id === i.job_id)?.name, icon: <FileText size={16} />, run: go(`/money/invoice/${i.id}`) }))
    }
    const cmds = commands.filter(c => match(c.label, c.keywords))
    return needle ? [...out, ...cmds] : [...cmds.slice(0, 6), ...out, ...cmds.slice(6)]
  })()

  const safeActive = Math.min(active, Math.max(0, items.length - 1))
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(items.length - 1, i + 1)); scrollTo(safeActive + 1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); scrollTo(safeActive - 1) }
    if (e.key === 'Enter') { e.preventDefault(); items[safeActive]?.run() }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  const scrollTo = (i: number) => listRef.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' })

  let lastGroup = ''
  return createPortal(<div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="dialog palette" role="dialog" aria-modal="true" aria-label="Search">
      <div className="palette-input">
        <Search size={18} />
        <input autoFocus value={q} onChange={e => { setQ(e.target.value); setActive(0) }} onKeyDown={onKey} placeholder="Search jobs, clients, tasks, invoices… or type a command" aria-label="Search" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={items[safeActive] ? `pal-${items[safeActive].id}` : undefined} />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
        {items.length === 0 && <div className="empty compact"><p>Nothing matches “{q}”.</p></div>}
        {items.map((it, i) => {
          const head = it.group !== lastGroup ? (lastGroup = it.group) : null
          return <div key={it.id}>
            {head && <div className="palette-group">{head}</div>}
            <button id={`pal-${it.id}`} data-index={i} role="option" aria-selected={i === safeActive} className={`palette-item ${i === safeActive ? 'on' : ''}`} onMouseMove={() => setActive(i)} onClick={it.run}>
              <span className="palette-ico">{it.icon}</span>
              <span className="grow truncate"><span className="strong">{it.label}</span>{it.sub && <span className="muted small"> — {it.sub}</span>}</span>
            </button>
          </div>
        })}
      </div>
    </div>
  </div>, document.body)
}
