// The client's own running order, independent of the overall Jobs queue.
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, Check, GripVertical, ListOrdered } from 'lucide-react'
import { useData } from '../lib/store'
import { openClientJobs, reorderClientJobs } from '../lib/clientJobs'
import { summarizeJob, type JobSummary } from '../lib/views'
import type { Client, Job } from '../lib/types'
import { fmtHours, fmtMoney } from '../lib/utils'
import { DueText, StageChip } from './ui'
import './clientJobList.css'

export function ClientJobList({ client, detailed = false }: { client: Client; detailed?: boolean }) {
  const store = useData()
  const [arranging, setArranging] = useState(false)
  const [pending, setPending] = useState<Job[] | null>(null)
  const [message, setMessage] = useState('')
  const busy = useRef(false)
  const savedJobs = openClientJobs(store.jobs, client.id)
  const jobs = pending ?? savedJobs
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function move(from: number, to: number) {
    if (busy.current || from < 0 || from === to || to < 0 || to >= jobs.length) return
    busy.current = true
    const control = document.activeElement
    const ordered = arrayMove(jobs, from, to)
    setPending(ordered)
    setMessage('Saving order…')
    try {
      const ok = await reorderClientJobs(store, client.id, savedJobs, ordered)
      setMessage(ok ? 'Order saved' : 'Order was not saved. Please try again.')
    } finally {
      setPending(null)
      busy.current = false
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && control instanceof HTMLButtonElement && control.isConnected) control.focus()
      })
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return
    void move(jobs.findIndex(j => j.id === event.active.id), jobs.findIndex(j => j.id === event.over?.id))
  }

  return <section className={`client-job-plan ${detailed ? 'detailed' : 'compact'}`} aria-label={`Job order for ${client.name}`} onClick={e => e.stopPropagation()}>
    <div className="client-job-plan-head">
      <h2>Open jobs <span className="count">{jobs.length}</span></h2>
      {jobs.length > 1 && <button className="btn ghost sm client-plan-order" disabled={pending !== null} aria-pressed={arranging} onClick={() => { setArranging(!arranging); setMessage('') }}>
        {arranging ? <Check size={15} /> : <ListOrdered size={15} />}{arranging ? 'Done' : 'Order jobs'}
      </button>}
    </div>
    {arranging && <p className="client-plan-hint">Drag the handle or use the arrows. Saves automatically.</p>}
    {jobs.length === 0 ? <p className="small muted client-plan-empty">No open jobs.</p> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{
      screenReaderInstructions: { draggable: 'Press Space to pick up a job, use Up and Down to move it, then Space to drop it. Press Escape to cancel.' },
      announcements: {
        onDragStart: ({ active }) => `Picked up ${jobs.find(j => j.id === active.id)?.name}.`,
        onDragOver: ({ active, over }) => over ? `${jobs.find(j => j.id === active.id)?.name}, position ${jobs.findIndex(j => j.id === over.id) + 1} of ${jobs.length}.` : undefined,
        onDragEnd: ({ active }) => `Dropped ${jobs.find(j => j.id === active.id)?.name}.`,
        onDragCancel: () => 'Move cancelled.',
      },
    }}>
      <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
        <ol className="client-plan-list" aria-label={`${client.name} jobs in priority order`}>
          {jobs.map((job, index) => <ClientJobRow key={job.id} row={summarizeJob(store, job)} index={index} last={index === jobs.length - 1} arranging={arranging} disabled={pending !== null} detailed={detailed} move={move} />)}
        </ol>
      </SortableContext>
    </DndContext>}
    <span className="client-plan-status small muted" role="status">{message}</span>
  </section>
}

function ClientJobRow({ row, index, last, arranging, disabled, detailed, move }: {
  row: JobSummary; index: number; last: boolean; arranging: boolean; disabled: boolean; detailed: boolean; move: (from: number, to: number) => Promise<void>
}) {
  const { job, stage, nextTask, nextDeadline, hours, estimate, money } = row
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: job.id, disabled: !arranging || disabled })
  return <li ref={setNodeRef} className={`client-plan-job ${isDragging ? 'dragging' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {arranging ? <button ref={setActivatorNodeRef} className="btn ghost icon client-plan-grip" {...attributes} {...listeners} disabled={disabled} aria-label={`Drag ${job.name} to reorder`}><GripVertical size={17} /></button> : <span className="client-plan-number" aria-label={`Priority ${index + 1}`}>{index + 1}</span>}
    <div className="client-plan-content">
      <Link to={`/jobs/${job.id}`} className="client-plan-name">{job.name}</Link>
      <div className="client-plan-meta"><span>{job.job_number}</span><StageChip stage={stage.stage} hold={job.status === 'on_hold'} label={job.status === 'on_hold' ? 'On hold' : undefined} /></div>
      {detailed && nextTask && <div className="small muted client-plan-next">Next: {nextTask.title}</div>}
      {detailed && <div className="client-plan-details small muted">
        {nextDeadline && <DueText date={nextDeadline.date} />}
        <span>{fmtHours(hours)}{estimate > 0 ? ` / ${fmtHours(estimate)}` : ''}</span>
        {money.unbilledAmount > 0.5 && <span className="ok-text">{fmtMoney(money.unbilledAmount)} to bill</span>}
      </div>}
    </div>
    {arranging && <div className="client-plan-arrows">
      <button className="btn ghost icon" disabled={disabled || index === 0} aria-label={`Move ${job.name} up`} onClick={() => void move(index, index - 1)}><ArrowUp size={16} /></button>
      <button className="btn ghost icon" disabled={disabled || last} aria-label={`Move ${job.name} down`} onClick={() => void move(index, index + 1)}><ArrowDown size={16} /></button>
    </div>}
  </li>
}
