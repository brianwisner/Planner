import { describe, expect, it } from 'vitest'
import { isBlankVisit, listItems, visitClosing, visitDateFor, visitTaskFor, DEFAULT_VISIT_CLOSING } from './siteVisits'
import type { SiteVisit, Task } from './types'

const task = (id: string, due: string, extra: Partial<Task> = {}): Task => ({
  id, job_id: 'j', phase_id: null, title: 'Site visit: framing', description: '', status: 'todo', assignee_id: null, due_date: due, scheduled_at: null,
  is_site_visit: true, estimate_hours: null, recurrence: 'none', recurrence_parent_id: null, sort_order: 0, completed_at: null, created_by: null, created_at: '', ...extra,
})
const visit = (extra: Partial<SiteVisit> = {}): SiteVisit => ({
  id: 'v', job_id: 'j', task_id: null, visit_date: '2026-10-20', purpose: '', weather: '', present: '', observations: '', corrections: '', conclusion: 'Closing', sent_date: null, user_id: null, created_at: '', ...extra,
})

describe('site visit helpers', () => {
  it('turns note lines into report items, dropping typed bullets and numbers', () => {
    expect(listItems('- Hold-downs installed\n\n2. Nailing at 4" o.c.\n  • Blocking missing at grid 3  \n12 ft span checked')).toEqual([
      'Hold-downs installed', 'Nailing at 4" o.c.', 'Blocking missing at grid 3', '12 ft span checked',
    ])
  })

  it('treats a visit with only its standard closing as blank', () => {
    expect(isBlankVisit(visit(), 0)).toBe(true)
    expect(isBlankVisit(visit(), 1)).toBe(false)
    expect(isBlankVisit(visit({ observations: 'Footing poured' }), 0)).toBe(false)
  })

  it('finds a recent scheduled visit without a report', () => {
    const tasks = [task('old', '2026-09-01'), task('recent', '2026-10-22'), task('future', '2026-10-30'), task('other', '2026-10-23', { is_site_visit: false })]
    expect(visitTaskFor({ tasks, siteVisits: [] }, 'j', '2026-10-24')?.id).toBe('recent')
    expect(visitTaskFor({ tasks, siteVisits: [visit({ task_id: 'recent' })] }, 'j', '2026-10-24')).toBeUndefined()
  })

  it('dates a report on the visit day once it has passed, else today', () => {
    expect(visitDateFor(task('t', '2026-10-22'), '2026-10-24')).toBe('2026-10-22')
    expect(visitDateFor(task('t', '2026-10-30'), '2026-10-24')).toBe('2026-10-24')
    expect(visitDateFor(undefined, '2026-10-24')).toBe('2026-10-24')
  })

  it('uses the saved closing paragraph, or the standard wording', () => {
    expect(visitClosing({ visit_closing: '  ' })).toBe(DEFAULT_VISIT_CLOSING)
    expect(visitClosing({ visit_closing: 'Call me.' })).toBe('Call me.')
  })
})
