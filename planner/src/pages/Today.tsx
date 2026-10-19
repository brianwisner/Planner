// Today: what needs attention now, this week's plan, and money to act on.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CalendarCheck2, CalendarClock, CircleDollarSign, Clock, Hourglass, Plus, Send } from 'lucide-react'
import { useData } from '../lib/store'
import { useEditors } from '../components/editors'
import { TaskRow } from '../components/TaskRow'
import { DueText, Empty, Segmented } from '../components/ui'
import { WeekStrip } from '../components/WeekStrip'
import { PipelineBar } from '../components/PipelineBar'
import { jobBilling } from '../lib/calc'
import { greeting, mondayOf, openAgenda, taskDay, taskOrder, unpaidInvoices, weekDays } from '../lib/views'
import { fmtDate, fmtHours, fmtMoney, sum, todayISO } from '../lib/utils'
import { saveTask } from '../lib/taskActions'
import { jobStage } from '../lib/stages'
import { pref, setPref } from '../lib/theme'
import type { Task } from '../lib/types'
import './today.css'

type ListView = 'focus' | 'waiting' | 'all'

export function Today() {
  const store = useData()
  const edit = useEditors()
  const { jobs, tasks, clients, phases, me } = store
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(id) }, [])
  const today = todayISO()
  const [view, setViewState] = useState<ListView>(() => pref('today.view', 'focus'))
  const setView = (v: ListView) => { setViewState(v); setPref('today.view', v) }
  const [showAllSoon, setShowAllSoon] = useState(false)

  const openJobIds = useMemo(() => new Set(jobs.filter(j => j.status === 'active' || j.status === 'on_hold').map(j => j.id)), [jobs])
  const openTasks = useMemo(() => tasks.filter(t => t.status !== 'done' && openJobIds.has(t.job_id)).sort(taskOrder), [tasks, openJobIds])
  const taskDate = (t: Task) => taskDay(t)
  const weekEnd = fmtISO(addDaysISO(today, 7))
  const late = openTasks.filter(t => t.status !== 'waiting' && taskDate(t) && taskDate(t)! < today)
  const dueToday = openTasks.filter(t => t.status !== 'waiting' && taskDate(t) === today)
  const soon = openTasks.filter(t => t.status !== 'waiting' && taskDate(t) && taskDate(t)! > today && taskDate(t)! <= weekEnd)
  const undated = openTasks.filter(t => t.status !== 'waiting' && !taskDate(t))
  const waiting = openTasks.filter(t => t.status === 'waiting')
  const waitingPhases = phases.filter(p => p.status === 'waiting' && p.kind !== 'queued' && jobs.some(j => j.id === p.job_id && j.status === 'active'))

  // Phase and job deadlines (not tasks) in the same windows.
  const deadlines = useMemo(() => openAgenda(store).filter(i => i.kind === 'phase' || i.kind === 'job'), [store])
  const lateDeadlines = deadlines.filter(d => d.date < today)
  const todayDeadlines = deadlines.filter(d => d.date === today)
  const soonDeadlines = deadlines.filter(d => d.date > today && d.date <= weekEnd)

  const monday = mondayOf(today)
  const week = weekDays(store, monday, today)
  const todayPlan = week.find(d => d.isToday)
  const plannedToday = store.schedule.filter(s => s.date === today && jobs.some(j => j.id === s.job_id && j.status === 'active'))

  const money = useMemo(() => {
    const rows = jobs.filter(j => j.status !== 'archived').map(j => jobBilling(store, j))
    const ready = rows.filter(r => r.unbilledAmount > 0.5).sort((a, b) => b.unbilledAmount - a.unbilledAmount)
    const unpaid = unpaidInvoices(store)
    return { ready, readyTotal: sum(ready.map(r => r.unbilledAmount)), unpaid, unpaidTotal: sum(unpaid.map(i => i.amount)) }
  }, [store, jobs])

  const lateCount = late.length + lateDeadlines.length
  const summary = [
    lateCount ? `${lateCount} late` : null,
    dueToday.length + todayDeadlines.length ? `${dueToday.length + todayDeadlines.length} due today` : null,
    todayPlan && todayPlan.planned ? `${fmtHours(todayPlan.planned)} planned` : null,
  ].filter(Boolean).join(' · ')

  const firstName = (me?.full_name || '').split(' ')[0]

  return <div className="today">
    <div className="page-head">
      <div className="titles">
        <h1>{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
        <p className="lede">{fmtDate(today, 'long').replace(/, \d{4}$/, '')}{summary ? ` — ${summary}` : ' — nothing urgent. Nice.'}</p>
      </div>
      <div className="actions hide-sm">
        <button className="btn" onClick={() => edit.time()}><Clock size={16} /> Log hours</button>
        <button className="btn primary" onClick={() => edit.task(undefined, { due_date: today })}><Plus size={16} /> Add task</button>
      </div>
    </div>

    <div className="stats">
      <button className={`stat ${lateCount ? 'danger' : ''}`} onClick={() => setView('focus')}>
        <span className="label"><AlertTriangle size={15} /> Late</span>
        <span className="value">{lateCount}</span>
        <span className="sub">{lateCount ? 'past their due date' : 'nothing overdue'}</span>
      </button>
      <Link className="stat" to="/schedule">
        <span className="label"><CalendarCheck2 size={15} /> Today's plan</span>
        <span className="value">{fmtHours(todayPlan?.planned ?? 0)}</span>
        <span className="sub">{fmtHours(todayPlan?.logged ?? 0)} logged so far</span>
      </Link>
      <Link className="stat" to="/money?tab=unbilled">
        <span className="label"><CircleDollarSign size={15} /> Ready to bill</span>
        <span className="value">{fmtMoney(money.readyTotal)}</span>
        <span className="sub">{money.ready.length} job{money.ready.length === 1 ? '' : 's'} with unbilled work</span>
      </Link>
      <Link className="stat" to="/money?tab=invoices">
        <span className="label"><Send size={15} /> Awaiting payment</span>
        <span className="value">{fmtMoney(money.unpaidTotal)}</span>
        <span className="sub">{money.unpaid.length} unpaid invoice{money.unpaid.length === 1 ? '' : 's'}</span>
      </Link>
    </div>

    <div className="today-grid">
      <div className="stack loose">
        <section className="card" aria-labelledby="list-title">
          <div className="card-head">
            <h2 id="list-title">Your list</h2>
            <Segmented size="sm" label="Which tasks" value={view} onChange={setView} options={[
              { value: 'focus', label: 'Focus' },
              { value: 'waiting', label: <>Waiting <span className="count">{waiting.length + waitingPhases.length}</span></> },
              { value: 'all', label: 'All open' },
            ]} />
          </div>
          <QuickAdd />
          {view === 'focus' && <>
            {lateCount + dueToday.length + todayDeadlines.length + soon.length + soonDeadlines.length === 0 && <Empty compact icon={<CalendarCheck2 size={20} />} title="Nothing due this week">Add a task above, or pick something from “All open”.</Empty>}
            <Group label="Late" tone="danger" count={late.length + lateDeadlines.length}>
              {lateDeadlines.map(d => <DeadlineRow key={d.id} item={d} />)}
              {late.map(t => <TaskRow key={t.id} task={t} />)}
            </Group>
            <Group label="Today" count={dueToday.length + todayDeadlines.length}>
              {todayDeadlines.map(d => <DeadlineRow key={d.id} item={d} />)}
              {dueToday.map(t => <TaskRow key={t.id} task={t} />)}
            </Group>
            <Group label="Next 7 days" count={soon.length + soonDeadlines.length}>
              {[...soonDeadlines.map(d => ({ date: d.date, el: <DeadlineRow key={d.id} item={d} /> })), ...soon.map(t => ({ date: taskDate(t)!, el: <TaskRow key={t.id} task={t} /> }))]
                .sort((a, b) => a.date.localeCompare(b.date)).slice(0, showAllSoon ? undefined : 7).map(x => x.el)}
              {!showAllSoon && soon.length + soonDeadlines.length > 7 && <button className="list-more" onClick={() => setShowAllSoon(true)}>Show {soon.length + soonDeadlines.length - 7} more this week <ArrowRight size={14} /></button>}
            </Group>
            {undated.length > 0 && <button className="list-more" onClick={() => setView('all')}>{undated.length} more without a due date <ArrowRight size={14} /></button>}
          </>}
          {view === 'waiting' && <>
            {waiting.length + waitingPhases.length === 0 && <Empty compact icon={<Hourglass size={20} />} title="Not waiting on anyone">When you're waiting on a client, architect or the county, set the task to “Waiting on someone”.</Empty>}
            {waitingPhases.map(p => { const job = jobs.find(j => j.id === p.job_id)!; return <Link key={p.id} className="deadline-row" to={`/jobs/${job.id}`}>
              <span className="deadline-ico"><Hourglass size={14} /></span>
              <span className="grow"><span className="strong">{p.name}</span> <span className="badge warn">Waiting</span><span className="task-meta" style={{ display: 'flex' }}><span>{job.name}</span><span>{clients.find(c => c.id === job.client_id)?.name}</span></span></span>
              <DueText date={p.due_date} />
            </Link> })}
            {waiting.map(t => <TaskRow key={t.id} task={t} />)}
          </>}
          {view === 'all' && <>
            {openTasks.length === 0 && <Empty compact title="No open tasks">Everything is done.</Empty>}
            {openTasks.map(t => <TaskRow key={t.id} task={t} />)}
          </>}
        </section>
      </div>

      <div className="stack loose">
        <section className="card">
          <div className="card-head"><h2>This week</h2><Link className="small" to="/schedule">Plan the week <ArrowRight size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /></Link></div>
          <div className="card-body">
            <WeekStrip days={week} />
            <div className="week-summary">
              <div><span className="muted small">Planned</span><strong className="num">{fmtHours(sum(week.map(d => d.planned)))}</strong></div>
              <div><span className="muted small">Available</span><strong className="num">{fmtHours(sum(week.map(d => d.capacity)))}</strong></div>
              <div><span className="muted small">Logged</span><strong className="num">{fmtHours(sum(week.map(d => d.logged)))}</strong></div>
            </div>
            {plannedToday.length > 0 && <div className="today-plan">
              <div className="field-label" style={{ marginBottom: 6 }}>Planned for today</div>
              {plannedToday.map(s => { const job = jobs.find(j => j.id === s.job_id)!; const st = jobStage(phases, job.id); return <Link key={s.id} to={`/jobs/${job.id}`} className="plan-line" data-stage={st.stage}>
                <span className="dot" style={{ background: 'var(--stage)' }} /><span className="grow truncate">{job.name}</span><span className="num strong">{fmtHours(s.hours)}</span>
              </Link> })}
            </div>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Money to act on</h2><Link className="small" to="/money">All money <ArrowRight size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /></Link></div>
          {money.ready.length === 0 && money.unpaid.length === 0 && <Empty compact icon={<CircleDollarSign size={20} />} title="All caught up">No unbilled work and no unpaid invoices.</Empty>}
          {money.ready.slice(0, 3).map(r => <div key={r.job.id} className="money-line">
            <span className="grow"><Link to={`/jobs/${r.job.id}?tab=billing`} className="strong" style={{ color: 'var(--text)' }}>{r.job.name}</Link><span className="tiny muted" style={{ display: 'block' }}>{fmtHours(r.unbilledHours)} not billed{r.unbilledItems > 0 ? ` + ${fmtMoney(r.unbilledItems)} charges` : ''}</span></span>
            <span className="num strong">{fmtMoney(r.unbilledAmount)}</span>
            <button className="btn sm soft" onClick={() => edit.invoice(r.job.id)}>Invoice</button>
          </div>)}
          {money.unpaid.slice(0, 3).map(i => { const job = jobs.find(j => j.id === i.job_id); const age = Math.round((Date.parse(today) - Date.parse(i.issued_date)) / 86400000); return <div key={i.id} className="money-line">
            <span className="grow"><Link to={`/money/invoice/${i.id}`} className="strong" style={{ color: 'var(--text)' }}>{i.number}</Link> <span className="small muted">· {job?.name}</span><span className={`tiny ${age > 30 ? 'danger-text' : 'muted'}`} style={{ display: 'block' }}>Sent {age} day{age === 1 ? '' : 's'} ago</span></span>
            <span className="num strong">{fmtMoney(i.amount)}</span>
            <button className="btn sm" onClick={() => edit.paid(i)}>Paid</button>
          </div> })}
        </section>

        <section className="card">
          <div className="card-head"><h2>Pipeline</h2><Link className="small" to="/jobs">Jobs board <ArrowRight size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /></Link></div>
          <div className="card-body"><PipelineBar /></div>
        </section>
      </div>
    </div>
  </div>
}

function Group({ label, count, tone, children }: { label: string; count: number; tone?: 'danger'; children: React.ReactNode }) {
  if (!count) return null
  return <div className="task-group">
    <div className={`list-group-label ${tone ?? ''}`}><span>{label}</span><span>{count}</span></div>
    {children}
  </div>
}

function DeadlineRow({ item }: { item: ReturnType<typeof openAgenda>[number] }) {
  return <Link to={item.link} className="deadline-row">
    <span className="deadline-ico"><CalendarClock size={14} /></span>
    <span className="grow" style={{ minWidth: 0 }}>
      <span className="strong" style={{ display: 'block' }}>{item.kind === 'job' ? 'Job due' : item.title.split(' — ')[0]}</span>
      <span className="task-meta" style={{ display: 'flex' }}><span>{item.jobName}</span>{item.clientName && <span>{item.clientName}</span>}</span>
    </span>
    <DueText date={item.date} />
  </Link>
}

/** Type a task and press Enter. It goes on the chosen job, due today. */
function QuickAdd() {
  const store = useData()
  const active = store.jobs.filter(j => j.status === 'active')
  const [title, setTitle] = useState('')
  const [jobId, setJobId] = useState(() => pref<string>('today.quickJob', ''))
  const job = active.find(j => j.id === jobId) ?? active[0]
  const [busy, setBusy] = useState(false)
  if (!active.length) return null
  async function add() {
    if (!title.trim() || !job || busy) return
    setBusy(true)
    const result = await saveTask(store, undefined, { job_id: job.id, phase_id: jobStage(store.phases, job.id).phase?.id ?? null, title: title.trim(), status: 'todo', due_date: todayISO(), assignee_id: store.me?.id ?? null })
    setBusy(false)
    if (result.success) { setTitle(''); store.toast('Added to today') }
  }
  return <form className="quick-add" onSubmit={e => { e.preventDefault(); void add() }}>
    <Plus size={18} className="muted" />
    <input className="grow" value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a task for today…" aria-label="New task title" disabled={busy} />
    <select className="input sm" value={job?.id ?? ''} onChange={e => { setJobId(e.target.value); setPref('today.quickJob', e.target.value) }} aria-label="Job for the new task">
      {active.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
    </select>
    <button className="btn sm primary" disabled={!title.trim() || busy}>Add</button>
  </form>
}

function addDaysISO(iso: string, n: number) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d }
function fmtISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
