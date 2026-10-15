// The prioritized job queue as a table. Drag the handle to reorder priority,
// click a column header to sort, click a row to open the job.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useData } from '../lib/store'
import { hoursForJob, hoursForPhase } from '../lib/calc'
import type { Job, Phase } from '../lib/types'
import { PHASE_KIND_SHORT } from '../lib/types'
import { daysUntil, downloadCSV, fmtHours, sum } from '../lib/utils'
import { DueBadge, Empty, JobStatusBadge, Person, Progress } from '../components/ui'

type SortKey = 'priority' | 'name' | 'client' | 'due' | 'assignee'

export function JobsTable({ jobs, showExport = true }: { jobs: Job[]; showExport?: boolean }) {
  const store = useData()
  const { clients, phases, timeEntries, profiles, update } = store
  const nav = useNavigate()
  const [sort, setSort] = useState<SortKey>('priority')
  const [asc, setAsc] = useState(true)

  // "Current phase" = first phase that isn't complete.
  const current = (j: Job) => phases.find(p => p.job_id === j.id && p.status !== 'complete') ?? phases.filter(p => p.job_id === j.id).at(-1)
  const rows = useMemo(() => jobs.map(j => {
    const cp = current(j)
    const est = sum(phases.filter(p => p.job_id === j.id).map(p => p.estimate_hours))
    const logged = hoursForJob(timeEntries, j.id)
    const nextDue = cp?.due_date ?? j.due_date
    return { j, cp, est, logged, nextDue, client: clients.find(c => c.id === j.client_id)?.name ?? '', assignee: profiles.find(p => p.id === cp?.assignee_id)?.full_name ?? '' }
  }), [jobs, phases, timeEntries, clients, profiles]) // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const r = [...rows]
    const dir = asc ? 1 : -1
    r.sort((a, b) => {
      switch (sort) {
        case 'name': return dir * a.j.name.localeCompare(b.j.name)
        case 'client': return dir * a.client.localeCompare(b.client)
        case 'assignee': return dir * a.assignee.localeCompare(b.assignee)
        case 'due': return dir * ((a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999'))
        default: return dir * (a.j.priority - b.j.priority)
      }
    })
    return r
  }, [rows, sort, asc])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  )

  function header(key: SortKey, label: string, cls = '') {
    return <th className={`sortable ${cls}`} onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(true) } }}>{label}{sort === key ? (asc ? ' ↑' : ' ↓') : ''}</th>
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || sort !== 'priority') return
    const ids = sorted.map(r => r.j.id)
    const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    await Promise.all(moved.map((id, i) => {
      const job = jobs.find(j => j.id === id)!
      return job.priority === i + 1 ? Promise.resolve() : update('jobs', id, { priority: i + 1 })
    }))
  }

  function exportCSV() {
    downloadCSV('jobs.csv', ['Priority', 'Job #', 'Job', 'Client', 'Status', 'Current phase', 'Phase status', 'Assignee', 'Next due', 'Estimate h', 'Logged h', 'Fee'],
      sorted.map(r => [r.j.priority, r.j.job_number, r.j.name, r.client, r.j.status, r.cp ? PHASE_KIND_SHORT[r.cp.kind] : '', r.cp?.status ?? '', r.assignee, r.nextDue ?? '', r.est, Math.round(r.logged * 100) / 100, r.j.fee]))
  }

  if (jobs.length === 0) return <Empty>No jobs match.</Empty>

  return (
    <div>
      <div className="table-wrap">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sorted.map(r => r.j.id)} strategy={verticalListSortingStrategy}>
            <table>
              <thead>
                <tr>
                  {header('priority', '#', 'nowrap')}
                  {header('name', 'Job')}
                  {header('client', 'Client', 'hide-mobile')}
                  <th>Phase</th>
                  {header('assignee', 'Who', 'hide-mobile')}
                  {header('due', 'Due')}
                  <th className="hide-mobile" style={{ width: 140 }}>Hours</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => <Row key={r.j.id} r={r} onOpen={() => nav(`/jobs/${r.j.id}`)} draggable={sort === 'priority'} phaseLogged={r.cp ? hoursForPhase(timeEntries, r.cp.id) : 0} />)}
              </tbody>
            </table>
          </SortableContext>
        </DndContext>
      </div>
      {showExport && <div className="row mt small muted"><span>{sort === 'priority' ? 'Drag the ≡ handle to change priority.' : 'Sort by # to drag-reorder priority.'}</span><span className="grow" /><button className="btn sm" onClick={exportCSV}>Export CSV</button></div>}
    </div>
  )
}

type RowData = { j: Job; cp: Phase | undefined; est: number; logged: number; nextDue: string | null; client: string; assignee: string }

function Row({ r, onOpen, draggable, phaseLogged }: { r: RowData; onOpen: () => void; draggable: boolean; phaseLogged: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.j.id, disabled: !draggable })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const overdue = daysUntil(r.nextDue) != null && (daysUntil(r.nextDue) as number) < 0 && r.j.status === 'active'
  return (
    <tr ref={setNodeRef} style={style} className="clickable" onClick={onOpen}>
      <td className="nowrap" onClick={e => e.stopPropagation()}>
        <span className="muted" style={{ cursor: draggable ? 'grab' : 'default', touchAction: 'none', padding: '6px 4px', display: 'inline-block' }} {...attributes} {...listeners}>{draggable ? '≡ ' : ''}{r.j.priority}</span>
      </td>
      <td>
        <div className="bold">{r.j.name}</div>
        <div className="tiny muted">{r.j.job_number}{r.j.job_number && ' · '}<span className="hide-mobile">{r.client}</span><span className="hide-mobile" />{r.j.status !== 'active' && <> <JobStatusBadge status={r.j.status} /></>}</div>
      </td>
      <td className="hide-mobile">{r.client}</td>
      <td>{r.cp ? <span className={`badge ${r.cp.status}`}>{PHASE_KIND_SHORT[r.cp.kind]}</span> : <span className="muted">–</span>}</td>
      <td className="hide-mobile"><Person userId={r.cp?.assignee_id} /></td>
      <td className="nowrap"><DueBadge date={r.nextDue} done={r.j.status === 'complete'} />{overdue && ''}</td>
      <td className="hide-mobile">
        <div className="tiny muted">{fmtHours(phaseLogged)} / {fmtHours(r.cp?.estimate_hours ?? 0)} phase · {fmtHours(r.logged)} / {fmtHours(r.est)} job</div>
        <Progress value={r.logged} max={r.est} />
      </td>
    </tr>
  )
}
