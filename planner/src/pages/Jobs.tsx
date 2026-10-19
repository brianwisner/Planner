// One job workspace: a compact list, task board, planning timeline, and calendar.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useData } from '../lib/store'
import { calendarItems } from '../lib/calendar'
import { filterJobRows, jobRows, parseJobsQuery, writeJobsQuery, type JobsFocus, type JobsQuery, type JobsView } from '../lib/jobs'
import { JOB_STATUS_LABEL, type Job } from '../lib/types'
import { fmtMoney } from '../lib/utils'
import { JobsTable } from '../views/JobsTable'
import { JobsSpreadsheet } from '../views/JobsSpreadsheet'
import { Kanban } from '../views/Kanban'
import { Gantt } from '../views/Gantt'
import { CalendarView } from '../views/CalendarView'
import { JobModal, TaskModal, TimeModal } from '../components/editors'
import { Icon } from '../components/ui'

const VIEWS: { key: JobsView; label: string; icon: string; hint: string }[] = [
  { key: 'table', label: 'List', icon: 'jobs', hint: 'Next steps, deadlines, hours, and billing in one place. Turn on Plan hours when you want to schedule work.' },
  { key: 'sheet', label: 'Spreadsheet', icon: 'jobs', hint: 'Compare jobs in compact rows. Scroll across for planning and billing columns, choose the columns you need, or export this selection.' },
  { key: 'board', label: 'Task board', icon: 'dashboard', hint: 'Tasks for the jobs in this selection. Open a card to edit it, or move it to update its status.' },
  { key: 'gantt', label: 'Timeline', icon: 'reports', hint: 'Phase dates and planned hours over time. Expand a job to see its phases.' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar', hint: 'Job deadlines, phase dates, and site visits for this selection.' },
]
const FOCUS_LABELS: Record<JobsFocus, string> = {
  all: 'All matching jobs', due: 'Due soon & overdue', waiting: 'Waiting / on hold',
  over_estimate: 'Over estimate', billing: 'Billing follow-up',
}

export function Jobs() {
  const store = useData()
  const { tasks, clients } = store
  const [params, setParams] = useSearchParams()
  const query = parseJobsQuery(params)
  const nav = useNavigate()
  const [newJob, setNewJob] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [logging, setLogging] = useState<string | null>(null)
  const [addingTask, setAddingTask] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [])

  const rows = useMemo(() => jobRows(store, now), [store, now])
  const baseRows = useMemo(() => filterJobRows(rows, { status: query.status, client: query.client, q: query.q, focus: 'all' }, now), [rows, query.status, query.client, query.q, now])
  const focused = (focus: JobsFocus) => filterJobRows(baseRows, { status: 'all', client: '', q: '', focus }, now)
  const filteredRows = focused(query.focus)
  const filteredJobs = filteredRows.map(row => row.job)
  const jobIds = new Set(filteredJobs.map(job => job.id))
  const filteredTasks = tasks.filter(task => jobIds.has(task.job_id))
  const calItems = calendarItems({ ...store, jobs: filteredJobs }).map(item => {
    const job = filteredJobs.find(job => job.id === item.jobId)
    return job?.status === 'complete' ? { ...item, done: true } : item
  })
  const activeCount = baseRows.filter(row => row.job.status === 'active').length
  const heldCount = baseRows.filter(row => row.job.status === 'on_hold').length
  const dueCount = focused('due').length
  const waitingCount = focused('waiting').length
  const billingCount = focused('billing').length
  const readyToBill = baseRows.reduce((total, row) => total + row.billing.unbilledAmount, 0)
  const hasFilters = Boolean(query.q.trim() || query.client || query.status !== 'open' || query.focus !== 'all')
  const allowReorder = query.status === 'open' && query.focus === 'all' && !query.q.trim() && !query.client
  const loggingRow = rows.find(row => row.job.id === logging)
  const taskRow = rows.find(row => row.job.id === addingTask)
  const selectedView = VIEWS.find(view => view.key === query.view)!
  const selectedClient = clients.find(client => client.id === query.client)

  function change(patch: Partial<JobsQuery>, replace = false) {
    setParams(current => writeJobsQuery(current, patch), { replace })
  }
  function reset() { change({ status: 'open', client: '', q: '', focus: 'all' }) }

  return <div className="jobs-page">
    <div className="page-header jobs-header">
      <div><h1>Jobs</h1><p className="jobs-subtitle">Find the next step, keep work moving, and follow up on billing.</p></div>
      <div className="actions"><button className="btn primary" onClick={() => setNewJob(true)}><Icon name="plus" size={16} /> New job</button></div>
    </div>

    <div className="stats jobs-stats" aria-label="Quick job filters">
      <button className="stat jobs-stat" aria-pressed={query.focus === 'all'} onClick={() => change({ focus: 'all' })}><span className="label"><Icon name="jobs" size={15} /> Jobs in view</span><span className="value">{baseRows.length}</span><span className="sub">{activeCount} active · {heldCount} on hold</span></button>
      <button className="stat jobs-stat" aria-pressed={query.focus === 'due'} onClick={() => change({ focus: 'due' })}><span className="label"><Icon name="calendar" size={15} /> Due soon & overdue</span><span className="value">{dueCount}</span><span className="sub">Next 7 days, plus past-due work</span></button>
      <button className="stat jobs-stat" aria-pressed={query.focus === 'waiting'} onClick={() => change({ focus: 'waiting' })}><span className="label"><Icon name="time" size={15} /> Waiting / on hold</span><span className="value">{waitingCount}</span><span className="sub">Waiting tasks, phases, or held jobs</span></button>
      <button className="stat jobs-stat" aria-pressed={query.focus === 'billing'} onClick={() => change({ focus: 'billing' })}><span className="label"><Icon name="billing" size={15} /> Billing follow-up</span><span className="value">{billingCount}</span><span className="sub">{fmtMoney(readyToBill)} ready to bill</span></button>
    </div>

    <section className="card jobs-controls" aria-label="Job filters and views">
      <div className="jobs-filter-grid">
        <div className="jobs-search-field"><label htmlFor="jobs-search">Search</label><div className="jobs-search"><Icon name="search" size={17} /><input id="jobs-search" type="search" aria-label="Search jobs" placeholder="Job, client, number, or address…" value={query.q} onChange={e => change({ q: e.target.value }, true)} /></div></div>
        <div><label htmlFor="jobs-status">Status</label><select id="jobs-status" aria-label="Filter jobs by status" value={query.status} onChange={e => change({ status: e.target.value as JobsQuery['status'] })}><option value="open">Open · active + on hold</option><option value="all">All statuses</option>{Object.entries(JOB_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor="jobs-client">Client</label><select id="jobs-client" aria-label="Filter jobs by client" value={query.client} onChange={e => change({ client: e.target.value })}><option value="">All clients</option>{query.client && !selectedClient && <option value={query.client}>Unavailable client</option>}{[...clients].sort((a, b) => a.name.localeCompare(b.name)).map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></div>
        <div><label htmlFor="jobs-focus">Show</label><select id="jobs-focus" aria-label="Filter jobs by focus" value={query.focus} onChange={e => change({ focus: e.target.value as JobsFocus })}>{Object.entries(FOCUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      </div>
      <div className="jobs-view-bar">
        <div className="jobs-view-tabs" aria-label="Job view">{VIEWS.map(view => <button key={view.key} type="button" aria-pressed={query.view === view.key} onClick={() => change({ view: view.key })}><Icon name={view.icon} size={15} />{view.label}</button>)}</div>
        <div className="jobs-result-count" role="status">{filteredRows.length === baseRows.length ? `${filteredRows.length} jobs` : `${filteredRows.length} of ${baseRows.length} matching jobs`}</div>
        {hasFilters && <button className="btn sm jobs-reset" onClick={reset}>Reset filters</button>}
      </div>
    </section>

    <p className="jobs-view-hint">{selectedView.hint}</p>
    {query.view === 'calendar' && filteredJobs.some(job => job.status === 'cancelled' || job.status === 'archived') && <p className="jobs-history-note">Cancelled and archived jobs keep their records, but do not add deadlines to the calendar.</p>}
    {filteredJobs.length === 0 ? <div className="card jobs-empty"><Icon name="search" size={24} /><h2>No jobs match this selection</h2><p>Try another search, status, client, or quick filter.</p>{hasFilters ? <button className="btn" onClick={reset}>Reset filters</button> : <button className="btn primary" onClick={() => setNewJob(true)}>{store.jobs.length ? 'Create a job' : 'Create your first job'}</button>}</div> : <>
      {query.view === 'table' && <div className="card jobs-list-card"><JobsTable jobs={filteredJobs} schedulable={query.status === 'open' || query.status === 'active' || query.status === 'on_hold'} allowReorder={allowReorder} onLogHours={setLogging} onAddTask={setAddingTask} /></div>}
      {query.view === 'sheet' && <div className="card jobs-list-card"><JobsSpreadsheet rows={filteredRows} onEditJob={setEditingJob} /></div>}
      {query.view === 'board' && <Kanban tasks={filteredTasks} />}
      {query.view === 'gantt' && <Gantt jobs={filteredJobs} />}
      {query.view === 'calendar' && <CalendarView items={calItems} />}
    </>}

    {newJob && <JobModal defaultClientId={selectedClient?.id} onClose={() => setNewJob(false)} onCreated={job => nav(`/jobs/${job.id}`)} />}
    {editingJob && <JobModal key={editingJob.id} job={editingJob} onClose={() => setEditingJob(null)} onDeleted={() => setEditingJob(null)} />}
    {loggingRow && <TimeModal defaults={{ job_id: loggingRow.job.id, phase_id: loggingRow.workPhase?.id ?? null }} onClose={() => setLogging(null)} />}
    {taskRow && <TaskModal defaults={{ job_id: taskRow.job.id, phase_id: taskRow.workPhase?.id ?? null }} onClose={() => setAddingTask(null)} />}
  </div>
}
