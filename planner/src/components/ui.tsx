// Small reusable building blocks used across every page.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useData } from '../lib/store'
import type { JobStatus, PhaseStatus, TaskStatus } from '../lib/types'
import { JOB_STATUS_LABEL, PHASE_STATUS_LABEL, TASK_STATUS_LABEL } from '../lib/types'
import { dueLabel, initials } from '../lib/utils'

/* ---------- Icons (inline SVG, no icon library needed) ---------- */
const paths: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm10 8h8V11h-8v10zM3 21h8v-6H3v6zm10-18v6h8V3h-8z',
  jobs: 'M4 6h16M4 12h16M4 18h10',
  clients: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  time: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  billing: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  close: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  play: 'M6 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  chevronL: 'M15 18l-6-6 6-6',
  chevronR: 'M9 18l6-6-6-6',
  download: 'M12 3v12M6 11l6 6 6-6M4 21h16',
  external: 'M18 13v6H5V6h6M15 3h6v6M10 14L21 3',
  pin: 'M12 22s7-7.5 7-12a7 7 0 1 0-14 0c0 4.5 7 12 7 12zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
}
export function Icon({ name, size = 18 }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? ''} />
    </svg>
  )
}

/* ---------- People ---------- */
export function Avatar({ userId, size = '' }: { userId: string | null | undefined; size?: '' | 'sm' | 'lg' }) {
  const { profiles } = useData()
  const p = profiles.find(x => x.id === userId)
  if (!p) return <span className={`avatar ${size}`} style={{ background: '#cbd3dd' }} title="Unassigned">–</span>
  return <span className={`avatar ${size}`} style={{ background: p.color }} title={p.full_name}>{initials(p.full_name)}</span>
}

export function Person({ userId, hideName }: { userId: string | null | undefined; hideName?: boolean }) {
  const { profiles } = useData()
  const p = profiles.find(x => x.id === userId)
  return (
    <span className="person">
      <Avatar userId={userId} size="sm" />
      {!hideName && <span className="small">{p ? p.full_name : <span className="muted">Unassigned</span>}</span>}
    </span>
  )
}

export function PersonSelect({ value, onChange, allowNone = true }: { value: string | null; onChange: (id: string | null) => void; allowNone?: boolean }) {
  const { profiles } = useData()
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      {allowNone && <option value="">Unassigned</option>}
      {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
    </select>
  )
}

/* ---------- Status badges & selects ---------- */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${status}`}>{JOB_STATUS_LABEL[status]}</span>
}
export function JobStatusSelect({ value, onChange, label = 'Job status' }: { value: JobStatus; onChange: (status: JobStatus) => Promise<void>; label?: string }) {
  const [saving, setSaving] = useState(false)
  return (
    <select className={`status-select job-status-select badge ${value}`} value={value} aria-label={label} aria-busy={saving} disabled={saving}
      onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
      onChange={async e => {
        const status = e.target.value as JobStatus
        if (status === value) return
        setSaving(true)
        try { await onChange(status) } finally { setSaving(false) }
      }}>
      {(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map(status => <option key={status} value={status}>{JOB_STATUS_LABEL[status]}</option>)}
    </select>
  )
}
export function PhaseStatusSelect({ value, onChange }: { value: PhaseStatus; onChange: (s: PhaseStatus) => void }) {
  return (
    <select className={`status-select badge ${value}`} value={value} onChange={e => onChange(e.target.value as PhaseStatus)}>
      {(Object.keys(PHASE_STATUS_LABEL) as PhaseStatus[]).map(s => <option key={s} value={s}>{PHASE_STATUS_LABEL[s]}</option>)}
    </select>
  )
}
export function TaskStatusSelect({ value, onChange }: { value: TaskStatus; onChange: (s: TaskStatus) => void }) {
  return (
    <select className={`status-select badge ${value}`} value={value} onChange={e => onChange(e.target.value as TaskStatus)}>
      {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
    </select>
  )
}
export function DueBadge({ date, done }: { date: string | null | undefined; done?: boolean }) {
  if (!date) return null
  const d = dueLabel(date)
  if (done) return <span className="badge ok">{d.tone === 'ok' ? d.text : dueLabel(date).text.replace(/overdue|Due /, '')}</span>
  return <span className={`badge ${d.tone}`}>{d.text}</span>
}

/* ---------- Progress ---------- */
export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : value > 0 ? 100 : 0
  const cls = pct > 100 ? 'over' : pct > 85 ? 'warn' : ''
  return <div className="bar" title={`${Math.round(pct)}%`}><span className={cls} style={{ width: `${Math.min(100, pct)}%` }} /></div>
}

/* ---------- Modal ---------- */
const openModals: HTMLElement[] = []
let previousBodyOverflow = ''

function modalControls(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'))
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

export function Modal({ title, onClose, children, footer, wide, className }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const invokerRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current!
    const invoker = invokerRef.current
    if (openModals.length === 0) {
      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    // A nested dialog's effect may run before its parent's effect.
    const descendant = openModals.findIndex(other => dialog.contains(other))
    if (descendant === -1) openModals.push(dialog)
    else openModals.splice(descendant, 0, dialog)

    const isTopmost = () => openModals.at(-1) === dialog
    const firstControl = () => {
      const body = dialog.querySelector<HTMLElement>('.body')
      return (body && modalControls(body)[0]) || modalControls(dialog)[0] || dialog
    }
    let lastFocused: HTMLElement | null = null
    const onFocus = (e: FocusEvent) => {
      if (!isTopmost()) return
      if (e.target instanceof HTMLElement && dialog.contains(e.target)) lastFocused = e.target
      else (lastFocused?.isConnected && dialog.contains(lastFocused) ? lastFocused : firstControl()).focus({ preventScroll: true })
    }
    const onKey = (e: KeyboardEvent) => {
      if (!isTopmost()) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const controls = modalControls(dialog)
        const index = controls.indexOf(document.activeElement as HTMLElement)
        if (controls.length === 0 || index === -1 || (e.shiftKey ? index === 0 : index === controls.length - 1)) {
          e.preventDefault()
          const target = controls.length ? controls[e.shiftKey ? controls.length - 1 : 0] : dialog
          target.focus({ preventScroll: true })
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus, true)
    if (isTopmost()) {
      if (dialog.contains(document.activeElement)) lastFocused = document.activeElement as HTMLElement
      else firstControl().focus({ preventScroll: true })
    }
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus, true)
      const index = openModals.indexOf(dialog)
      if (index !== -1) openModals.splice(index, 1)
      if (openModals.length === 0) document.body.style.overflow = previousBodyOverflow
      // Wait for any nested dialogs to finish unmounting before restoring focus.
      queueMicrotask(() => {
        const top = openModals.at(-1)
        if (invoker?.isConnected && (!top || top.contains(invoker))) invoker.focus({ preventScroll: true })
        else if (top && !top.contains(document.activeElement)) {
          const target = modalControls(top.querySelector<HTMLElement>('.body') ?? top)[0] || top
          target.focus({ preventScroll: true })
        }
      })
    }
  }, [])
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && openModals.at(-1) === dialogRef.current) closeRef.current() }}>
      <div ref={dialogRef} className={`modal ${wide ? 'wide' : ''} ${className ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={title !== null ? titleId : undefined} aria-label={title === null ? 'Search' : undefined} tabIndex={-1}>
        {title !== null && (
          <header>
            <h2 id={titleId}>{title}</h2>
            <button className="btn ghost icon" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
          </header>
        )}
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Checkbox({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <button type="button" className={`check ${on ? 'on' : ''}`} onClick={e => { e.stopPropagation(); onToggle() }} aria-label={label ?? (on ? 'Mark not done' : 'Mark done')}>
      {on && <Icon name="check" size={14} />}
    </button>
  )
}
