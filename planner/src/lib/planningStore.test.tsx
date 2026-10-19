// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningProvider, useOptionalPlanning, usePlanning } from './planningStore'
import type { PlanningStore } from './planningTypes'

type Row = Record<string, unknown>
const mock = vi.hoisted(() => ({
  data: {} as Record<string, Row[]>, calls: [] as { table: string; action: string; payload?: Row; filters: [string, unknown][] }[],
  fail: '' as string, gate: null as Promise<void> | null, readError: '', rpcError: false,
  toast: vi.fn(), businessRefresh: vi.fn(async () => {}), removeChannel: vi.fn(async () => {}), rpc: vi.fn(),
}))
vi.mock('./store', () => ({ useData: () => ({ toast: mock.toast, refresh: mock.businessRefresh }) }))
vi.mock('./supabase', () => ({ supabase: {
  from(table: string) {
    let action = 'read', payload: Row | undefined, first = 0, last = Infinity
    const filters: [string, unknown][] = []
    async function execute(single = false, maybe = false) {
      mock.calls.push({ table, action, payload, filters: [...filters] })
      if (action === 'read' && mock.readError === table) return { data: null, error: { message: 'Synthetic load failure' } }
      if (action !== 'read' && mock.gate) { const gate = mock.gate; mock.gate = null; await gate }
      const matches = (row: Row) => filters.every(([key, value]) => row[key] === value)
      let rows = (mock.data[table] ?? []).filter(matches)
      if (action === 'insert') {
        if ((mock.data[table] ?? []).some(row => row.id === payload?.id)) return { data: null, error: { message: 'Duplicate ID' } }
        const row = { ...payload, ...(typeof payload?.completed_at === 'string' ? { completed_at: payload.completed_at.replace(/Z$/, '+00:00') } : {}), revision: 1, created_at: '2026-10-19T10:00:00Z', updated_at: '2026-10-19T10:00:00Z', ...(table === 'daily_reviews' ? { checkpoint_at: '2026-10-19T10:00:00Z' } : {}) }
        mock.data[table].push(row); rows = [row]
      }
      if (action === 'update') { rows = rows.map(row => ({ ...row, ...payload, revision: Number(row.revision) + 1 })); mock.data[table] = mock.data[table].map(row => rows.find(updated => updated.id === row.id) ?? row) }
      if (action === 'delete') mock.data[table] = mock.data[table].filter(row => !matches(row))
      if (action !== 'read' && mock.fail) {
        const failure = mock.fail; mock.fail = ''
        if (failure === 'throw') throw new Error('Response lost after commit')
        return { data: null, error: { message: 'Response lost after commit' } }
      }
      rows = rows.slice(first, last + 1)
      return { data: single || maybe ? rows[0] ?? null : rows, error: single && rows.length !== 1 ? { message: 'No matching revision' } : null }
    }
    const query = {
      select() { return query }, order() { return query }, range(a: number, b: number) { first = a; last = b; return query },
      eq(key: string, value: unknown) { filters.push([key, value]); return query },
      insert(row: Row) { action = 'insert'; payload = row; return query }, update(row: Row) { action = 'update'; payload = row; return query }, delete() { action = 'delete'; return query },
      single() { return execute(true) }, maybeSingle() { return execute(false, true) },
      then(resolve: (result: unknown) => unknown, reject: (reason: unknown) => unknown) { return execute().then(resolve, reject) },
    }
    return query
  },
  channel: () => ({ on() { return this }, subscribe() { return this } }),
  removeChannel: mock.removeChannel,
  rpc: (...args: unknown[]) => { mock.rpc(...args); return Promise.resolve({ data: !mock.rpcError, error: mock.rpcError ? { message: 'Stale schedule' } : null }) },
} }))
const id = '00000000-0000-4000-8000-000000000001'
const session = { user: { id: 'owner' } } as Session
const saved = (patch: Row = {}) => ({ id, revision: 1, review_date: '2026-10-19', notes: 'Original', priorities: [], checkpoint_at: '2026-10-19T09:00:00Z', completed_at: null, created_at: '', updated_at: '', ...patch })
let root: Root, container: HTMLDivElement, current: PlanningStore
function Probe() { const value = usePlanning(); useEffect(() => { current = value }, [value]); return <output>{value.reviews.map(row => row.notes).join(',')}</output> }
async function render(active: Session | null = session) { await act(async () => root.render(<PlanningProvider session={active}><Probe /></PlanningProvider>)) }
const mutations = () => mock.calls.filter(call => call.action !== 'read')
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mock.data = Object.fromEntries(['daily_reviews', 'follow_ups', 'daily_availability', 'availability_blocks', 'job_planning', 'job_decisions', 'planning_events'].map(table => [table, []]))
  mock.calls = []; mock.fail = ''; mock.gate = null; mock.readError = ''; mock.rpcError = false
  mock.toast.mockClear(); mock.businessRefresh.mockClear(); mock.rpc.mockClear(); mock.removeChannel.mockClear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('revision-checked planning persistence', () => {
  it('loads without writes, pages activity beyond 1,000, and clears data on logout', async () => {
    mock.data.daily_reviews = [saved()]
    mock.data.planning_events = Array.from({ length: 1001 }, (_, index) => ({ id: String(index) }))
    await render()
    expect(current.events).toHaveLength(1001); expect(current.reviews).toHaveLength(1); expect(current.loading).toBe(false)
    expect(mutations()).toEqual([])
    await render(null)
    expect(current.reviews).toEqual([]); expect(current.events).toEqual([])
    expect(await current.save('daily_reviews', { id, review_date: '2026-10-19' })).toBeNull()
    expect(mutations()).toEqual([])
  })
  it('strips caller metadata and returns the server-assigned first-save cutoff', async () => {
    await render()
    let result: Awaited<ReturnType<PlanningStore['save']>>
    await act(async () => { result = await current.save('daily_reviews', { id, review_date: '2026-10-19', priorities: [], notes: 'First save', checkpoint_at: '1900-01-01', revision: 99 }) })
    expect(result!).toMatchObject({ id, revision: 1, checkpoint_at: '2026-10-19T10:00:00Z' })
    expect(mutations()[0].payload).not.toHaveProperty('revision'); expect(mutations()[0].payload).not.toHaveProperty('checkpoint_at')
    expect(current.reviews[0].notes).toBe('First save')
  })
  it('rejects stale updates, refreshes the latest record and does not overwrite another draft', async () => {
    mock.data.daily_reviews = [saved({ revision: 2, notes: 'Changed elsewhere' })]
    await render()
    let result: unknown
    await act(async () => { result = await current.save('daily_reviews', { id, notes: 'My draft' }, 1) })
    expect(result).toBeNull(); expect(current.reviews[0].notes).toBe('Changed elsewhere')
    expect(mutations()[0].filters).toEqual([['id', id], ['revision', 1]])
    expect(mock.toast).toHaveBeenCalledWith(expect.stringContaining('Your draft is kept'), 'error')
  })
  it('does not optimistically remove records and refuses stale deletes', async () => {
    mock.data.daily_reviews = [saved({ revision: 2 })]; await render()
    let result = true
    await act(async () => { result = await current.remove('daily_reviews', id, 1) })
    expect(result).toBe(false); expect(current.reviews).toHaveLength(1)
    await act(async () => { result = await current.remove('daily_reviews', id, 2) })
    expect(result).toBe(true); expect(current.reviews).toEqual([])
  })
  it.each(['returned error', 'throw'])('proves a lost insert response from stable ID/payload/revision without reinserting (%s)', async failure => {
    await render(); mock.fail = failure
    let result: unknown
    await act(async () => { result = await current.save('daily_reviews', { id, review_date: '2026-10-19', notes: 'Confirmed draft', priorities: [] }) })
    expect(result).toMatchObject({ id, revision: 1, notes: 'Confirmed draft' })
    expect(mutations()).toHaveLength(1); expect(mock.data.daily_reviews).toHaveLength(1)
    expect(mock.toast).not.toHaveBeenCalled()
  })
  it('does not mistake an existing different payload for a successful retried insert', async () => {
    mock.data.daily_reviews = [saved()]; await render()
    let result: unknown
    await act(async () => { result = await current.save('daily_reviews', { id, notes: 'Different content' }) })
    expect(result).toBeNull(); expect(current.reviews[0].notes).toBe('Original')
  })
  it('proves equivalent Postgres timestamp offsets without rounding away differing microseconds', async () => {
    await render(); mock.fail = 'returned error'
    let result: unknown
    await act(async () => { result = await current.save('daily_reviews', { id, notes: 'Completed review', completed_at: '2026-10-19T10:00:00.123Z' }) })
    expect(result).toMatchObject({ completed_at: '2026-10-19T10:00:00.123+00:00' })
    mock.data.daily_reviews[0].completed_at = '2026-10-19T10:00:00.123001+00:00'
    await act(async () => { result = await current.save('daily_reviews', { id, notes: 'Completed review', completed_at: '2026-10-19T10:00:00.123000Z' }) })
    expect(result).toBeNull()
  })
  it('blocks duplicate and competing save/delete actions while retaining the visible record until confirmation', async () => {
    mock.data.daily_reviews = [saved()]; await render()
    let release!: () => void; mock.gate = new Promise(resolve => { release = resolve })
    let first!: Promise<unknown>
    await act(async () => { first = current.save('daily_reviews', { id, notes: 'Confirmed after wait' }, 1) })
    expect(current.reviews[0].notes).toBe('Original')
    await act(async () => { expect(await current.save('daily_reviews', { id, notes: 'Duplicate' }, 1)).toBeNull(); expect(await current.remove('daily_reviews', id, 1)).toBe(false) })
    expect(mutations()).toHaveLength(1)
    await act(async () => { release(); await first })
    expect(current.reviews[0]).toMatchObject({ revision: 2, notes: 'Confirmed after wait' })
  })
  it('reports load errors and recovers through explicit refresh', async () => {
    mock.readError = 'follow_ups'; await render(); expect(current.error).toContain('follow_ups')
    mock.readError = ''; await act(async () => current.refresh()); expect(current.error).toBeNull()
  })
  it('does not publish a pending save or its errors into a signed-out session', async () => {
    mock.data.daily_reviews = [saved()]; await render()
    let release!: () => void; mock.gate = new Promise(resolve => { release = resolve })
    let first!: Promise<unknown>
    await act(async () => { first = current.save('daily_reviews', { id, notes: 'Saved in prior session' }, 1) })
    await render(null)
    await act(async () => { release(); expect(await first).toBeNull() })
    expect(current.reviews).toEqual([]); expect(mock.toast).not.toHaveBeenCalled()
  })
  it('sends atomic move snapshots and refreshes both stores after an unsuccessful move', async () => {
    await render(); mock.rpcError = true
    const moves = [{ id, expected_job_id: 'job', expected_phase_id: null, expected_date: '2026-10-19', expected_hours: 2, date: '2026-10-20', hours: 2 }]
    let result = true
    await act(async () => { result = await current.applyMoves(moves) })
    expect(result).toBe(false)
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('apply_planning_schedule_moves', { p_moves: moves })
    expect(mock.businessRefresh).toHaveBeenCalledWith('schedule_entries'); expect(mutations()).toEqual([])
    expect(mock.toast).toHaveBeenCalledWith(expect.stringContaining('Refresh the preview'), 'error')
  })
  it('supports optional providerless readers without allowing a persistence fallback', async () => {
    function Optional() { return <output>{useOptionalPlanning() === null ? 'No planning provider' : 'Ready'}</output> }
    await act(async () => root.render(<Optional />))
    expect(container.textContent).toBe('No planning provider'); expect(mock.calls).toEqual([])
  })
})
