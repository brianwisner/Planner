import type { Store } from './store'
import type { Task, TaskStatus } from './types'
import { nextOccurrence } from './utils'

export type TaskActionStore = Pick<Store, 'tasks' | 'me' | 'insert' | 'update' | 'toast'>

export interface TaskSaveResult {
  task: Task | null
  success: boolean
}

interface PendingTaskSave {
  editsKey: string
  promise: Promise<TaskSaveResult>
  knownTasks: Map<string, Task>
}

// The store's update function stays stable across renders. Identical pending
// saves share one action; different edits wait their turn instead of being lost.
const pendingSaves = new WeakMap<Store['update'], Map<string, PendingTaskSave>>()

function localTime(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function ensureNextOccurrence(store: TaskActionStore, task: Task, original: Task | undefined, knownTasks: Map<string, Task>): Promise<boolean> {
  // React may not have rendered the preceding queued save yet. Include rows
  // confirmed by this queue so its later saves can see the successor it created.
  const tasks = [...new Map([...store.tasks, ...knownTasks.values()].map(t => [t.id, t])).values()]
  if (tasks.some(t => t.recurrence_parent_id === task.id)) return true

  // Dates can be moved backwards. An earlier occurrence must never be reused
  // as a successor, even if all of its other legacy fields happen to match.
  const ancestors = new Set([task.id])
  let parentId = task.recurrence_parent_id
  while (parentId && !ancestors.has(parentId)) {
    ancestors.add(parentId)
    parentId = tasks.find(t => t.id === parentId)?.recurrence_parent_id ?? null
  }

  // Occurrences created before parent links existed can still be recognized.
  // Match the original fields too, before changes such as a new title or date.
  // Link them now so later edits do not create another child.
  const findLegacy = (source: Task | undefined) => {
    if (!source?.due_date || source.recurrence === 'none') return undefined
    const date = nextOccurrence(source.due_date, source.recurrence)
    if (!date) return undefined
    const time = source.scheduled_at ? new Date(`${date}T${localTime(source.scheduled_at)}:00`).toISOString() : null
    return tasks.find(t => !ancestors.has(t.id) && !t.recurrence_parent_id &&
      t.job_id === source.job_id && t.phase_id === source.phase_id &&
      t.title === source.title && t.recurrence === source.recurrence &&
      t.description === source.description && t.estimate_hours === source.estimate_hours &&
      t.sort_order === source.sort_order && t.created_by === source.created_by &&
      t.due_date === date && t.is_site_visit === source.is_site_visit &&
      (t.scheduled_at === time || (t.scheduled_at != null && time != null && new Date(t.scheduled_at).getTime() === new Date(time).getTime())))
  }
  const legacy = findLegacy(original) ?? findLegacy(task)
  if (legacy) {
    const linked = await store.update('tasks', legacy.id, { recurrence_parent_id: task.id })
    if (linked) knownTasks.set(legacy.id, { ...legacy, recurrence_parent_id: task.id })
    return linked
  }

  if (task.recurrence === 'none' || !task.due_date) return true
  const next = nextOccurrence(task.due_date, task.recurrence)
  if (!next) return true
  const scheduledAt = task.scheduled_at ? new Date(`${next}T${localTime(task.scheduled_at)}:00`).toISOString() : null

  const created = await store.insert('tasks', {
    job_id: task.job_id, phase_id: task.phase_id, title: task.title, description: task.description,
    status: 'todo', completed_at: null, assignee_id: store.me?.id ?? null,
    due_date: next, scheduled_at: scheduledAt, is_site_visit: task.is_site_visit,
    estimate_hours: task.estimate_hours, recurrence: task.recurrence,
    sort_order: task.sort_order, created_by: task.created_by, recurrence_parent_id: task.id,
  })
  if (!created) return false
  knownTasks.set(created.id, created)
  store.toast(`Next "${task.title}" scheduled for ${next}`)
  return true
}

async function persistTask(store: TaskActionStore, task: Task | undefined, edits: Partial<Task>, knownTasks = new Map<string, Task>()): Promise<TaskSaveResult> {
  const status = edits.status ?? task?.status ?? 'todo'
  const row: Partial<Task> = {
    ...edits,
    completed_at: status === 'done' ? (task?.completed_at ?? new Date().toISOString()) : null,
  }
  let saved: Task | null
  if (task) {
    if (!await store.update('tasks', task.id, row)) return { task: null, success: false }
    saved = { ...task, ...row }
  } else {
    saved = await store.insert('tasks', { ...row, created_by: store.me?.id ?? null })
    if (!saved) return { task: null, success: false }
  }
  knownTasks.set(saved.id, saved)

  // Also ensure a successor when saving a task that is already done: a previous
  // attempt may have saved completion but failed to create its next occurrence.
  if (saved.status === 'done' && !await ensureNextOccurrence(store, saved, task, knownTasks)) {
    store.toast('Task saved, but its next occurrence could not be saved. Open the task and save it again to retry.', 'error')
    return { task: saved, success: false }
  }
  return { task: saved, success: true }
}

/** Save task edits and use the same recurring completion rules in every view. */
export async function saveTask(store: TaskActionStore, task: Task | undefined, edits: Partial<Task>): Promise<TaskSaveResult> {
  if (!task) return persistTask(store, task, edits)
  let pending = pendingSaves.get(store.update)
  if (!pending) { pending = new Map(); pendingSaves.set(store.update, pending) }
  const existing = pending.get(task.id)
  const editsKey = JSON.stringify(Object.entries(edits).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)))
  if (existing?.editsKey === editsKey) return existing.promise
  const knownTasks = existing?.knownTasks ?? new Map<string, Task>()
  const save = existing
    ? existing.promise.then(
      previous => persistTask(store, previous.task ?? task, edits, knownTasks),
      () => persistTask(store, knownTasks.get(task.id) ?? task, edits, knownTasks),
    )
    : persistTask(store, task, edits, knownTasks)
  pending.set(task.id, { editsKey, promise: save, knownTasks })
  try { return await save } finally {
    if (pending.get(task.id)?.promise === save) pending.delete(task.id)
  }
}

export function setTaskStatus(store: TaskActionStore, task: Task, status: TaskStatus) {
  return saveTask(store, task, { status })
}

export function toggleTaskDone(store: TaskActionStore, task: Task) {
  return setTaskStatus(store, task, task.status === 'done' ? 'todo' : 'done')
}
