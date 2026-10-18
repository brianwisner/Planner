// Kanban board of tasks. Drag a card to another column to change its status.
// Works with mouse and touch.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { useData } from '../lib/store'
import { setTaskStatus } from '../lib/taskActions'
import type { Task, TaskStatus } from '../lib/types'
import { TASK_STATUS_LABEL } from '../lib/types'
import { DueBadge, Icon } from '../components/ui'
import { TaskModal } from '../components/editors'

const COLS: TaskStatus[] = ['todo', 'doing', 'waiting', 'done']

export function Kanban({ tasks }: { tasks: Task[] }) {
  const store = useData()
  const { jobs } = store
  const [active, setActive] = useState<Task | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  function onStart(e: DragStartEvent) { setActive(tasks.find(t => t.id === e.active.id) ?? null) }
  async function onEnd(e: DragEndEvent) {
    setActive(null)
    const to = e.over?.id as TaskStatus | undefined
    const task = tasks.find(t => t.id === e.active.id)
    if (!to || !task || task.status === to) return
    await setTaskStatus(store, task, to)
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setActive(null)}>
        <div className="kanban">
          {COLS.map(s => <Column key={s} status={s} tasks={tasks.filter(t => t.status === s)} jobName={id => jobs.find(j => j.id === id)?.name ?? ''} onOpen={setEditing} />)}
        </div>
        <DragOverlay>{active ? <Card task={active} jobName={jobs.find(j => j.id === active.job_id)?.name ?? ''} overlay /> : null}</DragOverlay>
      </DndContext>
      {editing && <TaskModal task={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function Column({ status, tasks, jobName, onOpen }: { status: TaskStatus; tasks: Task[]; jobName: (id: string) => string; onOpen: (t: Task) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div ref={setNodeRef} className={`col ${isOver ? 'over' : ''}`}>
      <div className="col-head"><span className={`badge ${status}`}>{TASK_STATUS_LABEL[status]}</span><span className="count">{tasks.length}</span></div>
      {tasks.map(t => <Card key={t.id} task={t} jobName={jobName(t.job_id)} onOpen={() => onOpen(t)} />)}
      {tasks.length === 0 && <div className="tiny muted center" style={{ padding: 20 }}>Drop tasks here</div>}
    </div>
  )
}

function Card({ task, jobName, onOpen, overlay }: { task: Task; jobName: string; onOpen?: () => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: overlay })
  return (
    <div ref={overlay ? undefined : setNodeRef} className={`kcard ${isDragging ? 'dragging' : ''}`} {...attributes} {...listeners} onClick={onOpen}>
      <div className="t">{task.is_site_visit && <span className="badge site" style={{ marginRight: 6 }}><Icon name="pin" size={11} /> Site</span>}{task.title}</div>
      <div className="m">
        <Link className="job" to={`/jobs/${task.job_id}`} onClick={e => e.stopPropagation()}>{jobName}</Link>
        <span className="grow" />
        {task.recurrence !== 'none' && <Icon name="repeat" size={12} />}
        <DueBadge date={task.due_date} done={task.status === 'done'} />
      </div>
    </div>
  )
}
