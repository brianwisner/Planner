// Two small charts for job money:
//  - WorkStatusBar: the value of all hours worked, split into paid / billed-not-paid /
//    not billed, plus any deposit money not yet worked against.
//  - BalanceChart: the job balance over time (deposits + billed − work). It steps down
//    as hours are logged and jumps up when a deposit arrives or an invoice goes out.
// Colors use the fixed status palette (good / warning / critical) and always come
// with a text label, so color is never the only cue.
import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { BalancePoint, JobBilling } from '../lib/calc'
import { fmtMoney, fmtSigned, todayISO } from '../lib/utils'

export const STATUS_COLOR = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' }

interface Segment { key: string; label: string; value: number; color: string; dashed?: boolean }

export function WorkStatusBar({ b, compact }: { b: JobBilling; compact?: boolean }) {
  const [hover, setHover] = useState<string | null>(null)
  const segs: Segment[] = [
    { key: 'paid', label: 'Paid', value: b.paidAmount, color: STATUS_COLOR.good },
    { key: 'billed', label: 'Billed, waiting for payment', value: b.waitingAmount, color: STATUS_COLOR.warning },
    { key: 'unbilled', label: 'Not billed yet', value: b.unbilledAmount, color: STATUS_COLOR.critical },
    { key: 'ahead', label: 'Deposit not used yet', value: b.depositRemaining, color: STATUS_COLOR.good, dashed: true },
  ]
  const total = sum(segs.map(s => s.value))
  if (total <= 0.5) return <div className="small muted">No hours or deposits yet.</div>
  const shown = segs.filter(s => s.value > 0.5)
  return (
    <div className="wsb">
      <div className="wsb-bar" role="img" aria-label={shown.map(s => `${s.label} ${fmtMoney(s.value)}`).join(', ')}>
        {shown.map(s => (
          <div key={s.key} className={`wsb-seg ${s.dashed ? 'dashed' : ''} ${hover && hover !== s.key ? 'dim' : ''}`}
            style={{ flexGrow: s.value, background: s.dashed ? 'transparent' : s.color, borderColor: s.color }}
            onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)} onClick={() => setHover(h => h === s.key ? null : s.key)}>
            {hover === s.key && <div className="chart-tip">{s.label}<b>{fmtMoney(s.value)}</b><span>{Math.round(s.value / total * 100)}%</span></div>}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="wsb-legend">
          {segs.map(s => (
            <span key={s.key} className={`wsb-key ${s.value <= 0.5 ? 'zero' : ''}`} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
              <i style={{ background: s.dashed ? 'transparent' : s.color, borderColor: s.color }} className={s.dashed ? 'dashed' : ''} />
              {s.label} <b>{fmtMoney(s.value)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function BalanceChart({ points }: { points: BalancePoint[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hi, setHi] = useState<number | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Extend the line to today so a run of unbilled work is visible.
  const pts = useMemo(() => {
    const t = todayISO()
    const last = points[points.length - 1]
    if (last && last.date < t) return [...points, { date: t, balance: last.balance, work: 0, deposits: 0, billed: 0, notes: ['Today'] }]
    return points
  }, [points])

  if (pts.length === 0) return <div className="small muted">Nothing logged yet. The balance line starts with the first deposit, invoice, or hour.</div>

  const H = 190, padL = 56, padR = 12, padT = 12, padB = 26
  const x0 = parseISO(pts[0].date).getTime()
  const x1 = Math.max(parseISO(pts[pts.length - 1].date).getTime(), x0 + 86400000)
  const vals = pts.map(p => p.balance).concat(0)
  const lo = Math.min(...vals), hiV = Math.max(...vals)
  const span = Math.max(1, hiV - lo)
  const yMin = lo - span * 0.08, yMax = hiV + span * 0.08
  const X = (d: string) => padL + ((parseISO(d).getTime() - x0) / (x1 - x0)) * (w - padL - padR)
  const Y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB)
  const zeroY = Y(0)

  // Step-after path: the balance holds until the next event.
  let line = `M${X(pts[0].date)},${Y(0)} L${X(pts[0].date)},${Y(pts[0].balance)}`
  for (let i = 1; i < pts.length; i++) line += ` L${X(pts[i].date)},${Y(pts[i - 1].balance)} L${X(pts[i].date)},${Y(pts[i].balance)}`
  const area = `${line} L${X(pts[pts.length - 1].date)},${zeroY} Z`

  const ticks = niceTicks(yMin, yMax, 4)
  const months: { x: number; label: string }[] = [{ x: padL, label: format(new Date(x0), 'MMM d') }]
  const start = new Date(x0); start.setDate(1); start.setMonth(start.getMonth() + 1)
  for (let d = start; d.getTime() <= x1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push({ x: padL + ((d.getTime() - x0) / (x1 - x0)) * (w - padL - padR), label: format(d, 'MMM') })

  function onMove(clientX: number) {
    const r = wrap.current!.getBoundingClientRect()
    const px = clientX - r.left
    let best = 0, bd = Infinity
    pts.forEach((p, i) => { const d = Math.abs(X(p.date) - px); if (d < bd) { bd = d; best = i } })
    setHi(best)
  }
  const h = hi != null ? pts[hi] : null

  return (
    <div className="bal" ref={wrap} onMouseMove={e => onMove(e.clientX)} onMouseLeave={() => setHi(null)} onTouchStart={e => onMove(e.touches[0].clientX)} onTouchMove={e => onMove(e.touches[0].clientX)}>
      <svg width={w} height={H} role="img" aria-label={`Job balance over time, now ${fmtSigned(pts[pts.length - 1].balance)}`}>
        <defs>
          <clipPath id="bal-above"><rect x={0} y={0} width={w} height={Math.max(0, zeroY)} /></clipPath>
          <clipPath id="bal-below"><rect x={0} y={zeroY} width={w} height={Math.max(0, H - zeroY)} /></clipPath>
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} className="bal-grid" />
            <text x={padL - 8} y={Y(t) + 4} className="bal-axis" textAnchor="end">{shortMoney(t)}</text>
          </g>
        ))}
        {months.filter((m, i) => i === 0 || m.x - padL > 48).map((m, i) => <text key={m.x} x={m.x} y={H - 8} className="bal-axis" textAnchor={i === 0 ? 'start' : 'middle'}>{m.label}</text>)}
        <path d={area} fill={STATUS_COLOR.good} opacity={0.14} clipPath="url(#bal-above)" />
        <path d={area} fill={STATUS_COLOR.critical} opacity={0.14} clipPath="url(#bal-below)" />
        <line x1={padL} x2={w - padR} y1={zeroY} y2={zeroY} className="bal-zero" />
        <path d={line} fill="none" stroke="#2a78d6" strokeWidth={2} strokeLinejoin="round" />
        {pts.map((p, i) => (p.deposits > 0 || p.billed > 0) && (
          <circle key={i} cx={X(p.date)} cy={Y(p.balance)} r={5} fill={p.deposits > 0 ? STATUS_COLOR.good : '#2a78d6'} stroke="#fff" strokeWidth={2} />
        ))}
        {h && <>
          <line x1={X(h.date)} x2={X(h.date)} y1={padT} y2={H - padB} className="bal-cross" />
          <circle cx={X(h.date)} cy={Y(h.balance)} r={5} fill="#2a78d6" stroke="#fff" strokeWidth={2} />
        </>}
      </svg>
      {h && (
        <div className="chart-tip bal-tip" style={{ left: Math.min(Math.max(X(h.date), 90), w - 90) }}>
          <span>{format(parseISO(h.date), 'EEE, MMM d')}</span>
          <b className={h.balance < 0 ? 'danger-text' : 'ok-text'}>{fmtSigned(h.balance)}</b>
          {h.work > 0 && <span>Work logged: −{fmtMoney(h.work)}</span>}
          {h.notes.filter(n => n !== 'Today').map(n => <span key={n}>{n}</span>)}
        </div>
      )}
      <div className="bal-legend small muted">
        <span><i className="dot" style={{ background: '#2a78d6' }} /> Job balance</span>
        <span><i className="dot" style={{ background: STATUS_COLOR.good }} /> Deposit received</span>
        <span><i className="dot ring" style={{ background: '#2a78d6' }} /> Invoice sent</span>
        <span>Below the line = work you haven't been paid or billed for</span>
      </div>
    </div>
  )
}

function sum(n: number[]) { return n.reduce((a, b) => a + b, 0) }

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(Math.round(v))
  return out
}

function shortMoney(n: number) {
  const a = Math.abs(n)
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : `$${Math.round(a)}`
  return n < 0 ? `−${s}` : s
}
