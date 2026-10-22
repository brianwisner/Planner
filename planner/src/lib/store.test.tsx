import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataProvider, useData, type Store } from './store'

const db = vi.hoisted(() => ({
  notes: 'Original notes' as string | null,
  filters: [] as [string, string, unknown][],
  patch: {} as Record<string, unknown>,
  save: vi.fn(),
}))
vi.mock('./supabase', () => ({ supabase: {
  from: (table: string) => ({
    select: async () => ({ data: table === 'clients' ? [{ id: 'client', name: 'Example client', notes: db.notes }] : [], error: null }),
    update: (patch: Record<string, unknown>) => {
      db.patch = patch
      const query = {
        eq: (column: string, value: unknown) => { db.filters.push(['eq', column, value]); return query },
        is: (column: string, value: unknown) => { db.filters.push(['is', column, value]); return query },
        select: () => db.save(),
      }
      return query
    },
  }),
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel },
  removeChannel: vi.fn(),
} }))

let host: HTMLDivElement
let root: Root
let store: Store
const session = { user: { id: 'owner', email: 'owner@example.com' } } as Session
function Snapshot() {
  const snapshot = useData()
  useEffect(() => { store = snapshot }, [snapshot])
  return <p>{snapshot.clients[0]?.notes ?? 'No notes'}</p>
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  db.notes = 'Original notes'; db.filters = []; db.patch = {}; db.save.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<DataProvider session={session}><Snapshot /></DataProvider>))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('conditional record updates', () => {
  it('matches the original value and waits for the database before updating the display', async () => {
    let resolve!: (result: unknown) => void
    db.save.mockReturnValue(new Promise(done => { resolve = done }))
    let pending!: Promise<boolean>
    act(() => { pending = store.conditionalUpdate('clients', 'client', { notes: 'Saved notes' }, { notes: 'Original notes' }) })
    expect(host.textContent).toBe('Original notes')
    expect(db.filters).toEqual([['eq', 'id', 'client'], ['eq', 'notes', 'Original notes']])
    expect(db.patch).toEqual({ notes: 'Saved notes' })
    await act(async () => { resolve({ data: [{ id: 'client', name: 'Example client', notes: 'Saved notes' }], error: null }); expect(await pending).toBe(true) })
    expect(host.textContent).toBe('Saved notes')
  })

  it('uses IS NULL for existing nullable notes', async () => {
    db.save.mockResolvedValue({ data: [{ id: 'client', name: 'Example client', notes: 'First note' }], error: null })
    await act(async () => { expect(await store.conditionalUpdate('clients', 'client', { notes: 'First note' }, { notes: null })).toBe(true) })
    expect(db.filters).toContainEqual(['is', 'notes', null])
  })

  it('does not claim success on a conflict and reloads the saved version', async () => {
    db.notes = 'Changed elsewhere'
    db.save.mockResolvedValue({ data: [], error: null })
    await act(async () => { expect(await store.conditionalUpdate('clients', 'client', { notes: 'My draft' }, { notes: 'Original notes' })).toBe(false) })
    expect(host.textContent).toBe('Changed elsewhere')
  })

  it('leaves the displayed value alone after a failed write', async () => {
    db.save.mockResolvedValue({ data: null, error: { message: 'Connection failed' } })
    await act(async () => { expect(await store.conditionalUpdate('clients', 'client', { notes: 'My draft' }, { notes: 'Original notes' })).toBe(false) })
    expect(host.textContent).toBe('Original notes')
  })
})
