import { describe, expect, it } from 'vitest'
import { createMockClient } from './mockSupabase'

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
