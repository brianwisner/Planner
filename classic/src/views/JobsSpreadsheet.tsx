import { useId, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useData } from '../lib/store'
import type { JobOverview } from '../lib/jobs'
import { JOB_STATUS_LABEL, PHASE_KIND_SHORT, PHASE_STATUS_LABEL, type Job, type JobStatus } from '../lib/types'
import { downloadCSV, fmtDate, fmtHours, fmtHourlyRate } from '../lib/utils'
import { Icon, JobStatusSelect } from '../components/ui'
import './JobsSpreadsheet.css'

type ColumnKey = 'job' | 'number' | 'client' | 'status' | 'phase' | 'due' | 'worked' | 'estimate' | 'nonbillable' | 'ready' | 'unpaid' | 'balance' | 'rate' | 'priority' | 'completed' | 'billable' | 'fees' | 'recordedDue'
type Column = { key: ColumnKey; label: string; value: (row: JobOverview) => string | number | null; numeric?: boolean; money?: boolean; hidden?: boolean }
const RATE_BASIS = 'Recorded deposits and invoices counted once, less funded separate charges, divided by all completed hours including nonbillable time. Includes unused deposits; before overhead and tax. Running timers are excluded until stopped.'
const BALANCE_BASIS = 'Deposits plus invoices minus all work value, including nonbillable time and separate charges.'
const COLUMNS: Column[] = [
  { key: 'job', label: 'Job', value: row => row.job.name },
  { key: 'number', label: 'Job #', value: row => row.job.job_number },
  { key: 'client', label: 'Client', value: row => row.clientName },
  { key: 'status', label: 'Status', value: row => JOB_STATUS_LABEL[row.job.status] },
  { key: 'phase', label: 'Current phase', value: row => row.currentPhase ? PHASE_KIND_SHORT[row.currentPhase.kind] : null },
  { key: 'due', label: 'Next due', value: row => row.nextDeadline?.date ?? null },
  { key: 'worked', label: 'Worked hours', value: row => row.actualHours, numeric: true },
  { key: 'estimate', label: 'Estimate hours', value: row => row.estimatedHours, numeric: true },
  { key: 'nonbillable', label: 'Nonbillable hours', value: row => row.nonBillableHours, numeric: true },
  { key: 'ready', label: 'Ready to bill', value: row => row.billing.unbilledAmount, numeric: true, money: true },
  { key: 'unpaid', label: 'Awaiting payment', value: row => row.billing.outstanding, numeric: true, money: true },
  { key: 'balance', label: 'Balance', value: row => row.billing.balance, numeric: true, money: true },
  { key: 'rate', label: 'Effective rate', value: row => row.billing.effectiveHourlyRate, numeric: true, money: true },
  { key: 'priority', label: 'Priority', value: row => row.job.priority, numeric: true, hidden: true },
  { key: 'completed', label: 'Completed hours', value: row => row.completedHours, numeric: true, hidden: true },
  { key: 'billable', label: 'Billable hours', value: row => row.billableHours, numeric: true, hidden: true },
  { key: 'fees', label: 'Fees recorded', value: row => row.billing.feeRevenue, numeric: true, money: true, hidden: true },
  { key: 'recordedDue', label: 'Job due (recorded)', value: row => row.job.due_date, hidden: true },
]
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

function compareValues(a: string | number | null, b: string | number | null, ascending: boolean) {
  // Undated and unavailable values stay last in either direction.
  if (a == null || a === '') return b == null || b === '' ? 0 : 1
  if (b == null || b === '') return -1
  const difference = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'en', { numeric: true })
  return ascending ? difference : -difference
}

function exportValue(column: Column, row: JobOverview): string | number {
  const value = column.value(row)
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? column.money ? value.toFixed(2) : Number(value.toFixed(2)) : ''
  // Spreadsheet programs can execute formulas even when CSV cells are quoted.
  const text = value.replace(/\r\n?/g, '\n')
  return /^[\s]*[=+\-@]|^[\t\r\n]/.test(text) ? `'${text}` : text
}

export function JobsSpreadsheet({ rows, onEditJob }: { rows: JobOverview[]; onEditJob?: (job: Job) => void }) {
  const helpId = useId()
  const [visible, setVisible] = useState(() => new Set(COLUMNS.filter(column => !column.hidden).map(column => column.key)))
  const [sort, setSort] = useState<ColumnKey>('priority')
  const [ascending, setAscending] = useState(true)
  const shown = COLUMNS.filter(column => visible.has(column.key))
  const sorted = useMemo(() => {
    const column = COLUMNS.find(column => column.key === sort)!
    return [...rows].sort((a, b) => compareValues(column.value(a), column.value(b), ascending) || a.job.priority - b.job.priority || a.job.id.localeCompare(b.job.id))
  }, [rows, sort, ascending])
  function changeSort(key: ColumnKey) {
    if (key === sort) setAscending(value => !value)
    else { setSort(key); setAscending(true) }
  }
  function toggleColumn(key: ColumnKey) {
    setVisible(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  }
  function exportRows() {
    downloadCSV('jobs-spreadsheet.csv', shown.map(column => column.label), sorted.map(row => shown.map(column => exportValue(column, row))))
  }

  return <section className="jobs-spreadsheet" aria-label="Spreadsheet view">
    <div className="jobs-spreadsheet-toolbar">
      <label className="jobs-spreadsheet-sort">Sort by <select aria-label="Sort spreadsheet" value={sort} onChange={event => setSort(event.target.value as ColumnKey)}>{COLUMNS.map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label>
      <button type="button" className="btn sm" aria-label={`Sort direction: ${ascending ? 'ascending' : 'descending'}`} onClick={() => setAscending(value => !value)}><span aria-hidden="true">{ascending ? '↑' : '↓'}</span> {ascending ? 'Ascending' : 'Descending'}</button>
      <details className="jobs-spreadsheet-columns"><summary>Columns</summary><div className="jobs-spreadsheet-column-list">{COLUMNS.map(column => <label key={column.key}><input type="checkbox" checked={visible.has(column.key)} disabled={column.key === 'job'} onChange={() => toggleColumn(column.key)} />{column.label}</label>)}<button type="button" className="btn sm" onClick={() => setVisible(new Set(COLUMNS.filter(column => !column.hidden).map(column => column.key)))}>Reset columns</button></div></details>
      <span className="jobs-spreadsheet-count">{rows.length} job{rows.length === 1 ? '' : 's'}</span>
      <button type="button" className="btn sm" disabled={!rows.length} onClick={exportRows}><Icon name="download" size={14} /> Export CSV</button>
    </div>
    <p id={helpId} className="jobs-spreadsheet-help">Scroll across for all columns. Worked hours include running timers; nonbillable hours and the effective rate use completed time. CSV includes every filtered job and the shown columns.</p>
    <div className="jobs-spreadsheet-scroll" role="region" aria-label="Jobs spreadsheet" aria-describedby={helpId} tabIndex={0}>
      <table className="jobs-spreadsheet-table">
        <caption className="jobs-spreadsheet-caption">Jobs in the current selection. Select a column heading to sort.</caption>
        <thead><tr>{shown.map(column => <th key={column.key} scope="col" className={`${column.key === 'job' ? 'jobs-spreadsheet-identity' : ''} ${column.numeric ? 'num' : ''}`} aria-sort={column.key === sort ? ascending ? 'ascending' : 'descending' : 'none'} title={column.key === 'rate' || column.key === 'fees' ? RATE_BASIS : column.key === 'balance' ? BALANCE_BASIS : undefined}><button type="button" onClick={() => changeSort(column.key)} aria-label={`Sort by ${column.label.toLowerCase()}`}>{column.label}{column.key === sort && <span aria-hidden="true"> {ascending ? '↑' : '↓'}</span>}</button></th>)}{onEditJob && <th scope="col" className="jobs-spreadsheet-actions">Edit</th>}</tr></thead>
        <tbody>{sorted.map(row => <tr key={row.job.id}>{shown.map(column => column.key === 'job' ? <th key={column.key} scope="row" className="jobs-spreadsheet-identity"><Link to={`/jobs/${row.job.id}`} title={row.job.name}>{row.job.name}</Link></th> : <td key={column.key} className={`${column.numeric ? 'num' : ''} jobs-spreadsheet-${column.key}`}>{cell(column.key, row)}</td>)}{onEditJob && <td className="jobs-spreadsheet-actions"><button type="button" className="btn sm icon" onClick={() => onEditJob(row.job)} aria-label={`Edit job: ${row.job.name}`}><Icon name="edit" size={15} /></button></td>}</tr>)}{!rows.length && <tr><td colSpan={shown.length + (onEditJob ? 1 : 0)} className="jobs-spreadsheet-empty">No jobs match this selection.</td></tr>}</tbody>
      </table>
    </div>
    <details className="jobs-spreadsheet-basis"><summary>About the money columns</summary><p><strong>Effective rate:</strong> {RATE_BASIS}</p><p><strong>Balance:</strong> {BALANCE_BASIS} The money columns keep each job’s full billing history.</p></details>
  </section>
}

function cell(key: ColumnKey, row: JobOverview) {
  const billingLink = `/billing?job=${row.job.id}`
  switch (key) {
    case 'number': return row.job.job_number || <span className="muted">—</span>
    case 'client': return row.clientName ? <Link to={`/clients/${row.job.client_id}`} title={row.clientName}>{row.clientName}</Link> : <span className="muted">Unavailable client</span>
    case 'status': return <SpreadsheetStatus job={row.job} />
    case 'phase': return row.currentPhase ? <span title={`${row.currentPhase.name} · ${PHASE_STATUS_LABEL[row.currentPhase.status]}`}>{PHASE_KIND_SHORT[row.currentPhase.kind]}<span className="jobs-spreadsheet-phase-state"> · {PHASE_STATUS_LABEL[row.currentPhase.status]}</span></span> : <span className="muted">—</span>
    case 'due': return row.nextDeadline ? <Link to={row.nextDeadline.link} title={row.nextDeadline.title} aria-label={`${row.nextDeadline.title}, ${fmtDate(row.nextDeadline.date, 'long')}`}><time dateTime={row.nextDeadline.date}>{fmtDate(row.nextDeadline.date)}</time></Link> : <span className="muted">—</span>
    case 'worked': return <span title={`${fmtHours(row.completedHours)} completed${row.runningCount ? `; includes ${row.runningCount} running timer${row.runningCount === 1 ? '' : 's'}` : ''}`}>{fmtHours(row.actualHours)}{row.runningCount > 0 && <span className="jobs-spreadsheet-running" aria-label="Includes running timer"> ◷</span>}</span>
    case 'estimate': return fmtHours(row.estimatedHours)
    case 'nonbillable': return fmtHours(row.nonBillableHours)
    case 'completed': return fmtHours(row.completedHours)
    case 'billable': return fmtHours(row.billableHours)
    case 'ready': return <Link to={billingLink}>{money(row.billing.unbilledAmount)}</Link>
    case 'unpaid': return <Link to={billingLink}>{money(row.billing.outstanding)}</Link>
    case 'fees': return <Link to={billingLink} title={RATE_BASIS}>{money(row.billing.feeRevenue)}</Link>
    case 'balance': return <Link to={billingLink} title={BALANCE_BASIS}>{row.billing.balance > 0 ? '+' : ''}{money(row.billing.balance)}</Link>
    case 'rate': return <Link to={billingLink} title={RATE_BASIS}>{fmtHourlyRate(row.billing.effectiveHourlyRate)}</Link>
    case 'priority': return row.job.priority
    case 'recordedDue': return row.job.due_date ? <time dateTime={row.job.due_date}>{fmtDate(row.job.due_date)}</time> : <span className="muted">—</span>
    default: return null
  }
}

function SpreadsheetStatus({ job }: { job: Job }) {
  const { update, refresh, toast } = useData()
  const busy = useRef(false)
  async function save(status: JobStatus) {
    if (busy.current) return
    busy.current = true
    try {
      let saved = false
      try { saved = await update('jobs', job.id, { status }) } catch { /* Refresh before reporting an unconfirmed save. */ }
      if (!saved) {
        try { await refresh('jobs') } catch { /* The store also reports a refresh failure. */ }
        toast('Could not confirm the job status. Jobs were refreshed; check the status before retrying.', 'error')
      }
    } finally { busy.current = false }
  }
  return <JobStatusSelect value={job.status} label={`Status for ${job.name}`} onChange={save} />
}
