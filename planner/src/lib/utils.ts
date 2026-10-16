import { addDays, addMonths, addWeeks, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns'
import type { Recurrence } from './types'

export const todayISO = () => format(new Date(), 'yyyy-MM-dd')

export function fmtDate(iso: string | null | undefined, style: 'short' | 'long' = 'short'): string {
  if (!iso) return ''
  const d = iso.length > 10 ? new Date(iso) : parseISO(iso)
  return format(d, style === 'short' ? 'MMM d' : 'EEE, MMM d, yyyy')
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return format(new Date(iso), 'EEE, MMM d · h:mm a')
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null) return '–'
  const r = Math.round(h * 4) / 4 // quarter hours
  return Number.isInteger(r) ? `${r}h` : `${r.toFixed(r * 10 % 1 === 0 ? 1 : 2)}h`
}

/** Money with an explicit sign, e.g. +$1,200 or −$350 (for balances). */
export function fmtSigned(n: number): string {
  const r = Math.round(n)
  if (r === 0) return '$0'
  return (r > 0 ? '+' : '−') + fmtMoney(Math.abs(r))
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '–'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

/** Days from today to the given date. Negative = overdue. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  return differenceInCalendarDays(parseISO(iso.slice(0, 10)), startOfDay(new Date()))
}

export function dueLabel(iso: string | null | undefined): { text: string; tone: 'overdue' | 'soon' | 'ok' | 'none' } {
  const d = daysUntil(iso)
  if (d == null) return { text: 'No date', tone: 'none' }
  if (d < 0) return { text: `${-d}d overdue`, tone: 'overdue' }
  if (d === 0) return { text: 'Due today', tone: 'soon' }
  if (d === 1) return { text: 'Due tomorrow', tone: 'soon' }
  if (d <= 7) return { text: `Due in ${d}d`, tone: 'soon' }
  return { text: fmtDate(iso), tone: 'ok' }
}

export function nextOccurrence(iso: string, recurrence: Recurrence): string | null {
  const d = parseISO(iso)
  switch (recurrence) {
    case 'daily': return format(addDays(d, 1), 'yyyy-MM-dd')
    case 'weekly': return format(addWeeks(d, 1), 'yyyy-MM-dd')
    case 'biweekly': return format(addWeeks(d, 2), 'yyyy-MM-dd')
    case 'monthly': return format(addMonths(d, 1), 'yyyy-MM-dd')
    default: return null
  }
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]!.toUpperCase()).join('') || '?'
}

/** Build a CSV file from rows and trigger a download in the browser. */
export function downloadCSV(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n')
  downloadText(filename, text, 'text/csv')
}

export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function sum(nums: (number | null | undefined)[]): number {
  return nums.reduce<number>((a, b) => a + (b ?? 0), 0)
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

export function isMac() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}
