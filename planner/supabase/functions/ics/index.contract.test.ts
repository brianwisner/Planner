// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
type Tables = Record<'profiles' | 'jobs' | 'phases' | 'tasks', Row[]>
type Handler = (request: Request) => Promise<Response>
const NOW = '2026-10-20T06:30:15.123Z'
const OWNER = 'synthetic-owner'
const TOKEN = 'synthetic-feed-token'

const job = (overrides: Row = {}): Row => ({ id: 'job', name: 'Synthetic residence', due_date: '2026-11-01', status: 'active', ...overrides })
const phase = (overrides: Row = {}): Row => ({ id: 'phase', job_id: 'job', kind: 'design', name: 'Original design', due_date: '2026-11-01', status: 'not_started', assignee_id: OWNER, ...overrides })
const task = (overrides: Row = {}): Row => ({ id: 'task', job_id: 'job', title: 'Review plans', due_date: '2026-11-01', scheduled_at: null, is_site_visit: false, status: 'todo', assignee_id: OWNER, ...overrides })

// Execute the deployed entrypoint itself, replacing only its external SDK import.
// This VM has no process, credentials, Deno runtime, or working network access.
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const sdkImport = /^import \{ createClient \} from 'npm:@supabase\/supabase-js@2'\r?\n/m
if (!sdkImport.test(source)) throw new Error('ICS SDK import changed; review the isolated function harness')
const compiled = ts.transpileModule(source.replace(sdkImport, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  reportDiagnostics: true,
})
if (compiled.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error('ICS function failed to transpile')

function harness(input: Partial<Tables> = {}) {
  const tables: Tables = {
    profiles: [{ id: OWNER, full_name: 'Synthetic Owner', ics_token: TOKEN }],
    jobs: [job()], phases: [], tasks: [], ...input,
  }
  const calls: Array<{ table: string; method: string; args: unknown[] }> = []
  const from = vi.fn((table: keyof Tables) => {
    if (!(table in tables)) throw new Error(`Unexpected table: ${table}`)
    let rows = [...tables[table]]
    const query = {
      select(columns: string) { calls.push({ table, method: 'select', args: [columns] }); return query },
      eq(column: string, value: unknown) { calls.push({ table, method: 'eq', args: [column, value] }); rows = rows.filter(row => row[column] === value); return query },
      neq(column: string, value: unknown) { calls.push({ table, method: 'neq', args: [column, value] }); rows = rows.filter(row => row[column] !== value); return query },
      maybeSingle() { calls.push({ table, method: 'maybeSingle', args: [] }); return Promise.resolve({ data: rows[0] ?? null }) },
      then(resolve: (result: { data: Row[] }) => unknown) { return Promise.resolve({ data: rows }).then(resolve) },
    }
    return query
  })
  let handler: Handler | undefined
  const createClient = vi.fn(() => ({ from }))
  const fetch = vi.fn(() => { throw new Error('Network access is forbidden in the ICS contract tests') })
  runInNewContext(compiled.outputText, {
    createClient, Request, Response, URL, Date, fetch,
    Deno: {
      env: { get(name: string) {
        if (name === 'SUPABASE_URL') return 'https://synthetic.invalid'
        if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'synthetic-service-role-placeholder'
        throw new Error(`Unexpected environment read: ${name}`)
      } },
      serve(callback: Handler) { handler = callback },
    },
  }, { timeout: 1000 })
  if (!handler) throw new Error('ICS function did not register its handler')
  const registered = handler
  return {
    calls, createClient, from, fetch,
    request: (query = `token=${TOKEN}`) => registered(new Request(`https://synthetic.invalid/functions/v1/ics?${query}`)),
  }
}

function events(text: string) {
  return new Map([...text.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)\r\nEND:VEVENT/g)].map(match => {
    const lines = match[1].split('\r\n')
    const uid = lines.find(line => line.startsWith('UID:'))!.slice(4)
    const summary = lines.find(line => line.startsWith('SUMMARY:'))!.slice(8)
    return [uid, { summary, lines }]
  }))
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW)) })
afterEach(() => vi.useRealTimers())

describe('ICS function completion contract', () => {
  it('keeps completed-job history and marks all child dates completed without changing their saved statuses', async () => {
    const pendingPhase = phase({ status: 'waiting' })
    const pendingTask = task()
    const visit = task({ id: 'visit', title: 'Inspect framing', due_date: null, scheduled_at: '2026-11-01T01:30:00-07:00', is_site_visit: true })
    const app = harness({ jobs: [job({ status: 'complete' })], phases: [pendingPhase], tasks: [pendingTask, visit] })
    const response = await app.request()
    const feed = events(await response.text())
    expect([...feed.keys()]).toEqual(['job-job@wisner-planner', 'phase-phase@wisner-planner', 'task-task@wisner-planner', 'task-visit@wisner-planner'])
    expect([...feed.values()].map(event => event.summary)).toEqual([
      '✓ Job due: Synthetic residence', '✓ Design due — Synthetic residence', '✓ Review plans', '✓ Site visit: Inspect framing',
    ])
    expect(pendingPhase.status).toBe('waiting')
    expect(pendingTask.status).toBe('todo')
    expect(visit.status).toBe('todo')
    expect(app.fetch).not.toHaveBeenCalled()
  })

  it.each(['active', 'on_hold'])('retains each child status independently for %s jobs', async status => {
    const app = harness({ jobs: [job({ status })], phases: [phase(), phase({ id: 'finished', status: 'complete' })], tasks: [task(), task({ id: 'finished', status: 'done' })] })
    const feed = events(await (await app.request()).text())
    expect(feed.get('job-job@wisner-planner')?.summary).toBe('Job due: Synthetic residence')
    expect(feed.get('phase-phase@wisner-planner')?.summary).toBe('Design due — Synthetic residence')
    expect(feed.get('task-task@wisner-planner')?.summary).toBe('Review plans')
    expect(feed.get('phase-finished@wisner-planner')?.summary).toBe('✓ Design due — Synthetic residence')
    expect(feed.get('task-finished@wisner-planner')?.summary).toBe('✓ Review plans')
  })

  it('continues excluding cancelled/archived jobs and children, including orphan records', async () => {
    const jobs = [job(), job({ id: 'cancelled', status: 'cancelled' }), job({ id: 'archived', status: 'archived' })]
    const app = harness({ jobs, phases: ['job', 'cancelled', 'archived', 'missing'].map(id => phase({ id, job_id: id })), tasks: ['job', 'cancelled', 'archived', 'missing'].map(id => task({ id, job_id: id })) })
    const feed = events(await (await app.request()).text())
    expect([...feed.keys()]).toEqual(['job-job@wisner-planner', 'phase-job@wisner-planner', 'task-job@wisner-planner'])
    expect(app.calls.filter(call => call.table === 'jobs')).toEqual([
      { table: 'jobs', method: 'select', args: ['id, name, due_date, status'] },
      { table: 'jobs', method: 'neq', args: ['status', 'archived'] },
      { table: 'jobs', method: 'neq', args: ['status', 'cancelled'] },
    ])
  })

  it('preserves mine ownership rules while marking the included completed-job children', async () => {
    const app = harness({
      jobs: [job({ status: 'complete' })],
      phases: [phase({ id: 'mine' }), phase({ id: 'other', assignee_id: 'legacy-owner' }), phase({ id: 'unassigned', assignee_id: null })],
      tasks: [task({ id: 'mine' }), task({ id: 'other', assignee_id: 'legacy-owner' }), task({ id: 'unassigned', assignee_id: null })],
    })
    const text = await (await app.request(`token=${TOKEN}&mine=1`)).text()
    const feed = events(text)
    expect([...feed.keys()]).toEqual(['phase-mine@wisner-planner', 'task-mine@wisner-planner', 'task-unassigned@wisner-planner'])
    expect([...feed.values()].every(event => event.summary.startsWith('✓ '))).toBe(true)
    expect(text).toContain('X-WR-CALNAME:Planner — Synthetic Owner\r\n')
  })

  it('retains UTC stamps, one-hour visits without due dates, exclusive all-day ends, and feed headers', async () => {
    const app = harness({ tasks: [task({ id: 'visit', title: 'Inspect, frame; notes\nSecond line', due_date: null, scheduled_at: '2026-11-01T01:30:00-07:00', is_site_visit: true }), task({ id: 'undated', due_date: null })] })
    const response = await app.request()
    const text = await response.text()
    const feed = events(text)
    expect([...feed.keys()]).toEqual(['job-job@wisner-planner', 'task-visit@wisner-planner'])
    expect(feed.get('task-visit@wisner-planner')?.lines).toContain('DTSTART:20261101T083000Z')
    expect(feed.get('task-visit@wisner-planner')?.lines).toContain('DTEND:20261101T093000Z')
    expect(feed.get('task-visit@wisner-planner')?.summary).toBe('Site visit: Inspect\\, frame\\; notes\\nSecond line')
    expect(feed.get('job-job@wisner-planner')?.lines).toContain('DTSTART;VALUE=DATE:20261101')
    expect(feed.get('job-job@wisner-planner')?.lines).toContain('DTEND;VALUE=DATE:20261102')
    expect([...feed.values()].every(event => event.lines.includes('DTSTAMP:20261020T063015Z'))).toBe(true)
    expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=900')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(app.createClient).toHaveBeenCalledWith('https://synthetic.invalid', 'synthetic-service-role-placeholder')
    expect(app.fetch).not.toHaveBeenCalled()
  })

  it('requires the existing feed token before reading job records', async () => {
    const app = harness()
    const missing = await app.request('')
    expect(missing.status).toBe(400)
    expect(await missing.text()).toBe('Missing token')
    expect(app.createClient).not.toHaveBeenCalled()
    const unknown = await app.request('token=unknown-synthetic-token')
    expect(unknown.status).toBe(404)
    expect(await unknown.text()).toBe('Unknown calendar')
    expect(app.from.mock.calls).toEqual([['profiles']])
    expect(app.calls).toContainEqual({ table: 'profiles', method: 'eq', args: ['ics_token', 'unknown-synthetic-token'] })
    expect(app.fetch).not.toHaveBeenCalled()
  })
})
