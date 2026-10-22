import { describe, expect, it } from 'vitest'
import { createMockClient } from './mockSupabase'

type Row = { id: string; client_id: string; status: string; priority: number; client_priority: number }

async function fixture() {
  const db = createMockClient()
  await db.from('clients').insert([{ id: 'client-a', name: 'A' }, { id: 'client-b', name: 'B' }])
  const { data } = await db.from('jobs').insert([
    { id: 'a', client_id: 'client-a', name: 'First', priority: 30 },
    { id: 'closed', client_id: 'client-a', name: 'History', priority: 5, status: 'complete' },
    { id: 'b', client_id: 'client-a', name: 'Second', priority: 20, status: 'on_hold' },
    { id: 'foreign', client_id: 'client-b', name: 'Other', priority: 1 },
  ]).select('*')
  return { db, before: data as Row[] }
}

describe('demo client priorities', () => {
  it('atomically reorders open jobs without changing global priorities, history slots or another client', async () => {
    const { db, before } = await fixture()
    const result = await db.rpc('reorder_client_jobs', { p_client_id: 'client-a', p_expected_ids: ['a', 'b'], p_ordered_ids: ['b', 'a'] })
    expect(result.error).toBeNull()
    const { data } = await db.from('jobs').select('*').in('id', before.map(j => j.id))
    const after = data as Row[]
    expect(after.map(j => [j.id, j.client_priority])).toEqual([['a', 3], ['closed', 2], ['b', 1], ['foreign', 1]])
    expect(after.map(j => [j.id, j.priority])).toEqual(before.map(j => [j.id, j.priority]))
  })

  it('rejects stale, duplicate and cross-client input without a partial write', async () => {
    const { db, before } = await fixture()
    for (const args of [
      { p_expected_ids: ['b', 'a'], p_ordered_ids: ['a', 'b'] },
      { p_expected_ids: ['a', 'b'], p_ordered_ids: ['b', 'b'] },
      { p_expected_ids: ['a', 'b'], p_ordered_ids: ['a', 'foreign'] },
    ]) expect((await db.rpc('reorder_client_jobs', { p_client_id: 'client-a', ...args })).error).not.toBeNull()
    const { data } = await db.from('jobs').select('*').in('id', before.map(j => j.id))
    expect(data).toEqual(before)
  })

  it('appends new and moved jobs after the client’s existing order', async () => {
    const { db } = await fixture()
    await db.rpc('reorder_client_jobs', { p_client_id: 'client-a', p_expected_ids: ['a', 'b'], p_ordered_ids: ['b', 'a'] })
    const { data: inserted } = await db.from('jobs').insert({ client_id: 'client-a', name: 'New', priority: 1 }).select('*').single()
    expect((inserted as Row).client_priority).toBe(4)
    await db.from('jobs').update({ client_id: 'client-a' }).eq('id', 'foreign')
    const { data: moved } = await db.from('jobs').select('*').eq('id', 'foreign').single()
    expect(moved).toMatchObject({ priority: 1, client_priority: 5 })
    const stale = await db.rpc('reorder_client_jobs', { p_client_id: 'client-a', p_expected_ids: ['b', 'a'], p_ordered_ids: ['a', 'b'] })
    expect(stale.error?.code).toBe('40001')
  })
})
