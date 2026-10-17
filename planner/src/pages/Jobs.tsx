// Jobs page with four views of the same data: Table (daily list), Board
// (Kanban of tasks), Gantt (long-term timeline) and Calendar.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { calendarItems } from '../lib/calendar'
import type { JobStatus } from '../lib/types'
import { JOB_STATUS_LABEL } from '../lib/types'
import { JobsTable } from '../views/JobsTable'
import { Kanban } from '../views/Kanban'
import { Gantt } from '../views/Gantt'
import { CalendarView } from '../views/CalendarView'
import { JobModal } from '../components/editors'
import { Icon } from '../components/ui'

type View = 'table' | 'board' | 'gantt' | 'calendar'

export function Jobs() {
  const store = useData()
  const { jobs, tasks, clients } = store
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'table'
  const [status, setStatus] = useState<JobStatus | 'open'>('open')
  const [client, setClient] = useState('')
  const [q, setQ] = useState('')
  const [newJob, setNewJob] = useState(false)

  const filteredJobs = useMemo(() => jobs.filter(j => {
    if (status === 'open' ? (j.status !== 'active' && j.status !== 'on_hold') : j.status !== status) return false
    if (client && j.client_id !== client) return false
    if (q) {
      const n = q.toLowerCase()
      const c = clients.find(c => c.id === j.client_id)?.name ?? ''
      if (!j.name.toLowerCase().includes(n) && !j.job_number.toLowerCase().includes(n) && !c.toLowerCase().includes(n) && !j.address.toLowerCase().includes(n)) return false
    }
    return true
  }), [jobs, status, client, q, clients])

  const jobIds = new Set(filteredJobs.map(j => j.id))
  const filteredTasks = tasks.filter(t => jobIds.has(t.job_id))
  const calItems = useMemo(() => calendarItems({ ...store, jobs: filteredJobs }), [store, filteredJobs])

  return (
    <div>
      <div className="page-header">
        <h1>Jobs</h1>
        <div className="btn-group">
          {(['table', 'board', 'gantt', 'calendar'] as View[]).map(v => (
            <button key={v} className={`btn sm ${view === v ? 'active' : ''}`} onClick={() => setParams(p => { p.set('view', v); return p })}>{v === 'table' ? 'Table' : v === 'board' ? 'Board' : v === 'gantt' ? 'Gantt' : 'Calendar'}</button>
          ))}
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setNewJob(true)}><Icon name="plus" size={16} /> New job</button>
        </div>
      </div>

      <div className="filters">
        <input type="search" placeholder="Filter…" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Filter jobs by status" value={status} onChange={e => setStatus(e.target.value as JobStatus | 'open')}>
          <option value="open">Open (active + on hold)</option>
          {Object.entries(JOB_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={client} onChange={e => setClient(e.target.value)}>
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {(q || client || status !== 'open') && <button className="btn sm ghost" onClick={() => { setQ(''); setClient(''); setStatus('open') }}>Clear</button>}
        <span className="grow" />
        <span className="small muted">{filteredJobs.length} job{filteredJobs.length === 1 ? '' : 's'}</span>
      </div>

      {view === 'table' && <div className="card"><JobsTable jobs={filteredJobs} schedulable={status === 'open' || status === 'active' || status === 'on_hold'} /></div>}
      {view === 'board' && <Kanban tasks={filteredTasks} />}
      {view === 'gantt' && <Gantt jobs={filteredJobs} />}
      {view === 'calendar' && <CalendarView items={calItems} />}

      {newJob && <JobModal onClose={() => setNewJob(false)} />}
    </div>
  )
}
