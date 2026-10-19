/* eslint-disable react-refresh/only-export-components */
// Small shared building blocks: dialog, menu, confirm, badges and inputs.
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CalendarClock, Check, ChevronDown, Inbox, X } from 'lucide-react'
import type { Stage } from '../lib/stages'
import { STAGE_LABEL } from '../lib/stages'
import { daysUntil, fmtDate, initials } from '../lib/utils'

/* ---------------- Modal ---------------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Open dialogs, newest last. Esc and Tab only act on the top one, so closing a
// "New client" form opened from "New job" keeps the job form open.
const openDialogs: string[] = []

export function Modal({ title, subtitle, onClose, children, footer, size, initialFocus = true, labelledBy }: {
  title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode
  size?: 'narrow' | 'wide'; initialFocus?: boolean; labelledBy?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => { onCloseRef.current = onClose })
  // Remember what had focus before the dialog opened, to return focus on close.
  const previousRef = useRef<HTMLElement | null>(typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null)
  useEffect(() => {
    const previous = previousRef.current
    const el = ref.current
    if (initialFocus && el && !el.contains(document.activeElement)) {
      const target = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? el.querySelector<HTMLElement>('.dialog-body ' + FOCUSABLE) ?? el
      target.focus()
    }
    openDialogs.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== id) return
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current() }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(n => n.offsetParent !== null)
        if (!items.length) return
        const first = items[0], last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      const at = openDialogs.lastIndexOf(id)
      if (at >= 0) openDialogs.splice(at, 1)
      if (!openDialogs.length) document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [initialFocus, id])
  return createPortal(
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`dialog ${size ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <h2 id={id}>{title}{subtitle && <span className="sub">{subtitle}</span>}</h2>
          <button type="button" className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ---------------- Confirm ---------------- */

interface ConfirmOptions { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }
type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>
const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null)
  const ask = useCallback<ConfirmFn>(opts => new Promise(resolve => setState({ ...opts, resolve })), [])
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  return <ConfirmContext.Provider value={ask}>
    {children}
    {state && <Modal size="narrow" title={state.title} onClose={() => close(false)} footer={<>
      <button className="btn" onClick={() => close(false)}>Cancel</button>
      <button className={`btn ${state.danger ? 'danger solid' : 'primary'}`} data-autofocus onClick={() => close(true)}>{state.confirmLabel ?? 'OK'}</button>
    </>}>
      {state.body && <div className="soft">{state.body}</div>}
    </Modal>}
  </ConfirmContext.Provider>
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext)
  return fn ?? (async (o: ConfirmOptions) => window.confirm(o.title))
}

/* ---------------- Popover menu ---------------- */

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  onSelect?: () => void
  href?: string
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  hint?: ReactNode
}
export type MenuEntry = MenuItem | 'sep' | { section: string }

export function Menu({ trigger, items, align = 'end', label }: {
  trigger: (props: { onClick: (e: React.MouseEvent<HTMLElement>) => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode
  items: MenuEntry[]; align?: 'start' | 'end'; label?: string
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const anchorEl = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const close = useCallback(() => { setAnchor(null); setPos(null); anchorEl.current?.focus() }, [])

  useLayoutEffect(() => {
    if (!anchor || !menuRef.current) return
    const m = menuRef.current.getBoundingClientRect()
    let left = align === 'end' ? anchor.right - m.width : anchor.left
    left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8))
    let top = anchor.bottom + 6
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, anchor.top - m.height - 6)
    setPos({ top, left })
    menuRef.current.querySelector<HTMLElement>('button, a')?.focus()
  }, [anchor, align])

  useEffect(() => {
    if (!anchor) return
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node) && !anchorEl.current?.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
    }
    const onScroll = () => close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onScroll)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onScroll) }
  }, [anchor, close])

  return <>
    {trigger({
      onClick: e => { e.stopPropagation(); e.preventDefault(); if (anchor) { close(); return } const el = e.currentTarget; anchorEl.current = el; setAnchor(el.getBoundingClientRect()) },
      'aria-expanded': Boolean(anchor), 'aria-haspopup': 'menu',
    })}
    {anchor && createPortal(
      <div className="menu" role="menu" aria-label={label} ref={menuRef} style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }} onClick={e => e.stopPropagation()}>
        {items.map((item, i) => {
          if (item === 'sep') return <div key={i} className="sep" />
          if ('section' in item) return <div key={i} className="menu-label">{item.section}</div>
          const body = <>{item.icon}<span className="grow">{item.label}</span>{item.hint}{item.checked && <Check size={16} className="check-mark" />}</>
          if (item.href) return <a key={i} role="menuitem" href={item.href} className={item.danger ? 'danger' : ''} onClick={() => close()}>{body}</a>
          return <button key={i} type="button" role="menuitem" disabled={item.disabled} className={item.danger ? 'danger' : ''} onClick={() => { close(); item.onSelect?.() }}>{body}</button>
        })}
      </div>,
      document.body,
    )}
  </>
}

/* ---------------- Little display pieces ---------------- */

export function StageChip({ stage, hold, label }: { stage: Stage | 'client_changes'; hold?: boolean; label?: string }) {
  const text = label ?? (stage === 'client_changes' ? 'Client changes' : STAGE_LABEL[stage])
  return <span className="stage-chip" data-stage={hold ? 'hold' : stage}><span className="dot" />{text}</span>
}

export function DueText({ date, done, prefix }: { date: string | null | undefined; done?: boolean; prefix?: string }) {
  if (!date) return null
  const d = daysUntil(date)!
  if (done) return <span className="due"><Check size={13} /> {fmtDate(date)}</span>
  const tone = d < 0 ? 'overdue' : d === 0 ? 'today' : d <= 3 ? 'soon' : ''
  const text = d < 0 ? (d === -1 ? 'Yesterday' : `${-d} days late`) : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 7 ? fmtWeekday(date) : fmtDate(date)
  return <span className={`due ${tone}`} title={fmtDate(date, 'long')}>{d < 0 && <AlertTriangle size={13} />}{prefix}{text}</span>
}

function fmtWeekday(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'long' })
}

export function Progress({ value, max, tone, size }: { value: number; max: number; tone?: 'ok' | 'warn' | 'over'; size?: 'lg' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : value > 0 ? 100 : 0
  const auto = max > 0 && value > max ? 'over' : tone
  return <div className={`progress ${auto ?? ''} ${size ?? ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
}

export function Avatar({ name, color, size }: { name: string; color?: string; size?: 'lg' }) {
  return <span className={`avatar ${size ?? ''}`} style={color ? { background: color } : undefined} aria-hidden="true">{initials(name)}</span>
}

export function TaskCheck({ done, onToggle, label, big }: { done: boolean; onToggle: () => void; label: string; big?: boolean }) {
  return <button type="button" className={`task-check ${done ? 'done' : ''} ${big ? 'big' : ''}`} aria-pressed={done} aria-label={done ? `Mark "${label}" not done` : `Mark "${label}" done`} onClick={e => { e.stopPropagation(); e.preventDefault(); onToggle() }}>
    <Check size={big ? 15 : 13} strokeWidth={3} />
  </button>
}

export function Empty({ icon, title, children, action, compact }: { icon?: ReactNode; title?: ReactNode; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return <div className={`empty ${compact ? 'compact' : ''}`}>
    <div className="empty-icon">{icon ?? <Inbox size={22} />}</div>
    <div className="stack tight" style={{ alignItems: compact ? 'flex-start' : 'center' }}>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </div>
  </div>
}

export function Segmented<T extends string>({ value, options, onChange, size, label }: { value: T; options: { value: T; label: ReactNode; icon?: ReactNode }[]; onChange: (v: T) => void; size?: 'sm'; label?: string }) {
  return <div className={`seg ${size ?? ''}`} role="group" aria-label={label}>
    {options.map(o => <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.icon}{o.label}</button>)}
  </div>
}

/** A <select> styled like the rest of the app. */
export function Select({ value, onChange, children, className, ...rest }: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & { onChange: (v: string) => void }) {
  return <select className={`input ${className ?? ''}`} value={value} onChange={e => onChange(e.target.value)} {...rest}>{children}</select>
}

export function Field({ label, hint, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return <div className={`field ${className ?? ''}`}>
    <label htmlFor={htmlFor}>{label}</label>
    {children}
    {hint && <span className="hint">{hint}</span>}
  </div>
}

/** Number input that keeps what was typed (including blanks) until it is valid. */
export function NumberInput({ value, onChange, step = 'any', min, placeholder, id, className, autoFocus, prefix, suffix, ariaLabel, disabled }: {
  value: number | null; onChange: (v: number | null) => void; step?: number | 'any'; min?: number; placeholder?: string; id?: string; className?: string; autoFocus?: boolean; prefix?: string; suffix?: string; ariaLabel?: string; disabled?: boolean
}) {
  const parse = (t: string) => { const n = t.trim() === '' ? null : Number(t); return n != null && Number.isFinite(n) ? n : null }
  const [text, setText] = useState(value == null ? '' : String(value))
  const [seen, setSeen] = useState(value)
  // A new value from outside (e.g. a quick-fill button) replaces the text.
  if (value !== seen) { setSeen(value); if (parse(text) !== value) setText(value == null ? '' : String(value)) }
  const input = <input id={id} className={`input ${className ?? ''}`} inputMode="decimal" type="number" step={step} min={min} placeholder={placeholder} autoFocus={autoFocus} aria-label={ariaLabel} disabled={disabled}
    value={text} onChange={e => { const t = e.target.value; setText(t); const n = parse(t); setSeen(n); onChange(n) }} />
  if (!prefix && !suffix) return input
  return <div className="input-wrap">{prefix && <span className="prefix">{prefix}</span>}{input}{suffix && <span className="suffix">{suffix}</span>}</div>
}

export function ChevronSelect({ children }: { children: ReactNode }) {
  return <span className="row" style={{ gap: 4 }}>{children}<ChevronDown size={14} /></span>
}

export function DateText({ iso, icon }: { iso: string | null | undefined; icon?: boolean }) {
  if (!iso) return <span className="muted">—</span>
  return <span className="row" style={{ gap: 5, display: 'inline-flex' }}>{icon && <CalendarClock size={14} className="muted" />}{fmtDate(iso)}</span>
}
