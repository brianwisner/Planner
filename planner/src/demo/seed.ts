// Made-up sample data for demo mode. Dates are relative to today so the demo
// always looks current. Every name, address and number here is fictional.
type Row = Record<string, unknown>

export const DEMO_USER = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.com' }

function iso(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function at(offsetDays: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}
/** Days from today to this week's Monday + n. */
function weekday(n: number): number {
  const day = new Date().getDay()
  return -((day + 6) % 7) + n
}
let counter = 0
/** Stable, valid UUIDs so demo links stay the same between reloads. */
function uid(kind: string): string {
  counter++
  const prefix = kind.charCodeAt(0).toString(16).padStart(8, '0')
  return `${prefix}-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
}

type PhaseStatus = 'not_started' | 'in_progress' | 'waiting' | 'complete'
interface JobSpec {
  key: string; number: string; name: string; client: string; address: string; description: string
  status: string; fee: number | null; due: number | null; type?: string; size?: number; closeout?: string
  phases: [PhaseStatus, PhaseStatus, PhaseStatus, PhaseStatus, PhaseStatus]
  estimates: [number, number, number, number, number]
  dates?: Partial<Record<'bidding' | 'design' | 'plan_check' | 'construction' | 'client_changes', [number | null, number | null]>>
}

export function seedData(): Record<string, Row[]> {
  counter = 0
  const created = (days: number) => at(days, 9)
  const settings = [{ id: 1, company_name: 'Wisner Engineering', business_email: 'office@example.com', default_rate: 185, weekly_capacity: 40, minimum_fee: 1200, site_visit_hours: 3, retainer_percent: 25, proposal_template: '', letterhead: 'PO Box 4410, Bellingham, WA 98227\n(360) 555-0100', signature: 'Brian Wisner, P.E.\nPrincipal', visit_closing: '' }]
  const profiles = [{ id: DEMO_USER.id, email: DEMO_USER.email, full_name: 'Brian Wisner', color: '#2f5bea', hourly_rate: null, weekly_hours: 40, ics_token: 'demo-token', created_at: created(-90) }]

  const clientSpecs = [
    ['harbor', 'Harbor View Architects', 'Dana Ruiz', 'dana@harborview.example', '(360) 555-0142', '1180 Marine Dr, Bellingham, WA', 'Prefers PDFs by email. Usually sends backgrounds in Revit.'],
    ['cascade', 'Cascade Builders', 'Mike Thornton', 'mike@cascadebuilders.example', '(360) 555-0188', '45 Industrial Way, Ferndale, WA', 'General contractor. Pays on 30-day terms.'],
    ['miller', 'Elena & Tom Miller', 'Elena Miller', 'elena.miller@example.com', '(360) 555-0119', '2210 Cedar Ln, Bellingham, WA', ''],
    ['northgate', 'Northgate Development', 'Priya Shah', 'pshah@northgate.example', '(206) 555-0170', '900 Northgate Way, Seattle, WA', 'Tenant improvement work. Needs stamped letters fast.'],
    ['pine', 'Pine Street Partners', 'Sam Okafor', 'sam@pinestreet.example', '(360) 555-0161', '310 Pine St, Mount Vernon, WA', ''],
    ['lakeside', 'Lakeside Community Church', 'Jim Hale', 'office@lakesidechurch.example', '(360) 555-0103', '77 Lakeview Rd, Sedro-Woolley, WA', 'Board approves invoices at the monthly meeting (first Tuesday).'],
    ['bayside', 'Bayside Homes', 'Rachel Kim', 'rachel@baysidehomes.example', '(360) 555-0135', '15 Harbor Loop, Anacortes, WA', 'Production builder — repeat plans.'],
    ['summit', 'Summit Design Studio', 'Alex Novak', 'alex@summitdesign.example', '(425) 555-0127', '402 Summit Ave, Everett, WA', ''],
    ['garcia', 'Luis Garcia', 'Luis Garcia', 'lgarcia@example.com', '(360) 555-0196', '58 Alder St, Burlington, WA', 'Homeowner. Referred by Cascade Builders.'],
  ] as const
  const clientIds: Record<string, string> = {}
  const clients: Row[] = clientSpecs.map(([key, name, contact_name, email, phone, address, notes], i) => {
    clientIds[key] = uid('c')
    return { id: clientIds[key], name, contact_name, email, phone, address, notes, is_sample: false, created_at: created(-120 + i * 5) }
  })

  // Job types with starter hours (design, plan check, construction) for the fee estimator.
  const typeSpecs: [string, string, number, number, number, number, string, string][] = [
    ['adu', 'ADU / addition', 30, 8, 2, 2, 'sq ft', 'adu, addition, accessory dwelling, garage apartment, second story'],
    ['beam', 'Beam or bearing wall removal', 10, 3, 2, 1, '', 'beam, header, bearing wall, girder, ridge'],
    ['deck', 'Deck / stair', 8, 2, 2, 1, 'sq ft', 'deck, stair, porch, balcony'],
    ['multi', 'Multifamily (2–4 units)', 56, 10, 8, 3, 'sq ft', 'duplex, triplex, fourplex, multifamily'],
    ['retro', 'Seismic retrofit', 48, 12, 10, 2, 'sq ft', 'seismic, retrofit, urm, anchorage'],
    ['wall', 'Retaining wall', 16, 4, 3, 1, 'ft of wall', 'retaining wall, landscape wall, cantilevered wall'],
  ]
  const typeIds: Record<string, string> = {}
  const job_types: Row[] = typeSpecs.map(([key, name, design_hours, plan_check_hours, construction_hours, site_visits, size_unit, keywords], i) => {
    typeIds[key] = uid('y')
    return { id: typeIds[key], name, design_hours, plan_check_hours, construction_hours, site_visits, size_unit, keywords, notes: '', created_at: created(-100 + i) }
  })

  const N: PhaseStatus = 'not_started', P: PhaseStatus = 'in_progress', W: PhaseStatus = 'waiting', C: PhaseStatus = 'complete'
  const jobSpecs: JobSpec[] = [
    { key: 'adu', number: '26-118', name: 'Miller ADU & garage addition', client: 'miller', address: '2210 Cedar Ln, Bellingham', description: 'Two-story ADU over a new detached garage. Wood framing, shear walls, spread footings.', type: 'adu', size: 900, status: 'active', fee: 8800, due: 12, phases: [C, P, N, N, N], estimates: [3, 34, 8, 6, 0], dates: { bidding: [-40, -33], design: [-12, 6], plan_check: [14, 30] } },
    { key: 'church', number: '26-104', name: 'Lakeside Church seismic retrofit', client: 'lakeside', address: '77 Lakeview Rd, Sedro-Woolley', description: 'URM wall anchorage and roof diaphragm strengthening for the 1952 sanctuary.', type: 'retro', status: 'active', fee: 14500, due: 9, phases: [C, C, P, N, N], estimates: [4, 60, 12, 10, 0], dates: { design: [-60, -21], plan_check: [-6, 4] } },
    { key: 'fourplex', number: '26-111', name: 'Pine Street 4-plex', client: 'pine', address: '318 Pine St, Mount Vernon', description: 'Three-story wood-framed 4-plex over slab on grade.', type: 'multi', size: 4200, status: 'active', fee: 18000, due: 24, phases: [C, P, N, N, P], estimates: [4, 72, 12, 10, 6], dates: { design: [-20, 15], client_changes: [-3, 3] } },
    { key: 'deck', number: '26-121', name: 'Deck & exterior stair — Olsen', client: 'harbor', address: '14 Bay View Ct, Bellingham', description: 'Elevated deck with steel posts and new exterior stair.', type: 'deck', status: 'active', fee: 2600, due: 7, phases: [C, W, N, N, N], estimates: [1, 10, 3, 2, 0], dates: { design: [-5, 5] } },
    { key: 'retail', number: '26-123', name: 'Northgate retail TI — Suite 140', client: 'northgate', address: '900 Northgate Way, Seattle', description: 'New storefront header and rooftop unit support framing.', status: 'active', fee: 4200, due: 30, phases: [C, N, N, N, N], estimates: [2, 16, 4, 2, 0], dates: { design: [7, 18] } },
    { key: 'lot12', number: '26-124', name: 'Bayside Lot 12 custom home', client: 'bayside', address: 'Lot 12, Harbor Loop, Anacortes', description: 'Custom single-family home, view lot with a daylight basement.', status: 'active', fee: 9500, due: 45, phases: [C, N, N, N, N], estimates: [3, 44, 8, 6, 0], dates: { design: [12, 35] } },
    { key: 'wall', number: '26-125', name: 'Hillside retaining wall', client: 'summit', address: '88 Ridge Rd, Everett', description: '12-ft cantilevered retaining wall with a surcharge from the driveway.', type: 'wall', size: 60, status: 'active', fee: null, due: null, phases: [P, N, N, N, N], estimates: [3, 18, 4, 2, 0], dates: { bidding: [-2, 2] } },
    { key: 'garage', number: '26-126', name: 'Garcia garage conversion', client: 'garcia', address: '58 Alder St, Burlington', description: 'Convert the attached garage to a bedroom suite; new header at the garage door.', type: 'beam', status: 'active', fee: 1800, due: null, phases: [W, N, N, N, N], estimates: [1, 8, 2, 1, 0], dates: { bidding: [-6, -1] } },
    { key: 'mezz', number: '26-097', name: 'Cascade warehouse mezzanine', client: 'cascade', address: '45 Industrial Way, Ferndale', description: 'Steel mezzanine, 2,400 sf storage, with a moment frame and new footings.', status: 'active', fee: 12000, due: 20, phases: [C, C, C, P, N], estimates: [3, 52, 10, 12, 0], dates: { construction: [-14, 40] } },
    { key: 'remodel', number: '26-109', name: 'Harbor View — Chen residence remodel', client: 'harbor', address: '402 Chuckanut Dr, Bellingham', description: 'Remove a bearing wall; new flush beam and posts down to new footings.', type: 'beam', status: 'active', fee: 3900, due: 16, phases: [C, C, W, N, N], estimates: [2, 20, 6, 3, 0], dates: { plan_check: [-10, 10] } },
    { key: 'lot7', number: '26-088', name: 'Bayside Lot 7 foundation repair', client: 'bayside', address: 'Lot 7, Harbor Loop, Anacortes', description: 'Settlement repair: helical piers and a new grade beam.', status: 'active', fee: 5200, due: 5, phases: [C, C, C, P, N], estimates: [2, 22, 4, 8, 0], dates: { construction: [-20, 10] } },
    { key: 'canopy', number: '26-127', name: 'Northgate parking canopy', client: 'northgate', address: '920 Northgate Way, Seattle', description: 'Steel canopy over 12 parking stalls with solar panels.', status: 'active', fee: null, due: null, phases: [N, N, N, N, N], estimates: [0, 0, 0, 0, 0] },
    { key: 'stair', number: '26-102', name: 'Cascade office stair replacement', client: 'cascade', address: '45 Industrial Way, Ferndale', description: 'Replace the steel stair to the second-floor offices.', type: 'deck', status: 'on_hold', fee: 3400, due: null, phases: [C, P, N, N, N], estimates: [2, 14, 3, 2, 0] },
    { key: 'fence', number: '26-115', name: 'Miller fence & landscape walls', client: 'miller', address: '2210 Cedar Ln, Bellingham', description: 'Low landscape walls and a 7-ft privacy fence.', type: 'wall', status: 'on_hold', fee: null, due: null, phases: [W, N, N, N, N], estimates: [1, 6, 0, 0, 0] },
    { key: 'duplex', number: '26-071', name: 'Pine Street duplex', client: 'pine', address: '312 Pine St, Mount Vernon', description: 'Two-story duplex.', type: 'multi', status: 'complete', fee: 8200, due: -20, phases: [C, C, C, C, N], estimates: [3, 40, 8, 6, 0] },
    { key: 'beam', number: '26-064', name: 'Lakeside parsonage beam replacement', client: 'lakeside', address: '79 Lakeview Rd, Sedro-Woolley', description: 'Replace a sagging ridge beam.', type: 'beam', closeout: 'Went as planned', status: 'complete', fee: 1500, due: -45, phases: [C, C, N, N, N], estimates: [1, 8, 0, 0, 0] },
    { key: 'hayes', number: '26-052', name: 'Hayes backyard ADU', client: 'summit', address: '19 Ridge Rd, Everett', description: 'One-story ADU on slab. Wood shear walls.', type: 'adu', size: 640, closeout: 'Plan-check comments', status: 'complete', fee: 6200, due: -70, phases: [C, C, C, C, N], estimates: [2, 30, 8, 6, 0] },
    { key: 'ortiz', number: '26-060', name: 'Ortiz garage + ADU above', client: 'bayside', address: '7 Harbor Loop, Anacortes', description: 'ADU over a detached two-car garage.', type: 'adu', size: 800, closeout: 'Existing conditions', status: 'complete', fee: 7400, due: -35, phases: [C, C, C, C, N], estimates: [2, 32, 8, 6, 0] },
    { key: 'carport', number: '26-119', name: 'Summit carport', client: 'summit', address: '6 Ridge Rd, Everett', description: 'Two-car carport. Owner decided not to build.', status: 'cancelled', fee: 900, due: null, phases: [C, N, N, N, N], estimates: [1, 5, 0, 0, 0] },
  ]
  const kinds = ['bidding', 'design', 'plan_check', 'construction', 'client_changes'] as const
  const names = ['Bidding', 'Original design', 'County / plan-check comments', 'Construction changes', 'Client-requested changes']
  const jobIds: Record<string, string> = {}
  const phaseIds: Record<string, string> = {}
  const jobs: Row[] = []
  const clientPriorities = new Map<string, number>()
  const phases: Row[] = []
  jobSpecs.forEach((s, i) => {
    jobIds[s.key] = uid('j')
    clientPriorities.set(s.client, (clientPriorities.get(s.client) ?? 0) + 1)
    jobs.push({ id: jobIds[s.key], client_id: clientIds[s.client], job_number: s.number, name: s.name, description: s.description, address: s.address, status: s.status, priority: i + 1, client_priority: clientPriorities.get(s.client), fee: s.fee, job_type_id: s.type ? typeIds[s.type] : null, size: s.size ?? null, use_in_estimates: true, estimate_note: '', closeout_reason: s.closeout ?? '', queued_date: null, start_date: null, due_date: s.due == null ? null : iso(s.due), created_at: created(-80 + i * 3) })
    kinds.forEach((kind, k) => {
      const pid = uid('p')
      phaseIds[`${s.key}:${kind}`] = pid
      const range = s.dates?.[kind]
      phases.push({ id: pid, job_id: jobIds[s.key], kind, name: names[k], sort_order: k + 1, status: s.phases[k], estimate_hours: s.estimates[k], start_date: range?.[0] == null ? null : iso(range[0]), due_date: range?.[1] == null ? null : iso(range[1]), assignee_id: null, notes: '' })
    })
  })

  const tasks: Row[] = []
  const task = (job: string, phase: typeof kinds[number] | null, title: string, due: number | null, extra: Row = {}) => {
    const row: Row = { id: uid('t'), job_id: jobIds[job], phase_id: phase ? phaseIds[`${job}:${phase}`] : null, title, description: '', status: 'todo', assignee_id: DEMO_USER.id, due_date: due == null ? null : iso(due), scheduled_at: null, is_site_visit: false, estimate_hours: null, recurrence: 'none', recurrence_parent_id: null, sort_order: tasks.length, completed_at: null, created_by: DEMO_USER.id, created_at: created(-30 + tasks.length), ...extra }
    tasks.push(row)
    return row
  }
  task('church', 'plan_check', 'Respond to county plan-check comments (items 3–7)', -1, { status: 'doing', estimate_hours: 6 })
  task('deck', 'design', 'Follow up with Dana for architectural backgrounds', -2, { status: 'waiting', description: 'Need updated deck plan and stair layout before finishing calcs.' })
  task('adu', 'design', 'Shear wall layout and hold-down schedule', 0, { status: 'doing', estimate_hours: 5 })
  task('adu', 'design', 'Footing design at garage grid line C', 2, { estimate_hours: 3 })
  task('fourplex', 'client_changes', 'Revise floor framing for relocated stair', 1, { estimate_hours: 4 })
  task('fourplex', 'design', 'Lateral analysis — wind vs. seismic check', 6, { estimate_hours: 8 })
  task('mezz', 'construction', 'Answer RFI #4 — column base plate substitution', 0, { estimate_hours: 1.5 })
  task('mezz', 'construction', 'Site visit: mezzanine framing observation', 1, { is_site_visit: true, scheduled_at: at(1, 10, 0) })
  task('lot7', 'construction', 'Site visit: helical pier installation', 3, { is_site_visit: true, scheduled_at: at(3, 8, 30) })
  task('lot7', 'construction', 'Review pier installation logs', 4)
  task('remodel', 'plan_check', 'Check county portal for plan-review status', 2, { status: 'waiting' })
  task('wall', 'bidding', 'Send proposal for retaining wall', 1, { estimate_hours: 1 })
  task('garage', 'bidding', 'Follow up on signed proposal', 3, { status: 'waiting' })
  task('retail', 'design', 'Request existing drawings from Northgate', 4)
  task('lot12', null, 'Get geotech report from Bayside', 8)
  task('canopy', 'bidding', 'Call Priya about canopy scope and budget', 5)
  task('church', null, 'Invoice reminder before board meeting', 14, { recurrence: 'monthly' })
  task('adu', 'design', 'Gravity beam and header sizing', -6, { status: 'done', completed_at: at(-5, 15) })
  task('church', 'plan_check', 'Download plan-check comment letter', -8, { status: 'done', completed_at: at(-7, 11) })
  task('fourplex', 'design', 'Roof framing plan', -4, { status: 'done', completed_at: at(-3, 16) })
  task('mezz', 'construction', 'Answer RFI #3 — beam connection', -5, { status: 'done', completed_at: at(-5, 10) })

  const invoices: Row[] = [
    { id: uid('i'), job_id: jobIds.church, number: 'INV-1041', amount: 1995, issued_date: iso(-24), paid_date: iso(-9), notes: 'Design phase progress billing', created_at: created(-24) },
    { id: uid('i'), job_id: jobIds.mezz, number: 'INV-1042', amount: 2775, issued_date: iso(-12), paid_date: null, notes: '', created_at: created(-12) },
    { id: uid('i'), job_id: jobIds.remodel, number: 'INV-1043', amount: 3330, issued_date: iso(-38), paid_date: null, notes: 'Design complete', created_at: created(-38) },
    { id: uid('i'), job_id: jobIds.hayes, number: 'INV-1021', amount: 6200, issued_date: iso(-75), paid_date: iso(-60), notes: 'Fixed fee', created_at: created(-75) },
    { id: uid('i'), job_id: jobIds.ortiz, number: 'INV-1031', amount: 7400, issued_date: iso(-40), paid_date: iso(-28), notes: 'Fixed fee', created_at: created(-40) },
    { id: uid('i'), job_id: jobIds.beam, number: 'INV-1024', amount: 1500, issued_date: iso(-50), paid_date: iso(-41), notes: 'Fixed fee', created_at: created(-50) },
    { id: uid('i'), job_id: jobIds.duplex, number: 'INV-1036', amount: 5550, issued_date: iso(-30), paid_date: iso(-15), notes: 'Final', created_at: created(-30) },
  ]
  const [invChurch, invMezz, invRemodel, invHayes, invOrtiz, invBeam, invDuplex] = invoices

  const deposits: Row[] = [
    { id: uid('d'), job_id: jobIds.adu, amount: 1500, received_date: iso(-33), method: 'Check #2213', notes: 'Retainer', created_at: created(-33) },
    { id: uid('d'), job_id: jobIds.church, amount: 3000, received_date: iso(-58), method: 'Check', notes: 'Retainer', created_at: created(-58) },
    { id: uid('d'), job_id: jobIds.fourplex, amount: 4000, received_date: iso(-21), method: 'ACH', notes: 'Retainer', created_at: created(-21) },
    { id: uid('d'), job_id: jobIds.lot12, amount: 2000, received_date: iso(-4), method: 'Check #5521', notes: 'Retainer', created_at: created(-4) },
  ]

  const time: Row[] = []
  const log = (job: string, phase: typeof kinds[number] | null, day: number, hours: number, notes: string, extra: Row = {}) => {
    time.push({ id: uid('e'), job_id: jobIds[job], phase_id: phase ? phaseIds[`${job}:${phase}`] : null, task_id: null, user_id: DEMO_USER.id, date: iso(day), hours, started_at: null, rate: 185, notes, billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: at(day, 17), ...extra })
  }
  // Older, already-invoiced work
  log('church', 'design', -45, 6, 'Diaphragm analysis', { billed: true, invoice_id: invChurch.id, deposit_applied: 1110 })
  log('church', 'design', -40, 8, 'Wall anchorage details', { billed: true, invoice_id: invChurch.id, deposit_applied: 1480 })
  log('church', 'design', -33, 7, 'Drawings and calc package', { billed: true, invoice_id: invChurch.id, deposit_applied: 410 })
  log('church', 'design', -28, 6, 'Final checks and stamping', { billed: true, invoice_id: invChurch.id, deposit_applied: 0 })
  log('remodel', 'design', -44, 6, 'Beam and post design', { billed: true, invoice_id: invRemodel.id, deposit_applied: 0 })
  log('remodel', 'design', -41, 6, 'Footing design and details', { billed: true, invoice_id: invRemodel.id, deposit_applied: 0 })
  log('remodel', 'design', -39, 6, 'Calc package', { billed: true, invoice_id: invRemodel.id, deposit_applied: 0 })
  log('mezz', 'design', -30, 8, 'Mezzanine framing design', { billed: true, invoice_id: invMezz.id, deposit_applied: 0 })
  log('mezz', 'construction', -14, 7, 'Shop drawing review', { billed: true, invoice_id: invMezz.id, deposit_applied: 0 })
  log('duplex', 'design', -60, 24, 'Design and drawings', { billed: true, invoice_id: invDuplex.id, deposit_applied: 0 })
  log('duplex', 'plan_check', -40, 6, 'Plan-check response', { billed: true, invoice_id: invDuplex.id, deposit_applied: 0 })
  // Finished jobs the fee estimator learns from
  log('hayes', 'design', -110, 16, 'Framing and lateral design', { billed: true, invoice_id: invHayes.id, deposit_applied: 0 })
  log('hayes', 'design', -104, 12, 'Foundation, details and calcs', { billed: true, invoice_id: invHayes.id, deposit_applied: 0 })
  log('hayes', 'plan_check', -90, 9, 'Plan-check response', { billed: true, invoice_id: invHayes.id, deposit_applied: 0 })
  log('hayes', 'construction', -76, 4, 'Site visit and RFI', { billed: true, invoice_id: invHayes.id, deposit_applied: 0 })
  log('ortiz', 'design', -75, 20, 'Garage and floor framing', { billed: true, invoice_id: invOrtiz.id, deposit_applied: 0 })
  log('ortiz', 'design', -68, 16, 'Shear walls and foundation', { billed: true, invoice_id: invOrtiz.id, deposit_applied: 0 })
  log('ortiz', 'plan_check', -55, 6, 'Plan-check response', { billed: true, invoice_id: invOrtiz.id, deposit_applied: 0 })
  log('ortiz', 'construction', -42, 8, 'Framing observation and RFIs', { billed: true, invoice_id: invOrtiz.id, deposit_applied: 0 })
  log('ortiz', null, -62, 3, 'Calls with the architect', { billed: true, invoice_id: invOrtiz.id, deposit_applied: 0 })
  log('beam', 'design', -58, 7, 'Ridge beam and post design', { billed: true, invoice_id: invBeam.id, deposit_applied: 0 })
  // Recent, unbilled work
  const recent: [string, typeof kinds[number] | null, number, number, string, Row?][] = [
    ['adu', 'design', -11, 3.5, 'Gravity framing layout'],
    ['adu', 'design', -10, 4, 'Beam and header sizing'],
    ['fourplex', 'design', -10, 3, 'Roof framing plan'],
    ['church', 'plan_check', -9, 2, 'Read plan-check comments'],
    ['adu', 'design', -8, 2.5, 'Foundation plan'],
    ['fourplex', 'design', -8, 5, 'Floor framing'],
    ['mezz', 'construction', -7, 1.5, 'RFI #3 response'],
    ['fourplex', 'design', -7, 4, 'Wind load calcs'],
    ['lot7', 'construction', -7, 2, 'Pier layout revisions'],
    [null as unknown as string, null, -7, 1, 'Bookkeeping', { billable: false }],
    ['adu', 'design', -4, 3, 'Shear wall layout'],
    ['church', 'plan_check', -4, 3, 'Comment responses 1–2'],
    ['fourplex', 'design', -3, 4.5, 'Floor framing — level 3'],
    ['lot7', 'construction', -3, 1.5, 'Contractor call re: pier depths'],
    ['wall', 'bidding', -2, 1.5, 'Site photos and scope review', { billable: false }],
    ['fourplex', 'client_changes', -1, 2, 'Stair relocation review'],
    ['church', 'plan_check', -1, 2.5, 'Comment responses 3–4'],
    ['mezz', 'construction', -1, 1, 'Site visit prep'],
  ]
  for (const [job, phase, day, hours, notes, extra] of recent) {
    const d = new Date(); d.setDate(d.getDate() + day)
    if (d.getDay() === 0) continue
    if (!job) { log('adu', null, day, hours, notes, extra); continue }
    log(job, phase, day, hours, notes, extra)
  }

  // Saved quotes: the finished ADUs ran over on design; Miller has a current quote.
  const quote = (job: string, days: number, d: number, pc: number, c: number, fee: number, extra: Row = {}): Row => ({
    id: uid('q'), job_id: jobIds[job], job_type_id: typeIds.adu, rate: 185, design_hours: d, plan_check_hours: pc, construction_hours: c,
    site_visits: 2, visit_hours: 3, allowance_hours: 0, rush_percent: 0, size: null, suggested_fee: fee, fee, fee_note: '', created_at: created(days), ...extra,
  })
  const quotes: Row[] = [
    quote('hayes', -118, 24, 6, 8, 6200, { size: 640, suggested_fee: 7050, fee_note: 'Repeat client, matched last year' }),
    quote('ortiz', -82, 30, 8, 8, 7400, { size: 800, suggested_fee: 8700, fee_note: 'Budget-conscious owner' }),
    quote('adu', -36, 31, 8, 8, 8800, { size: 900, suggested_fee: 8800 }),
  ]

  // Jobs from before the planner, as found in old invoices and emails.
  const pastJob = (name: string, client: string, type: string, days: number, fee: number, scope: string, source: string, size: number | null = null): Row => ({
    id: uid('h'), name, client, address: '', job_type_id: typeIds[type], date: iso(days), fee, hours: null, size, scope, source, use_in_estimates: true, created_at: created(-5),
  })
  const past_jobs: Row[] = [
    pastJob('Nelson garage ADU', 'Nelson family', 'adu', -420, 5800, 'ADU over detached garage', 'Invoice 2025-112', 700),
    pastJob('Kerr addition', 'Cascade Builders', 'adu', -300, 4900, 'Single-story addition', 'Invoice 2025-140', 450),
    pastJob('Bay St duplex', 'Pine Street Partners', 'multi', -380, 7600, 'Two-story duplex', 'Invoice 2025-118'),
    pastJob('Sorensen deck', 'Harbor View Architects', 'deck', -260, 1600, 'Elevated deck and stair', 'Email quote, Mar 2025'),
    pastJob('Lindgren kitchen wall', 'Elena & Tom Miller', 'beam', -200, 1350, 'Remove bearing wall, new flush beam', 'Invoice 2025-151'),
  ]

  const job_items: Row[] = [
    { id: uid('x'), job_id: jobIds.adu, date: iso(-9), category: 'Mileage', description: 'Site visit — measure existing garage', quantity: 42, unit_price: 0.67, billed: false, invoice_id: null, deposit_applied: null, created_by: DEMO_USER.id, created_at: created(-9) },
    { id: uid('x'), job_id: jobIds.church, date: iso(-5), category: 'Printing / plotting', description: 'Full-size plan sets (3)', quantity: 3, unit_price: 28, billed: false, invoice_id: null, deposit_applied: null, created_by: DEMO_USER.id, created_at: created(-5) },
    { id: uid('x'), job_id: jobIds.mezz, date: iso(-6), category: 'Site visit', description: 'Footing observation', quantity: 1, unit_price: 250, billed: false, invoice_id: null, deposit_applied: null, created_by: DEMO_USER.id, created_at: created(-6) },
    { id: uid('x'), job_id: jobIds.fourplex, date: iso(-12), category: 'Permit / filing fee', description: 'County pre-application meeting', quantity: 1, unit_price: 120, billed: false, invoice_id: null, deposit_applied: null, created_by: DEMO_USER.id, created_at: created(-12) },
  ]

  const schedule_entries: Row[] = []
  const plan = (job: string, phase: typeof kinds[number], day: number, hours: number) => {
    const d = new Date(); d.setDate(d.getDate() + day)
    if (d.getDay() === 0 || d.getDay() === 6) return
    schedule_entries.push({ id: uid('s'), job_id: jobIds[job], phase_id: phaseIds[`${job}:${phase}`], user_id: DEMO_USER.id, date: iso(day), hours, note: '', created_at: created(-3) })
  }
  for (let n = 0; n < 12; n++) {
    const day = weekday(n)
    if (n % 7 >= 5) continue
    if (n < 5) {
      plan('adu', 'design', day, n === 4 ? 2 : 3)
      plan('fourplex', 'design', day, n % 2 ? 3 : 2)
      if (n <= 2) plan('church', 'plan_check', day, 2.5)
      if (n === 1 || n === 3) plan('mezz', 'construction', day, 1)
      if (n === 3) plan('lot7', 'construction', day, 2)
    } else {
      plan('fourplex', 'design', day, 4)
      plan('retail', 'design', day, 2)
      if (n === 8) plan('lot12', 'design', day, 3)
    }
  }

  const comments: Row[] = [
    { id: uid('m'), job_id: jobIds.church, user_id: DEMO_USER.id, body: 'County reviewer is Karen L. — she wants anchor spacing called out on the sections, not just in the schedule.', created_at: at(-8, 14) },
    { id: uid('m'), job_id: jobIds.adu, user_id: DEMO_USER.id, body: 'Elena confirmed they want the larger 24×24 garage. Updated the footprint.', created_at: at(-12, 10) },
    { id: uid('m'), job_id: jobIds.fourplex, user_id: DEMO_USER.id, body: 'Architect moved the stair to the east wall — framing at grid 3 needs a new header.', created_at: at(-2, 16) },
  ]

  // Site visit reports: one sent (with photos), one still a draft.
  const site_visits: Row[] = [], site_photos: Row[] = []
  const visit = (job: string, day: number, fields: Row, photos: [string, string][] = []) => {
    const id = uid('v')
    site_visits.push({ id, job_id: jobIds[job], task_id: null, visit_date: iso(day), purpose: '', weather: '', present: '', observations: '', corrections: '', conclusion: 'These observations are based on a visual review of the work that was accessible at the time of the visit. The visit was made to observe general conformance with the structural design; it is not a special inspection and does not guarantee the contractor\'s work. The contractor remains responsible for construction means, methods and safety, and for building the work to the approved plans. Please contact me with any questions.', sent_date: null, user_id: DEMO_USER.id, created_at: at(day, 15), ...fields })
    photos.forEach(([name, caption], i) => site_photos.push({ id: uid('f'), visit_id: id, path: `${jobIds[job]}/${id}/${name}.jpg`, caption, sort_order: i + 1, created_at: at(day, 11, i) }))
  }
  visit('mezz', -6, {
    purpose: 'Footing reinforcing and anchor bolts before the pour',
    weather: 'Overcast, 48°F', present: 'Mike Thornton (Cascade Builders); county inspector',
    observations: 'Footing excavations at grid lines A–C were clean, level and cut to the sizes shown on S2.0.\nBottom reinforcing (#5 at 12" each way) was on chairs with about 3" of cover.\nAnchor bolts at the moment frame columns were set with the steel template; projection checked at three columns.\nHold-down anchors at the stair wall were in place per detail 7/S3.1.',
    corrections: 'Add the two #5 dowels missing at the grid B2 column pier before the pour.\nTie the loose top bar at the east end of footing F3.',
    sent_date: iso(-5),
  }, [['footing-f3', 'Footing F3 reinforcing before the pour'], ['holdown', 'Hold-down anchor at the stair wall'], ['footing-b2', 'Grid B2 pier: dowels to be added']])
  visit('lot7', -10, {
    purpose: 'Helical pier layout and first installations',
    weather: 'Light rain', present: 'Rachel Kim (Bayside Homes); pier installer',
    observations: 'Pier locations P1–P4 were marked per the revised layout.\nP1 and P2 reached the torque on the installation log at about 18 ft.',
  }, [['footing-piers', 'Piers P1 and P2 installed']])

  // Plan check: the church is mid-response; the remodel's responses went back.
  const plan_check_rounds: Row[] = [], plan_check_comments: Row[] = []
  const round = (job: string, fields: Row, items: [string, string, string, boolean][]) => {
    const id = uid('r')
    plan_check_rounds.push({ id, job_id: jobIds[job], round: 1, agency: '', reviewer: '', permit_number: '', received_date: null, sent_date: null, notes: '', created_at: created(-9), ...fields })
    items.forEach(([number, comment, response, done], i) => plan_check_comments.push({ id: uid('k'), round_id: id, number, comment, response, done, sort_order: i + 1, created_at: created(-9) }))
  }
  round('church', { agency: 'Skagit County Planning & Development Services', reviewer: 'Karen Lund', permit_number: 'BP26-0412', received_date: iso(-9) }, [
    ['1', 'Provide anchor spacing on the wall sections, not only in the anchor schedule.', 'Anchor spacing is now shown on sections 3/S4.1 and 5/S4.1.', true],
    ['2', 'Show the diaphragm nailing for the new plywood overlay, including boundary and edge nailing.', 'Nailing schedule added to the roof framing plan, sheet S2.1.', true],
    ['3', 'Provide calculations for out-of-plane bracing of the gable end walls.', 'Calculations added on pages 34–37.', true],
    ['4', 'Identify the adhesive anchor product and its ICC-ES report number.', 'Simpson SET-3G (ESR-4057) is called out in the general notes on S0.1.', true],
    ['5', 'Verify the existing roof trusses for the added collector loads.', '', false],
    ['6', 'Adhesive anchors require special inspection. Add them to the statement of special inspections.', 'Added to the special inspection table on S0.1.', false],
    ['7', 'Provide a detail for the new collector connection at the bell tower.', '', false],
  ])
  round('remodel', { agency: 'City of Bellingham Permit Center', reviewer: 'J. Ortega', permit_number: 'BLD2026-0388', received_date: iso(-20), sent_date: iso(-10), notes: 'Revised sheets S1 and S2 and the updated calculations are attached.' }, [
    ['S-1', 'Provide the beam bearing detail at the new post.', 'Detail 4/S2 added.', true],
    ['S-2', 'Show the footing size under the new post on the foundation plan.', 'Footing F1 (24" square × 12") is now on the foundation plan, S1.', true],
    ['S-3', 'Specify the temporary shoring for removing the bearing wall.', 'Shoring note 6 added to S1: shore both sides of the wall until the beam is installed.', true],
  ])

  return {
    settings, profiles, clients, job_types, past_jobs, jobs, quotes, phases, tasks, invoices, deposits, time_entries: time, job_items, schedule_entries, comments,
    site_visits, site_photos, plan_check_rounds, plan_check_comments,
    daily_reviews: [], follow_ups: [], daily_availability: [], availability_blocks: [], job_planning: [], job_decisions: [], planning_events: [],
  }
}
