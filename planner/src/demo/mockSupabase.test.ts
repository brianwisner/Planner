import { describe, expect, it } from 'vitest'
import { createMockClient } from './mockSupabase'
import type { Job, JobType, Phase, Quote } from '../lib/types'

type DemoClient = ReturnType<typeof createMockClient>
type DemoState = { tables: Record<string, Record<string, unknown>[]>; failNext: string | null }
const feeKinds = ['design', 'plan_check', 'construction']
const requestId = '10000000-0000-4000-8000-000000000001'
const secondRequestId = '10000000-0000-4000-8000-000000000002'
const missingId = '10000000-0000-4000-8000-000000000099'

async function quoteFixture() {
  const db = createMockClient()
  const state = (globalThis as unknown as { __demoDB: DemoState }).__demoDB
  const { data: jobs } = await db.from('jobs').select('*') as { data: Job[] }
  const job = jobs[0]
  const { data: phases } = await db.from('phases').select('*').eq('job_id', job.id) as { data: Phase[] }
  const { data: types } = await db.from('job_types').select('*') as { data: JobType[] }
  const quote: Omit<Quote, 'id' | 'created_at'> = {
    job_id: job.id, job_type_id: types.find(type => type.id !== job.job_type_id)!.id,
    rate: 200, design_hours: 20, plan_check_hours: 5, construction_hours: 9,
    site_visits: 2, visit_hours: 3, allowance_hours: 2, rush_percent: 10,
    size: 1200, suggested_fee: 6800, fee: 7000, fee_note: 'Extra coordination',
  }
  const request = {
    p_request_id: requestId, p_quote: quote,
    p_expected: {
      fee: job.fee, job_type_id: job.job_type_id, size: job.size,
      phases: phases.filter(phase => feeKinds.includes(phase.kind)).map(phase => ({ id: phase.id, estimate_hours: phase.estimate_hours })),
    },
  }
  return { db, state, job, phases, request }
}

async function quoteTables(db: DemoClient) {
  return Promise.all(['jobs', 'phases', 'quotes'].map(async table => (await db.from(table).select('*')).data))
}

function feeJob(row: Job | Omit<Quote, 'id' | 'created_at'>) {
  return { fee: row.fee, job_type_id: row.job_type_id, size: row.size }
}

// Demo mode must keep working: it powers screenshots and safe click-through testing.
describe('demo database', () => {
  it('loads sample jobs, each with the five standard phases', async () => {
    const db = createMockClient()
    const { data: jobs } = await db.from('jobs').select('*') as { data: { id: string }[] }
    const { data: phases } = await db.from('phases').select('*') as { data: { job_id: string }[] }
    expect(jobs.length).toBeGreaterThan(10)
    for (const j of jobs) expect(phases.filter(p => p.job_id === j.id)).toHaveLength(5)
  })
  it('adds phases to new jobs and records invoices with their work', async () => {
    const db = createMockClient()
    const { data: job } = await db.from('jobs').insert({ client_id: 'x', name: 'New' }).select('*').single() as { data: { id: string } }
    const { data: phases } = await db.from('phases').select('*').eq('job_id', job.id) as { data: unknown[] }
    expect(phases).toHaveLength(5)
    const { data: entry } = await db.from('time_entries').insert({ job_id: job.id, user_id: 'u', hours: 2 }).select('*').single() as { data: { id: string; rate: number } }
    expect(entry.rate).toBeGreaterThan(0)
    const { data: inv, error } = await db.rpc('record_invoice', { p_job_id: job.id, p_number: 'INV-1', p_amount: 370, p_issued_date: '2026-10-20', p_paid_date: null, p_notes: '', p_links: [{ table: 'time_entries', id: entry.id, amount: 370, depositApplied: 0 }] }).single() as { data: { id: string }; error: unknown }
    expect(error).toBeNull()
    const { data: billed } = await db.from('time_entries').select('*').eq('id', entry.id).single() as { data: { billed: boolean; invoice_id: string } }
    expect(billed).toMatchObject({ billed: true, invoice_id: inv.id })
    await db.from('invoices').delete().eq('id', inv.id)
    const { data: after } = await db.from('time_entries').select('*').eq('id', entry.id).single() as { data: { billed: boolean; invoice_id: string | null } }
    expect(after).toMatchObject({ billed: false, invoice_id: null })
  })
})

describe('demo atomic quotes', () => {
  it('saves the quote, job fields and only fee-phase estimates together', async () => {
    const { db, job, phases, request } = await quoteFixture()
    const before = await quoteTables(db)
    const { data, error } = await db.rpc('record_quote', request).single() as { data: Quote; error: unknown }
    expect(error).toBeNull()
    expect(data).toMatchObject(request.p_quote)
    expect(data.id).toBeTruthy()
    expect(data.created_at).toBeTruthy()
    const { data: afterJob } = await db.from('jobs').select('*').eq('id', job.id).single()
    expect(afterJob).toEqual({ ...job, ...feeJob(request.p_quote) })
    const { data: afterPhases } = await db.from('phases').select('*').eq('job_id', job.id)
    expect(afterPhases).toEqual(phases.map(phase => feeKinds.includes(phase.kind)
      ? { ...phase, estimate_hours: request.p_quote[`${phase.kind}_hours` as keyof typeof request.p_quote] } : phase))
    expect((await quoteTables(db))[2]).toEqual([...(before[2] as Quote[]), data])
  })

  it('returns the original quote for concurrent identical retries and ignores key/phase order', async () => {
    const { db, request } = await quoteFixture()
    const originalCount = ((await quoteTables(db))[2] as Quote[]).length
    const reordered = {
      ...request, p_quote: Object.fromEntries(Object.entries(request.p_quote).reverse()),
      p_expected: { ...request.p_expected, phases: [...request.p_expected.phases].reverse() },
    }
    const [first, retry] = await Promise.all([db.rpc('record_quote', request).single(), db.rpc('record_quote', reordered).single()])
    expect(first.error).toBeNull()
    expect(retry).toEqual(first)
    expect((await quoteTables(db))[2]).toHaveLength(originalCount + 1)
    // An uncertain response retry must not overwrite changes made after the save.
    await db.from('jobs').update({ fee: 12345 }).eq('id', request.p_quote.job_id)
    const changed = await quoteTables(db)
    expect(await db.rpc('record_quote', request).single()).toEqual(first)
    expect(await quoteTables(db)).toEqual(changed)
  })

  it('rejects reuse of a request ID with a different quote or expected snapshot', async () => {
    const { db, request } = await quoteFixture()
    await db.rpc('record_quote', request).single()
    const saved = await quoteTables(db)
    for (const changed of [
      { ...request, p_quote: { ...request.p_quote, fee: 1 } },
      { ...request, p_expected: { ...request.p_expected, fee: 1 } },
    ]) expect((await db.rpc('record_quote', changed).single()).error).toMatchObject({ code: '22023' })
    expect(await quoteTables(db)).toEqual(saved)
  })

  it('normalizes UUIDs like the database while retaining the original quote payload for retries', async () => {
    const { db, request } = await quoteFixture()
    const upper = {
      ...request, p_request_id: requestId.toUpperCase(),
      p_quote: { ...request.p_quote, job_id: request.p_quote.job_id.toUpperCase(), job_type_id: request.p_quote.job_type_id!.toUpperCase() },
      p_expected: {
        ...request.p_expected, job_type_id: request.p_expected.job_type_id!.toUpperCase(),
        phases: request.p_expected.phases.map(phase => ({ ...phase, id: phase.id.toUpperCase() })),
      },
    }
    const saved = await db.rpc('record_quote', upper).single()
    expect(saved.error).toBeNull()
    expect(saved.data).toMatchObject(request.p_quote)
    expect(await db.rpc('record_quote', { ...upper, p_expected: request.p_expected }).single()).toEqual(saved)
  })

  it.each(['edited', 'deleted'])('does not report a successful retry when its saved quote was %s', async change => {
    const { db, request } = await quoteFixture()
    const { data: saved } = await db.rpc('record_quote', request).single() as { data: Quote }
    if (change === 'edited') await db.from('quotes').update({ fee_note: 'Changed elsewhere' }).eq('id', saved.id)
    else await db.from('quotes').delete().eq('id', saved.id)
    const before = await quoteTables(db)
    expect((await db.rpc('record_quote', request).single()).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it('allows only one of two different requests based on the same original snapshot', async () => {
    const { db, request } = await quoteFixture()
    const originalCount = ((await quoteTables(db))[2] as Quote[]).length
    const results = await Promise.all([
      db.rpc('record_quote', request).single(),
      db.rpc('record_quote', { ...request, p_request_id: secondRequestId }).single(),
    ])
    expect(results.filter(result => !result.error)).toHaveLength(1)
    expect(results.filter(result => result.error?.code === '40001')).toHaveLength(1)
    expect((await quoteTables(db))[2]).toHaveLength(originalCount + 1)
  })

  it.each(['fee', 'job_type_id', 'size'] as const)('rejects a stale job %s without changing any rows', async field => {
    const { db, job, request } = await quoteFixture()
    await db.from('jobs').update({ [field]: field === 'job_type_id' ? null : 1 }).eq('id', job.id)
    const before = await quoteTables(db)
    expect((await db.rpc('record_quote', request).single()).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it.each(['hours', 'added', 'deleted', 'moved', 'nonfee'])('rejects stale phase %s before any writes', async change => {
    const { db, phases, job, request } = await quoteFixture()
    const phase = phases.find(row => row.kind === 'design')!
    if (change === 'hours') await db.from('phases').update({ estimate_hours: 999 }).eq('id', phase.id)
    if (change === 'added') await db.from('phases').insert({ job_id: job.id, kind: 'design', name: 'Extra design' })
    if (change === 'deleted') await db.from('phases').delete().eq('id', phase.id)
    if (change === 'moved') await db.from('phases').update({ job_id: missingId }).eq('id', phase.id)
    if (change === 'nonfee') await db.from('phases').update({ kind: 'client_changes' }).eq('id', phase.id)
    const before = await quoteTables(db)
    expect((await db.rpc('record_quote', request).single()).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it('validates the full request before saving', async () => {
    const { db, request } = await quoteFixture()
    const before = await quoteTables(db)
    const badQuotes = [
      { ...request.p_quote, fee: -1 }, { ...request.p_quote, rate: NaN },
      { ...request.p_quote, design_hours: Infinity }, { ...request.p_quote, site_visits: '2' },
      { ...request.p_quote, size: -1 }, { ...request.p_quote, fee_note: null },
      { ...request.p_quote, job_type_id: 'not-a-uuid' }, { ...request.p_quote, job_id: null },
      { ...request.p_quote, id: missingId }, { ...request.p_quote, created_at: '2026-01-01' },
      Object.fromEntries(Object.entries(request.p_quote).filter(([key]) => key !== 'fee')),
    ]
    for (const p_quote of badQuotes) {
      expect((await db.rpc('record_quote', { ...request, p_quote }).single()).error).toMatchObject({ code: '22023' })
    }
    for (const p_expected of [
      { ...request.p_expected, phases: [...request.p_expected.phases, request.p_expected.phases[0]] },
      { ...request.p_expected, phases: [{ id: missingId, estimate_hours: '3' }] },
      { ...request.p_expected, phases: [{ ...request.p_expected.phases[0], extra: true }] },
      { ...request.p_expected, fee: Infinity }, { ...request.p_expected, extra: true }, null,
    ]) expect((await db.rpc('record_quote', { ...request, p_expected }).single()).error).toMatchObject({ code: '22023' })
    expect((await db.rpc('record_quote', { ...request, p_request_id: '' }).single()).error).toMatchObject({ code: '22023' })
    for (const p_quote of [{ ...request.p_quote, job_id: missingId }, { ...request.p_quote, job_type_id: missingId }]) {
      expect((await db.rpc('record_quote', { ...request, p_quote }).single()).error).toMatchObject({ code: '40001' })
    }
    expect(await quoteTables(db)).toEqual(before)
    expect((await db.rpc('record_quote', request).single()).error).toBeNull()
  })

  it.each(['jobs', 'phases', 'quotes', '*'])('a %s save failure leaves no partial writes or receipt and can retry', async table => {
    const { db, state, request } = await quoteFixture()
    const before = await quoteTables(db)
    state.failNext = table
    expect((await db.rpc('record_quote', request).single()).error?.message).toBe('Simulated network failure')
    expect(await quoteTables(db)).toEqual(before)
    expect((await db.rpc('record_quote', request).single()).error).toBeNull()
  })

  it('saves and restores every existing fee phase, including duplicate kinds or a missing kind', async () => {
    const { db, job, request } = await quoteFixture()
    await db.from('phases').delete().eq('job_id', job.id).eq('kind', 'construction')
    await db.from('phases').insert({ job_id: job.id, kind: 'design', name: 'Additional design', estimate_hours: 7 })
    const { data: current } = await db.from('phases').select('*').eq('job_id', job.id) as { data: Phase[] }
    request.p_expected.phases = current.filter(phase => feeKinds.includes(phase.kind)).map(phase => ({ id: phase.id, estimate_hours: phase.estimate_hours }))
    const before = await quoteTables(db)
    expect((await db.rpc('record_quote', request).single()).error).toBeNull()
    const { data: designs } = await db.from('phases').select('*').eq('job_id', job.id).eq('kind', 'design') as { data: Phase[] }
    expect(designs).toHaveLength(2)
    expect(designs.every(phase => phase.estimate_hours === request.p_quote.design_hours)).toBe(true)
    expect(await db.rpc('undo_quote', { p_request_id: requestId })).toEqual({ data: true, error: null })
    expect(await quoteTables(db)).toEqual(before)
  })
})

describe('demo guarded quote undo', () => {
  it('restores original values, preserves other edits and quotes, and cannot replay an undone save', async () => {
    const { db, job, phases, request } = await quoteFixture()
    const before = await quoteTables(db)
    await db.rpc('record_quote', request).single()
    await db.from('jobs').update({ description: 'New scope notes' }).eq('id', job.id)
    await db.from('phases').update({ status: 'complete' }).eq('id', phases[1].id)
    expect(await db.rpc('undo_quote', { p_request_id: requestId })).toEqual({ data: true, error: null })
    const { data: restored } = await db.from('jobs').select('*').eq('id', job.id).single()
    expect(restored).toEqual({ ...job, description: 'New scope notes' })
    const { data: restoredPhases } = await db.from('phases').select('*').eq('job_id', job.id)
    expect(restoredPhases).toEqual(phases.map(phase => phase.id === phases[1].id ? { ...phase, status: 'complete' } : phase))
    expect((await quoteTables(db))[2]).toEqual(before[2])
    const undone = await quoteTables(db)
    expect(await db.rpc('undo_quote', { p_request_id: requestId })).toEqual({ data: true, error: null })
    expect((await db.rpc('record_quote', request).single()).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(undone)
    expect((await db.rpc('record_quote', { ...request, p_request_id: secondRequestId }).single()).error).toBeNull()
    const newer = await quoteTables(db)
    expect(await db.rpc('undo_quote', { p_request_id: requestId })).toEqual({ data: true, error: null })
    expect(await quoteTables(db)).toEqual(newer)
  })

  it.each(['fee', 'job_type_id', 'size'] as const)('refuses to overwrite a later job %s change', async field => {
    const { db, job, request } = await quoteFixture()
    await db.rpc('record_quote', request).single()
    await db.from('jobs').update({ [field]: field === 'job_type_id' ? null : 1 }).eq('id', job.id)
    const before = await quoteTables(db)
    expect((await db.rpc('undo_quote', { p_request_id: requestId })).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it.each(['hours', 'added', 'deleted', 'kind'])('refuses undo after a fee-phase %s change', async change => {
    const { db, phases, job, request } = await quoteFixture()
    await db.rpc('record_quote', request).single()
    const phase = phases.find(row => row.kind === 'design')!
    if (change === 'hours') await db.from('phases').update({ estimate_hours: 999 }).eq('id', phase.id)
    if (change === 'added') await db.from('phases').insert({ job_id: job.id, kind: 'design', name: 'Additional design' })
    if (change === 'deleted') await db.from('phases').delete().eq('id', phase.id)
    if (change === 'kind') await db.from('phases').update({ kind: 'plan_check' }).eq('id', phase.id)
    const before = await quoteTables(db)
    expect((await db.rpc('undo_quote', { p_request_id: requestId })).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it.each(['backdated', 'same-time', 'later'])('rejects undo when a %s quote was inserted afterward', async timing => {
    const { db, request } = await quoteFixture()
    const { data: saved } = await db.rpc('record_quote', request).single() as { data: Quote }
    const created_at = timing === 'same-time' ? saved.created_at : timing === 'backdated' ? '2000-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z'
    await db.from('quotes').insert({ ...request.p_quote, created_at })
    const before = await quoteTables(db)
    expect((await db.rpc('undo_quote', { p_request_id: requestId })).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it.each(['edited', 'deleted'])('refuses undo when its own quote was %s', async change => {
    const { db, request } = await quoteFixture()
    const { data: saved } = await db.rpc('record_quote', request).single() as { data: Quote }
    if (change === 'edited') await db.from('quotes').update({ fee_note: 'Changed elsewhere' }).eq('id', saved.id)
    else await db.from('quotes').delete().eq('id', saved.id)
    const before = await quoteTables(db)
    expect((await db.rpc('undo_quote', { p_request_id: requestId })).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it('refuses undo if the original job type can no longer be restored', async () => {
    const { db, job, request } = await quoteFixture()
    await db.rpc('record_quote', request).single()
    await db.from('job_types').delete().eq('id', job.job_type_id)
    const before = await quoteTables(db)
    expect((await db.rpc('undo_quote', { p_request_id: requestId })).error).toMatchObject({ code: '40001' })
    expect(await quoteTables(db)).toEqual(before)
  })

  it.each(['jobs', 'phases', 'quotes', '*'])('a %s undo failure preserves all rows and can retry', async table => {
    const { db, state, request } = await quoteFixture()
    const before = await quoteTables(db)
    await db.rpc('record_quote', request).single()
    const saved = await quoteTables(db)
    state.failNext = table
    expect((await db.rpc('undo_quote', { p_request_id: requestId })).error?.message).toBe('Simulated network failure')
    expect(await quoteTables(db)).toEqual(saved)
    expect(await db.rpc('undo_quote', { p_request_id: requestId })).toEqual({ data: true, error: null })
    expect(await quoteTables(db)).toEqual(before)
  })

  it('does not mutate anything for an unknown or invalid undo request', async () => {
    const { db } = await quoteFixture()
    const before = await quoteTables(db)
    expect((await db.rpc('undo_quote', { p_request_id: missingId })).error).toMatchObject({ code: '40001' })
    expect((await db.rpc('undo_quote', { p_request_id: 'invalid' })).error).toMatchObject({ code: '22023' })
    expect(await quoteTables(db)).toEqual(before)
  })
})
