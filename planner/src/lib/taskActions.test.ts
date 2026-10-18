import { describe, expect, it, vi } from 'vitest'
import type { TableName, Tables } from './store'
import type { Profile, Task } from './types'
import { saveTask, setTaskStatus, toggleTaskDone, type TaskActionStore } from './taskActions'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-original', job_id: 'job-1', phase_id: 'phase-1', title: 'Weekly check-in', description: 'Call the client',
    status: 'todo', assignee_id: 'previous-owner', due_date: '2026-10-20', scheduled_at: null, is_site_visit: false,
    estimate_hours: 0.5, recurrence: 'weekly', sort_order: 4, completed_at: null, created_by: 'original-author',
    created_at: '2026-10-01T00:00:00.000Z', recurrence_parent_id: null, ...overrides,
  }
}

const owner: Profile = {
  id: 'owner', email: 'owner@example.test', full_name: 'Test owner', color: '#123456', hourly_rate: 150,
  weekly_hours: 40, ics_token: 'synthetic-token', created_at: '2026-10-01T00:00:00.000Z',
}

function makeStore(rows: Task[] = [task()]) {
  let nextId = 1
  const store: TaskActionStore = {
    tasks: rows.map(t => ({ ...t })), me: owner, toast: vi.fn(),
    insert: vi.fn(async <K extends TableName>(table: K, row: Partial<Tables[K]>): Promise<Tables[K] | null> => {
      if (table !== 'tasks') throw new Error('Only synthetic tasks are supported')
      const created = task({ ...row as Partial<Task>, id: (row as Partial<Task>).id ?? `new-${nextId++}` })
      store.tasks.push(created)
      return created as Tables[K]
    }) as TaskActionStore['insert'],
    update: vi.fn(async <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>): Promise<boolean> => {
      if (table !== 'tasks') throw new Error('Only synthetic tasks are supported')
      store.tasks = store.tasks.map(t => t.id === id ? { ...t, ...patch as Partial<Task> } : t)
      return true
    }),
  }
  return store
}

describe('recurring task completion', () => {
  it.each([
    ['checkbox', (store: TaskActionStore, original: Task) => toggleTaskDone(store, original)],
    ['board', (store: TaskActionStore, original: Task) => setTaskStatus(store, original, 'done')],
    ['task form', (store: TaskActionStore, original: Task) => saveTask(store, original, { status: 'done' })],
  ])('%s completion creates one linked successor owned by the signed-in owner', async (_name, complete) => {
    const store = makeStore()
    const result = await complete(store, store.tasks[0])
    expect(result.success).toBe(true)
    expect(store.tasks[0].status).toBe('done')
    expect(store.tasks[0].completed_at).not.toBeNull()
    expect(store.tasks[1]).toMatchObject({
      recurrence_parent_id: 'task-original', status: 'todo', completed_at: null,
      due_date: '2026-10-27', assignee_id: 'owner', title: 'Weekly check-in', description: 'Call the client',
      job_id: 'job-1', phase_id: 'phase-1', recurrence: 'weekly', estimate_hours: 0.5, sort_order: 4,
    })
    expect(store.insert).toHaveBeenCalledTimes(1)
  })

  it('uses edits saved with Done when building the next occurrence', async () => {
    const store = makeStore()
    await saveTask(store, store.tasks[0], { status: 'done', title: 'Updated check-in', due_date: '2026-11-01', recurrence: 'monthly', description: 'Updated notes' })
    expect(store.tasks[1]).toMatchObject({ title: 'Updated check-in', due_date: '2026-12-01', recurrence: 'monthly', description: 'Updated notes' })
  })

  it.each([
    ['daily', '2026-10-21'], ['weekly', '2026-10-27'], ['biweekly', '2026-11-03'], ['monthly', '2026-11-20'],
  ] as const)('advances a %s task from its due date', async (recurrence, due_date) => {
    const store = makeStore([task({ recurrence })])
    await setTaskStatus(store, store.tasks[0], 'done')
    expect(store.tasks[1].due_date).toBe(due_date)
  })

  it('keeps a site visit at the same local time across a daylight-saving boundary', async () => {
    const store = makeStore([task({ recurrence: 'daily', due_date: '2026-10-31', is_site_visit: true, scheduled_at: new Date('2026-10-31T09:45:00').toISOString() })])
    await setTaskStatus(store, store.tasks[0], 'done')
    const next = new Date(store.tasks[1].scheduled_at!)
    expect(store.tasks[1].due_date).toBe('2026-11-01')
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(45)
    expect(next.getDate()).toBe(1)
  })

  it('can create a new task as Done and schedule its next occurrence', async () => {
    const store = makeStore([])
    const result = await saveTask(store, undefined, { title: 'New recurring task', job_id: 'job-1', status: 'done', recurrence: 'daily', due_date: '2026-10-20' })
    expect(result.success).toBe(true)
    expect(store.tasks).toHaveLength(2)
    expect(store.tasks[0]).toMatchObject({ status: 'done', created_by: 'owner' })
    expect(store.tasks[1]).toMatchObject({ status: 'todo', recurrence_parent_id: store.tasks[0].id, due_date: '2026-10-21' })
  })

  it('does not create another successor after reopening and completing the original again', async () => {
    const store = makeStore()
    await toggleTaskDone(store, store.tasks[0])
    await toggleTaskDone(store, store.tasks[0])
    expect(store.tasks[0]).toMatchObject({ status: 'todo', completed_at: null })
    await toggleTaskDone(store, store.tasks[0])
    expect(store.tasks).toHaveLength(2)
    expect(store.insert).toHaveBeenCalledTimes(1)
  })

  it('recognizes a linked successor even if the completed original and child have been edited', async () => {
    const store = makeStore([
      task({ status: 'done', completed_at: '2026-10-20T12:00:00.000Z' }),
      task({ id: 'existing-child', recurrence_parent_id: 'task-original', title: 'Renamed child', due_date: '2026-12-30', status: 'done' }),
    ])
    await saveTask(store, store.tasks[0], { status: 'done', title: 'Renamed original', due_date: '2026-11-20', recurrence: 'monthly' })
    expect(store.tasks).toHaveLength(2)
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.tasks[0].completed_at).toBe('2026-10-20T12:00:00.000Z')
  })

  it('links an existing legacy successor instead of inserting another', async () => {
    const store = makeStore([task(), task({ id: 'legacy-child', due_date: '2026-10-27' })])
    await toggleTaskDone(store, store.tasks[0])
    expect(store.tasks[1].recurrence_parent_id).toBe('task-original')
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('matches a legacy site visit when the database formats its timestamp with a UTC offset', async () => {
    const originalTime = new Date('2026-10-20T09:45:00').toISOString()
    const nextTime = new Date('2026-10-27T09:45:00').toISOString().replace('.000Z', '+00:00')
    const store = makeStore([
      task({ is_site_visit: true, scheduled_at: originalTime }),
      task({ id: 'legacy-visit', due_date: '2026-10-27', is_site_visit: true, scheduled_at: nextTime }),
    ])
    await toggleTaskDone(store, store.tasks[0])
    expect(store.tasks[1].recurrence_parent_id).toBe('task-original')
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('does not claim success when a legacy successor cannot be linked', async () => {
    const store = makeStore([task(), task({ id: 'legacy-child', due_date: '2026-10-27' })])
    vi.mocked(store.update).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const result = await toggleTaskDone(store, store.tasks[0])
    expect(result.success).toBe(false)
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('next occurrence could not be saved'), 'error')
  })

  it('does not reuse another series child or an unrelated task', async () => {
    const store = makeStore([
      task(), task({ id: 'other-series-child', due_date: '2026-10-27', recurrence_parent_id: 'other-parent' }),
      task({ id: 'unrelated-task', due_date: '2026-10-27', description: 'Different work with the same title' }),
    ])
    await toggleTaskDone(store, store.tasks[0])
    expect(store.insert).toHaveBeenCalledTimes(1)
    expect(store.tasks[3].recurrence_parent_id).toBe('task-original')
  })

  it('does not link an ancestor as a legacy successor after moving a due date earlier', async () => {
    const store = makeStore([
      task({ status: 'done' }),
      task({ id: 'current-child', due_date: '2026-10-27', recurrence_parent_id: 'task-original' }),
    ])
    const result = await saveTask(store, store.tasks[1], { status: 'done', due_date: '2026-10-13' })
    expect(result.success).toBe(true)
    expect(store.tasks[0].recurrence_parent_id).toBeNull()
    expect(store.tasks[2]).toMatchObject({ recurrence_parent_id: 'current-child', due_date: '2026-10-20' })
  })

  it('recognizes a legacy successor before applying edits to a completed original', async () => {
    const store = makeStore([
      task({ status: 'done', completed_at: '2026-10-20T12:00:00.000Z' }),
      task({ id: 'legacy-child', due_date: '2026-10-27' }),
    ])
    const result = await saveTask(store, store.tasks[0], { status: 'done', title: 'Renamed original' })
    expect(result.success).toBe(true)
    expect(store.tasks).toHaveLength(2)
    expect(store.tasks[1].recurrence_parent_id).toBe('task-original')
  })

  it.each([
    { recurrence: 'none' as const }, { due_date: null }, { status: 'doing' as const },
  ])('does not create a successor when recurrence is not ready or the task remains open: %j', async overrides => {
    const store = makeStore([task(overrides)])
    await saveTask(store, store.tasks[0], { status: 'status' in overrides ? overrides.status : 'done' })
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('treats concurrent completions from the same task as one action', async () => {
    const store = makeStore()
    const update = store.update
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    store.update = vi.fn(async <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>) => {
      await gate
      return update(table, id, patch)
    })
    const original = store.tasks[0]
    const a = toggleTaskDone(store, original)
    const b = setTaskStatus(store, original, 'done')
    release()
    expect((await Promise.all([a, b])).every(r => r.success)).toBe(true)
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.insert).toHaveBeenCalledTimes(1)
  })

  it('does not discard distinct edits submitted while completion is in flight', async () => {
    const store = makeStore()
    const update = store.update
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    store.update = vi.fn(async <K extends TableName>(table: K, id: string | number, patch: Partial<Tables[K]>) => {
      await gate
      return update(table, id, patch)
    })
    const original = store.tasks[0]
    const completion = toggleTaskDone(store, original)
    const edited = saveTask(store, original, { title: 'Saved during completion', status: 'done' })
    release()
    const results = await Promise.all([completion, edited])
    expect(results.every(r => r.success)).toBe(true)
    expect(store.tasks[0].title).toBe('Saved during completion')
    expect(store.tasks.filter(t => t.recurrence_parent_id === original.id)).toHaveLength(1)
  })

  it('keeps queued saves aware of a new successor before React supplies a fresh snapshot', async () => {
    const store = makeStore()
    const staleSnapshot = { ...store, tasks: store.tasks.map(t => ({ ...t })) }
    const original = staleSnapshot.tasks[0]
    const completion = toggleTaskDone(staleSnapshot, original)
    const edited = saveTask(staleSnapshot, original, { title: 'Edited from a stale render', status: 'done' })
    const results = await Promise.all([completion, edited])
    expect(results.every(r => r.success)).toBe(true)
    expect(store.tasks[0].title).toBe('Edited from a stale render')
    expect(store.insert).toHaveBeenCalledTimes(1)
  })

  it('continues a distinct queued save when the preceding save fails', async () => {
    const store = makeStore()
    vi.mocked(store.update).mockResolvedValueOnce(false)
    const original = store.tasks[0]
    const failed = toggleTaskDone(store, original)
    const edited = saveTask(store, original, { title: 'Saved after a failed request', status: 'done' })
    expect((await failed).success).toBe(false)
    expect((await edited).success).toBe(true)
    expect(store.tasks[0]).toMatchObject({ title: 'Saved after a failed request', status: 'done' })
    expect(store.insert).toHaveBeenCalledTimes(1)
  })

  it('does not create a successor when completion fails to save', async () => {
    const store = makeStore()
    vi.mocked(store.update).mockResolvedValue(false)
    const result = await toggleTaskDone(store, store.tasks[0])
    expect(result.success).toBe(false)
    expect(store.insert).not.toHaveBeenCalled()
  })

  it('reports a failed successor save and lets an already-done task retry', async () => {
    const store = makeStore()
    vi.mocked(store.insert).mockResolvedValueOnce(null)
    const failed = await toggleTaskDone(store, store.tasks[0])
    expect(failed.success).toBe(false)
    expect(failed.task?.status).toBe('done')
    expect(store.toast).toHaveBeenCalledWith(expect.stringContaining('next occurrence could not be saved'), 'error')
    expect(store.toast).not.toHaveBeenCalledWith(expect.stringContaining('scheduled for'))
    const retried = await saveTask(store, failed.task!, { status: 'done' })
    expect(retried.success).toBe(true)
    expect(store.tasks).toHaveLength(2)
  })

  it('retains a newly created original for retry after its successor fails', async () => {
    const store = makeStore([])
    const insert = vi.mocked(store.insert).getMockImplementation()!
    vi.mocked(store.insert).mockImplementationOnce(insert).mockResolvedValueOnce(null)
    const failed = await saveTask(store, undefined, { title: 'New task', status: 'done', recurrence: 'daily', due_date: '2026-10-20' })
    expect(failed.success).toBe(false)
    expect(failed.task).not.toBeNull()
    const retried = await saveTask(store, failed.task!, { status: 'done' })
    expect(retried.success).toBe(true)
    expect(store.tasks).toHaveLength(2)
  })
})
