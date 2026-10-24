// Demo mode: an in-memory stand-in for the Supabase client so the app can be
// opened, clicked through and screenshotted with made-up data. Nothing here
// talks to the real database. Only the small part of the Supabase API that the
// app uses is implemented.
import { seedData, DEMO_USER } from './seed'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>
type Change = { table: string; eventType: 'INSERT' | 'UPDATE' | 'DELETE' }
type Result = { data: unknown; error: { message: string; code?: string } | null }

const PLANNING = new Set(['daily_reviews', 'follow_ups', 'daily_availability', 'availability_blocks', 'job_planning', 'job_decisions'])

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)))
const nowISO = () => new Date().toISOString()
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const clientOrder = (a: Row, b: Row) => Number(a.client_priority ?? a.priority) - Number(b.client_priority ?? b.priority)
  || Number(a.priority) - Number(b.priority) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))

const DEFAULTS: Record<string, () => Row> = {
  settings: () => ({ business_email: '', minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '', letterhead: '', signature: '', visit_closing: '' }),
  clients: () => ({ contact_name: '', email: '', phone: '', address: '', notes: '', is_sample: false }),
  jobs: () => ({ job_number: '', description: '', address: '', status: 'active', priority: 100, client_priority: null, fee: null, job_type_id: null, size: null, use_in_estimates: true, estimate_note: '', closeout_reason: '', queued_date: null, start_date: null, due_date: null }),
  job_types: () => ({ design_hours: 0, plan_check_hours: 0, construction_hours: 0, site_visits: 0, size_unit: '', keywords: '', notes: '' }),
  past_jobs: () => ({ client: '', address: '', job_type_id: null, date: null, fee: null, hours: null, size: null, scope: '', source: '', use_in_estimates: true }),
  quotes: () => ({ job_type_id: null, rate: 0, design_hours: 0, plan_check_hours: 0, construction_hours: 0, site_visits: 0, visit_hours: 0, allowance_hours: 0, rush_percent: 0, size: null, suggested_fee: 0, fee: 0, fee_note: '' }),
  phases: () => ({ sort_order: 0, status: 'not_started', estimate_hours: 0, start_date: null, due_date: null, assignee_id: null, notes: '' }),
  tasks: () => ({ phase_id: null, description: '', status: 'todo', assignee_id: null, due_date: null, scheduled_at: null, is_site_visit: false, estimate_hours: null, recurrence: 'none', recurrence_parent_id: null, sort_order: 0, completed_at: null, created_by: null }),
  invoices: () => ({ number: '', amount: 0, issued_date: todayISO(), paid_date: null, notes: '' }),
  time_entries: () => ({ phase_id: null, task_id: null, date: todayISO(), hours: null, started_at: null, rate: null, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null }),
  deposits: () => ({ amount: 0, received_date: todayISO(), method: '', notes: '' }),
  schedule_entries: () => ({ phase_id: null, note: '' }),
  job_items: () => ({ date: todayISO(), category: 'Expense', description: '', quantity: 1, unit_price: 0, billed: false, invoice_id: null, deposit_applied: null, created_by: null }),
  comments: () => ({ user_id: null }),
  site_visits: () => ({ task_id: null, visit_date: todayISO(), purpose: '', weather: '', present: '', observations: '', corrections: '', conclusion: '', sent_date: null, user_id: null }),
  site_photos: () => ({ caption: '', sort_order: 0 }),
  plan_check_rounds: () => ({ round: 1, agency: '', reviewer: '', permit_number: '', received_date: null, sent_date: null, notes: '' }),
  plan_check_comments: () => ({ number: '', comment: '', response: '', done: false, sort_order: 0 }),
  daily_availability: () => ({ note: '' }),
}

// Children removed or detached when a parent row is deleted (mirrors the
// foreign keys in supabase/setup.sql).
const CASCADE: Record<string, { table: string; column: string; action: 'delete' | 'null' }[]> = {
  clients: [{ table: 'jobs', column: 'client_id', action: 'delete' }],
  jobs: ['quotes', 'phases', 'tasks', 'invoices', 'time_entries', 'deposits', 'schedule_entries', 'job_items', 'comments', 'job_planning', 'site_visits', 'plan_check_rounds']
    .map(table => ({ table, column: 'job_id', action: 'delete' as const })),
  phases: [{ table: 'tasks', column: 'phase_id', action: 'delete' }, { table: 'time_entries', column: 'phase_id', action: 'null' }, { table: 'schedule_entries', column: 'phase_id', action: 'delete' }],
  tasks: [{ table: 'time_entries', column: 'task_id', action: 'null' }, { table: 'tasks', column: 'recurrence_parent_id', action: 'null' }, { table: 'site_visits', column: 'task_id', action: 'null' }],
  site_visits: [{ table: 'site_photos', column: 'visit_id', action: 'delete' }],
  plan_check_rounds: [{ table: 'plan_check_comments', column: 'round_id', action: 'delete' }],
  job_types: [{ table: 'jobs', column: 'job_type_id', action: 'null' }, { table: 'past_jobs', column: 'job_type_id', action: 'null' }, { table: 'quotes', column: 'job_type_id', action: 'null' }],
  invoices: [{ table: 'time_entries', column: 'invoice_id', action: 'null' }, { table: 'job_items', column: 'invoice_id', action: 'null' }],
}

class MockDB {
  tables: Tables
  listeners = new Set<(c: Change) => void>()
  failNext: string | null = null
  constructor(tables: Tables) { this.tables = tables }
  rows(table: string) { return (this.tables[table] ??= []) }
  emit(table: string, eventType: Change['eventType']) {
    for (const l of this.listeners) setTimeout(() => l({ table, eventType }), 20)
  }

  prepareInsert(table: string, input: Row): Row {
    const row: Row = { id: uuid(), created_at: nowISO(), ...(DEFAULTS[table]?.() ?? {}), ...input }
    if (table === 'jobs') row.client_priority = this.nextClientPriority(row.client_id)
    if (table === 'time_entries' && row.rate == null) {
      const profile = this.rows('profiles').find(p => p.id === row.user_id)
      row.rate = (profile?.hourly_rate as number | null) ?? (this.rows('settings')[0]?.default_rate as number) ?? 150
    }
    if (PLANNING.has(table)) Object.assign(row, { revision: 1, updated_at: nowISO() })
    this.normalizeBilling(table, row, undefined)
    return row
  }

  nextClientPriority(clientId: unknown, exceptId?: unknown) {
    return Math.max(0, ...this.rows('jobs').filter(j => j.client_id === clientId && j.id !== exceptId).map(j => Number(j.client_priority ?? j.priority))) + 1
  }

  // Same rule as the database trigger: work that is not on an invoice keeps no credit.
  normalizeBilling(table: string, row: Row, old: Row | undefined) {
    if (table !== 'time_entries' && table !== 'job_items') return
    if (old && old.invoice_id && row.invoice_id == null) row.billed = false
    if (!row.billed || row.invoice_id == null) row.deposit_applied = null
  }

  afterInsert(table: string, row: Row) {
    if (table === 'jobs') {
      const kinds: [string, string][] = [['bidding', 'Bidding'], ['design', 'Original design'], ['plan_check', 'County / plan-check comments'], ['construction', 'Construction changes'], ['client_changes', 'Client-requested changes']]
      kinds.forEach(([kind, name], i) => this.rows('phases').push(this.prepareInsert('phases', { job_id: row.id, kind, name, sort_order: i + 1 })))
      this.emit('phases', 'INSERT')
    }
  }

  deleteRows(table: string, victims: Row[]) {
    if (!victims.length) return
    const ids = new Set(victims.map(v => v.id))
    this.tables[table] = this.rows(table).filter(r => !ids.has(r.id))
    for (const rule of CASCADE[table] ?? []) {
      const children = this.rows(rule.table).filter(r => ids.has(r[rule.column]))
      if (!children.length) continue
      if (rule.action === 'delete') this.deleteRows(rule.table, children)
      else {
        for (const c of children) { const old = { ...c }; c[rule.column] = null; this.normalizeBilling(rule.table, c, old) }
        this.emit(rule.table, 'UPDATE')
      }
    }
    this.emit(table, 'DELETE')
  }
}

type Filter = (r: Row) => boolean
const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b))

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private payload: Row | Row[] | null = null
  private filters: Filter[] = []
  private orders: { col: string; asc: boolean }[] = []
  private from_ = 0
  private to_: number | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private returning = false
  private db: MockDB
  private table: string
  constructor(db: MockDB, table: string) { this.db = db; this.table = table }

  select(_columns?: string) { void _columns; if (this.op !== 'select') this.returning = true; return this }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = rows; return this }
  upsert(rows: Row | Row[]) { this.op = 'upsert'; this.payload = rows; return this }
  update(patch: Row) { this.op = 'update'; this.payload = patch; return this }
  delete() { this.op = 'delete'; return this }
  eq(col: string, v: unknown) { this.filters.push(r => same(r[col], v)); return this }
  neq(col: string, v: unknown) { this.filters.push(r => !same(r[col], v)); return this }
  in(col: string, vs: unknown[]) { this.filters.push(r => vs.some(v => same(r[col], v))); return this }
  is(col: string, v: unknown) { this.filters.push(r => (r[col] ?? null) === v); return this }
  gte(col: string, v: string | number) { this.filters.push(r => (r[col] as string | number) >= v); return this }
  lte(col: string, v: string | number) { this.filters.push(r => (r[col] as string | number) <= v); return this }
  gt(col: string, v: string | number) { this.filters.push(r => (r[col] as string | number) > v); return this }
  lt(col: string, v: string | number) { this.filters.push(r => (r[col] as string | number) < v); return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orders.push({ col, asc: opts?.ascending !== false }); return this }
  range(from: number, to: number) { this.from_ = from; this.to_ = to; return this }
  limit(n: number) { this.to_ = this.from_ + n - 1; return this }
  single() { this.mode = 'single'; return this }
  maybeSingle() { this.mode = 'maybe'; return this }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return new Promise<Result>(resolve => setTimeout(() => resolve(this.run()), 25)).then(ok, bad)
  }

  private shape(rows: Row[]): Result {
    const out = clone(rows)
    if (this.mode === 'many') return { data: out, error: null }
    if (out.length === 1) return { data: out[0], error: null }
    if (this.mode === 'maybe' && out.length === 0) return { data: null, error: null }
    return { data: null, error: { message: out.length ? 'More than one row returned' : 'No rows found' } }
  }

  private run(): Result {
    const db = this.db, table = this.table
    if (db.failNext && (db.failNext === table || db.failNext === '*') && this.op !== 'select') {
      db.failNext = null
      return { data: null, error: { message: 'Simulated network failure' } }
    }
    const matched = () => db.rows(table).filter(r => this.filters.every(f => f(r)))
    switch (this.op) {
      case 'select': {
        let rows = matched()
        for (const o of [...this.orders].reverse()) rows = [...rows].sort((a, b) => {
          const x = a[o.col] as string, y = b[o.col] as string
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1)
        })
        rows = rows.slice(this.from_, this.to_ == null ? undefined : this.to_ + 1)
        return this.shape(rows)
      }
      case 'insert':
      case 'upsert': {
        const input = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
        const created: Row[] = []
        for (const raw of input) {
          const existing = this.op === 'upsert' && raw.id != null ? db.rows(table).find(r => same(r.id, raw.id)) : undefined
          if (existing) {
            const moved = table === 'jobs' && raw.client_id != null && raw.client_id !== existing.client_id
            Object.assign(existing, raw)
            if (moved) existing.client_priority = db.nextClientPriority(existing.client_id, existing.id)
            created.push(existing); continue
          }
          const row = db.prepareInsert(table, raw)
          db.rows(table).push(row)
          created.push(row)
          db.afterInsert(table, row)
        }
        db.emit(table, 'INSERT')
        return this.returning ? this.shape(created) : { data: null, error: null }
      }
      case 'update': {
        const rows = matched()
        for (const r of rows) {
          const old = { ...r }
          Object.assign(r, clone(this.payload as Row))
          if (table === 'jobs' && r.client_id !== old.client_id) r.client_priority = db.nextClientPriority(r.client_id, r.id)
          if (PLANNING.has(table)) { r.revision = (old.revision as number) + 1; r.updated_at = nowISO(); r.created_at = old.created_at }
          db.normalizeBilling(table, r, old)
        }
        if (rows.length) db.emit(table, 'UPDATE')
        return this.returning ? this.shape(rows) : { data: null, error: null }
      }
      case 'delete': {
        const rows = matched()
        db.deleteRows(table, rows)
        return this.returning ? this.shape(rows) : { data: null, error: null }
      }
    }
  }
}

class Rpc implements PromiseLike<Result> {
  private mode: 'many' | 'single' = 'many'
  private db: MockDB
  private name: string
  private args: Record<string, unknown>
  constructor(db: MockDB, name: string, args: Record<string, unknown>) { this.db = db; this.name = name; this.args = args }
  single() { this.mode = 'single'; return this }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return new Promise<Result>(resolve => setTimeout(() => resolve(this.run()), 40)).then(ok, bad)
  }
  private run(): Result {
    const db = this.db, a = this.args
    if (this.name === 'reorder_client_jobs') {
      if (db.failNext === 'jobs' || db.failNext === '*') {
        db.failNext = null
        return { data: null, error: { message: 'Simulated network failure' } }
      }
      const clientJobs = db.rows('jobs').filter(j => j.client_id === a.p_client_id).sort(clientOrder)
      const current = clientJobs.filter(j => j.status === 'active' || j.status === 'on_hold').map(j => j.id)
      const expected = a.p_expected_ids as string[] | null, ordered = a.p_ordered_ids as string[] | null
      if (!db.rows('clients').some(c => c.id === a.p_client_id) || !expected || !ordered) {
        return { data: null, error: { message: 'Invalid client job order.' } }
      }
      if (JSON.stringify(current) !== JSON.stringify(expected)) {
        return { data: null, error: { message: 'The client job list changed. Refresh and try again.', code: '40001' } }
      }
      if (ordered.length !== expected.length || new Set(ordered).size !== ordered.length || ordered.some(id => !expected.includes(id))) {
        return { data: null, error: { message: 'The new order must contain each open client job exactly once.' } }
      }
      let index = 0
      const byId = new Map(clientJobs.map(j => [j.id, j]))
      const next = clientJobs.map(j => expected.includes(String(j.id)) ? byId.get(ordered[index++])! : j)
      next.forEach((j, i) => { j.client_priority = i + 1 })
      db.emit('jobs', 'UPDATE')
      return { data: null, error: null }
    }
    if (this.name === 'record_invoice') {
      const invoice = db.prepareInsert('invoices', { job_id: a.p_job_id, number: a.p_number ?? '', amount: a.p_amount, issued_date: a.p_issued_date, paid_date: a.p_paid_date ?? null, notes: a.p_notes ?? '' })
      db.rows('invoices').push(invoice)
      for (const link of (a.p_links as { table: string; id: string; depositApplied: number }[]) ?? []) {
        const row = db.rows(link.table).find(r => r.id === link.id)
        if (row) Object.assign(row, { billed: true, invoice_id: invoice.id, deposit_applied: link.depositApplied })
      }
      db.emit('invoices', 'INSERT'); db.emit('time_entries', 'UPDATE'); db.emit('job_items', 'UPDATE')
      return { data: this.mode === 'single' ? clone(invoice) : [clone(invoice)], error: null }
    }
    if (this.name === 'apply_planning_schedule_moves') {
      for (const m of (a.p_moves as { id: string; date: string; hours: number }[]) ?? []) {
        const row = db.rows('schedule_entries').find(r => r.id === m.id)
        if (row) Object.assign(row, { date: m.date, hours: m.hours })
      }
      db.emit('schedule_entries', 'UPDATE')
      return { data: true, error: null }
    }
    return { data: null, error: { message: `Unknown function ${this.name}` } }
  }
}

// Storage stand-in: uploaded photos live in memory as object URLs; the sample
// photos in the seed data are drawn as simple pictures.
function createMockStorage() {
  const files = new Map<string, string>()
  const ok = <T,>(data: T) => Promise.resolve({ data, error: null })
  return {
    from: (bucket: string) => ({
      upload: (path: string, file: Blob) => {
        const key = `${bucket}/${path}`
        if (files.has(key)) return Promise.resolve({ data: null, error: { message: 'The resource already exists' } })
        files.set(key, typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : demoPhoto(path))
        return ok({ path })
      },
      createSignedUrls: (paths: string[]) => ok(paths.map(path => ({ path, signedUrl: files.get(`${bucket}/${path}`) ?? demoPhoto(path), error: null }))),
      remove: (paths: string[]) => {
        for (const path of paths) {
          const url = files.get(`${bucket}/${path}`)
          if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
          files.delete(`${bucket}/${path}`)
        }
        return ok(paths.map(name => ({ name })))
      },
    }),
  }
}

/** A simple drawing standing in for a site photo in the demo (picked by words in the file name). */
export function demoPhoto(path: string): string {
  const scenes: Record<string, string> = {
    // OSB shear wall sheathing with nail lines along the studs
    wall: `<rect width="800" height="600" fill="#cfae7a"/><g fill="#b8935c" opacity=".55">${Array.from({ length: 40 }, (_, i) => `<rect x="${(i * 97) % 800}" y="${(i * 61) % 600}" width="${30 + (i % 5) * 9}" height="${8 + (i % 3) * 5}" rx="3" transform="rotate(${(i * 37) % 180} ${(i * 97) % 800} ${(i * 61) % 600})"/>`).join('')}</g><path d="M400 0V600M0 300H800" stroke="#8a6a3c" stroke-width="5"/><g fill="#3a3a3a">${[96, 400, 704].flatMap(x => Array.from({ length: 19 }, (_, i) => `<circle cx="${x}" cy="${16 + i * 32}" r="4"/>`)).join('')}${Array.from({ length: 24 }, (_, i) => `<circle cx="${16 + i * 33}" cy="300" r="4"/>`).join('')}</g>`,
    // A hold-down bracket bolted to a post above a concrete curb
    holdown: `<rect width="800" height="600" fill="#d8c19a"/><rect x="300" y="0" width="200" height="470" fill="#c79a5b"/><path d="M300 0v470M500 0v470" stroke="#9c7440" stroke-width="4"/><rect x="0" y="470" width="800" height="130" fill="#a9a9a6"/><rect x="340" y="150" width="120" height="330" rx="6" fill="#8d959e"/><rect x="352" y="160" width="96" height="300" rx="4" fill="#a7aeb6"/><g fill="#5b6168">${[200, 250, 300, 350, 400].map(y => `<circle cx="400" cy="${y}" r="11"/>`).join('')}</g><rect x="392" y="440" width="16" height="70" fill="#6b7178"/><rect x="376" y="452" width="48" height="14" rx="3" fill="#5b6168"/>`,
    // Footing excavation with rebar before the pour
    footing: `<rect width="800" height="600" fill="#7c5a3b"/><rect x="60" y="170" width="680" height="300" fill="#5e432b"/><rect x="60" y="170" width="680" height="300" fill="none" stroke="#c9a46a" stroke-width="16"/><g stroke="#a4452a" stroke-width="10" stroke-linecap="round">${[230, 290, 350, 410].map(y => `<path d="M90 ${y}H710"/>`).join('')}${Array.from({ length: 12 }, (_, i) => `<path d="M${110 + i * 53} 200V440"/>`).join('')}</g><g fill="#d9d4c7">${Array.from({ length: 6 }, (_, i) => `<rect x="${120 + i * 110}" y="440" width="22" height="16" rx="3"/>`).join('')}</g>`,
  }
  const key = Object.keys(scenes).find(k => path.includes(k)) ?? 'wall'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">${scenes[key]}<rect width="800" height="600" fill="url(#v)"/><defs><radialGradient id="v" cx=".5" cy=".45" r=".75"><stop offset=".6" stop-opacity="0"/><stop offset="1" stop-opacity=".35"/></radialGradient></defs></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function createMockClient() {
  const db = new MockDB(seedData())
  let session: Row | null = { access_token: 'demo', user: { id: DEMO_USER.id, email: DEMO_USER.email } }
  const authListeners = new Set<(event: string, s: unknown) => void>()
  const notify = (event: string) => authListeners.forEach(l => l(event, session))
  ;(globalThis as Record<string, unknown>).__demoDB = db

  return {
    from: (table: string) => new Query(db, table),
    rpc: (name: string, args: Record<string, unknown>) => new Rpc(db, name, args),
    storage: createMockStorage(),
    channel: () => {
      let listener: ((c: Change) => void) | null = null
      const ch = {
        on: (_e: string, _f: unknown, cb: (payload: Change) => void) => { listener = cb; db.listeners.add(cb); return ch },
        subscribe: (cb?: (status: string) => void) => { setTimeout(() => cb?.('SUBSCRIBED'), 10); return ch },
        unsubscribe: () => { if (listener) db.listeners.delete(listener) },
      }
      return ch
    },
    removeChannel: (ch: { unsubscribe: () => void }) => { ch.unsubscribe(); return Promise.resolve('ok') },
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: session?.user ?? null }, error: null }),
      onAuthStateChange: (cb: (event: string, s: unknown) => void) => {
        authListeners.add(cb)
        return { data: { subscription: { unsubscribe: () => authListeners.delete(cb) } } }
      },
      signInWithPassword: () => { session = { access_token: 'demo', user: { id: DEMO_USER.id, email: DEMO_USER.email } }; notify('SIGNED_IN'); return Promise.resolve({ data: { session }, error: null }) },
      signUp: () => Promise.resolve({ data: {}, error: null }),
      signOut: () => { session = null; notify('SIGNED_OUT'); return Promise.resolve({ error: null }) },
      updateUser: () => Promise.resolve({ data: {}, error: null }),
      resetPasswordForEmail: () => Promise.resolve({ data: {}, error: null }),
    },
  }
}
