// Clients: everyone you work for, with their open jobs and money at a glance.
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Download, LayoutGrid, List, Mail, Phone, Plus, Search } from 'lucide-react'
import { useData } from '../lib/store'
import { EMAIL_TARGET, useEmailLink } from '../lib/email'
import { useEditors } from '../components/editors'
import { Avatar, Empty, Segmented, StageChip } from '../components/ui'
import { jobBilling } from '../lib/calc'
import { jobStage, type Stage } from '../lib/stages'
import { pref, setPref } from '../lib/theme'
import type { Client, Job } from '../lib/types'
import { downloadCSV, fmtMoney, sum } from '../lib/utils'
import './clients.css'

type Sort = 'name' | 'open' | 'bill' | 'recent'
type Layout = 'cards' | 'list'

const PALETTE = ['#2f5bea', '#0b8a7e', '#7a3fe4', '#d97a06', '#cf2f7d', '#12813f', '#e35a12', '#0e7490']

/** A steady color per client, so the same client always looks the same. */
/** Initials from the words of a name, skipping symbols like “&”. */
const avatarName = (name: string) => name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || name

function avatarColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

interface ClientRow {
  client: Client
  jobs: Job[]
  open: Job[]
  stages: { job: Job; stage: Stage; hold: boolean }[]
  toBill: number
  awaiting: number
}

export function Clients() {
  const store = useData()
  const edit = useEditors()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const sort = (['name', 'open', 'bill', 'recent'].includes(params.get('sort') ?? '') ? params.get('sort') : 'name') as Sort
  const layout = (params.get('layout') === 'list' || params.get('layout') === 'cards' ? params.get('layout') : pref<Layout>('clients.layout', 'cards')) as Layout
  const patch = (next: Record<string, string | null>) => setParams(p => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(next)) { if (v == null || v === '') n.delete(k); else n.set(k, v) }
    return n
  }, { replace: true })
  const setLayout = (v: Layout) => { setPref('clients.layout', v); patch({ layout: v }) }

  const all = useMemo<ClientRow[]>(() => store.clients.map(client => {
    const jobs = store.jobs.filter(j => j.client_id === client.id)
    const open = jobs.filter(j => j.status === 'active' || j.status === 'on_hold').sort((a, b) => a.priority - b.priority)
    const money = jobs.filter(j => j.status !== 'archived').map(j => jobBilling(store, j))
    return {
      client, jobs, open,
      stages: open.map(job => ({ job, stage: jobStage(store.phases, job.id).stage, hold: job.status === 'on_hold' })),
      toBill: sum(money.map(m => m.unbilledAmount)),
      awaiting: sum(money.map(m => m.outstanding)),
    }
  }), [store])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = (r: ClientRow) => !needle || [r.client.name, r.client.contact_name, r.client.email, r.client.phone, r.client.address, ...r.jobs.map(j => j.name), ...r.jobs.map(j => j.job_number)]
      .some(v => v?.toLowerCase().includes(needle))
    const list = all.filter(match)
    switch (sort) {
      case 'open': return list.sort((a, b) => b.open.length - a.open.length || a.client.name.localeCompare(b.client.name))
      case 'bill': return list.sort((a, b) => b.toBill - a.toBill || a.client.name.localeCompare(b.client.name))
      case 'recent': return list.sort((a, b) => b.client.created_at.localeCompare(a.client.created_at))
      default: return list.sort((a, b) => a.client.name.localeCompare(b.client.name))
    }
  }, [all, q, sort])

  const withOpen = all.filter(r => r.open.length).length

  function exportCsv() {
    downloadCSV('clients.csv', ['Client', 'Contact', 'Email', 'Phone', 'Address', 'Open jobs', 'All jobs', 'Ready to bill', 'Awaiting payment', 'Notes'],
      rows.map(r => [r.client.name, r.client.contact_name, r.client.email, r.client.phone, r.client.address, r.open.length, r.jobs.length, Math.round(r.toBill), Math.round(r.awaiting), r.client.notes]))
  }

  return <div className="clients-page">
    <div className="page-head">
      <div className="titles">
        <h1>Clients</h1>
        <p className="lede">{store.clients.length} client{store.clients.length === 1 ? '' : 's'} · {withOpen} with open jobs</p>
      </div>
      <div className="actions">
        <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ value: 'cards', label: 'Cards', icon: <LayoutGrid size={15} /> }, { value: 'list', label: 'List', icon: <List size={15} /> }]} />
        <button className="btn primary" onClick={() => edit.client(undefined, c => navigate(`/clients/${c.id}`))}><Plus size={16} /> New client</button>
      </div>
    </div>

    {store.clients.length > 0 && <div className="toolbar">
      <div className="input-wrap grow" style={{ maxWidth: 380 }}>
        <Search size={16} />
        <input className="input" value={q} onChange={e => patch({ q: e.target.value })} placeholder="Search name, contact, phone, job…" aria-label="Search clients" />
      </div>
      <select className="input" style={{ width: 'auto' }} value={sort} onChange={e => patch({ sort: e.target.value === 'name' ? null : e.target.value })} aria-label="Sort clients">
        <option value="name">Sort: Name</option>
        <option value="open">Sort: Most open jobs</option>
        <option value="bill">Sort: Most to bill</option>
        <option value="recent">Sort: Recently added</option>
      </select>
      <div className="grow hide-sm" />
      <button className="btn" onClick={exportCsv} disabled={!rows.length}><Download size={15} /> CSV</button>
    </div>}

    {store.clients.length === 0
      ? <div className="card"><Empty icon={<Building2 size={22} />} title="No clients yet" action={<button className="btn primary" onClick={() => edit.client(undefined, c => navigate(`/clients/${c.id}`))}><Plus size={16} /> Add your first client</button>}>Add the architects, builders and homeowners you work for. Their jobs, contact details and billing collect here.</Empty></div>
      : rows.length === 0
        ? <div className="card"><Empty icon={<Search size={22} />} title="No clients match" action={<button className="btn" onClick={() => patch({ q: null })}>Clear search</button>}>Nothing matches “{q}”.</Empty></div>
        : layout === 'cards'
          ? <div className="client-grid">{rows.map(r => <ClientCard key={r.client.id} row={r} />)}</div>
          : <ClientTable rows={rows} />}
  </div>
}

function ClientCard({ row }: { row: ClientRow }) {
  const navigate = useNavigate()
  const emailLink = useEmailLink()
  const { client, open, stages, toBill, awaiting, jobs } = row
  const shown = stages.slice(0, 3)
  return <article className="card client-card" onClick={() => navigate(`/clients/${client.id}`)}>
    <div className="client-card-top">
      <Avatar name={avatarName(client.name)} color={avatarColor(client.name)} />
      <div className="grow" style={{ minWidth: 0 }}>
        <Link to={`/clients/${client.id}`} className="client-card-name truncate" onClick={e => e.stopPropagation()}>{client.name}</Link>
        <div className="small muted truncate">{client.contact_name || (client.email ? client.email : 'No contact person')}</div>
      </div>
    </div>
    <div className="client-card-jobs">
      {open.length
        ? <><span className="small strong">{open.length} open job{open.length === 1 ? '' : 's'}</span>
          <div className="client-card-chips">
            {shown.map(s => <StageChip key={s.job.id} stage={s.stage} hold={s.hold} label={s.hold ? 'On hold' : undefined} />)}
            {stages.length > shown.length && <span className="badge">+{stages.length - shown.length}</span>}
          </div></>
        : <span className="small muted">{jobs.length ? `No open jobs · ${jobs.length} past` : 'No jobs yet'}</span>}
    </div>
    {(toBill > 0.5 || awaiting > 0.5) && <div className="client-card-money">
      {toBill > 0.5 && <span className="badge ok">{fmtMoney(toBill)} to bill</span>}
      {awaiting > 0.5 && <span className="badge warn">{fmtMoney(awaiting)} awaiting payment</span>}
    </div>}
    <div className="client-card-actions" onClick={e => e.stopPropagation()}>
      {client.phone ? <a className="btn sm" href={`tel:${client.phone}`} aria-label={`Call ${client.name}`}><Phone size={14} />Call</a> : <span className="btn sm" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: 'none' }}><Phone size={14} />Call</span>}
      {client.email ? <a className="btn sm" href={emailLink(client.email)} {...EMAIL_TARGET} aria-label={`Email ${client.name}`} onClick={e => e.stopPropagation()}><Mail size={14} />Email</a> : <span className="btn sm" aria-disabled="true" style={{ opacity: 0.45, pointerEvents: 'none' }}><Mail size={14} />Email</span>}
      {client.phone && <span className="tiny muted truncate hide-sm" style={{ marginLeft: 'auto' }}>{client.phone}</span>}
    </div>
  </article>
}

function ClientTable({ rows }: { rows: ClientRow[] }) {
  const navigate = useNavigate()
  const emailLink = useEmailLink()
  return <div className="card">
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Client</th><th className="hide-sm">Contact</th><th className="hide-sm">Phone</th><th className="num">Open jobs</th><th className="num hide-sm">To bill</th><th className="num hide-sm">Awaiting</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.client.id} className="clickable" onClick={() => navigate(`/clients/${r.client.id}`)}>
        <td><div className="row" style={{ gap: 10 }}><Avatar name={avatarName(r.client.name)} color={avatarColor(r.client.name)} /><div style={{ minWidth: 0 }}><Link to={`/clients/${r.client.id}`} className="strong" style={{ color: 'var(--text)' }} onClick={e => e.stopPropagation()}>{r.client.name}</Link><div className="tiny muted show-sm">{r.client.contact_name}</div></div></div></td>
        <td className="hide-sm small">{r.client.contact_name || <span className="muted">—</span>}{r.client.email && <div className="tiny muted"><a href={emailLink(r.client.email)} {...EMAIL_TARGET} onClick={e => e.stopPropagation()}>{r.client.email}</a></div>}</td>
        <td className="hide-sm small nowrap">{r.client.phone ? <a href={`tel:${r.client.phone}`} onClick={e => e.stopPropagation()}>{r.client.phone}</a> : <span className="muted">—</span>}</td>
        <td className="num strong">{r.open.length || <span className="muted">0</span>}</td>
        <td className="num hide-sm">{r.toBill > 0.5 ? <span className="ok-text strong">{fmtMoney(r.toBill)}</span> : <span className="muted">—</span>}</td>
        <td className="num hide-sm">{r.awaiting > 0.5 ? <span className="warn-text strong">{fmtMoney(r.awaiting)}</span> : <span className="muted">—</span>}</td>
      </tr>)}</tbody>
    </table></div>
  </div>
}
