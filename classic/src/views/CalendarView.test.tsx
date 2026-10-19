// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalItem } from '../lib/calendar'
import { CalendarView, type CalendarViewProps } from './CalendarView'

let container: HTMLDivElement, root: Root
const item = (overrides: Partial<CalItem> = {}): CalItem => ({ id: 'task', date: '2026-10-19', time: null, title: 'Review framing', kind: 'task', jobId: 'job', jobName: 'Synthetic residence', clientName: 'Oak Builders', jobNumber: 'SYN-001', assigneeId: 'legacy', done: false, link: '/jobs/job?task=task', ...overrides })
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-19T12:00:00')); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 }); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
async function render(props: CalendarViewProps) { await act(async () => root.render(<MemoryRouter><CalendarView {...props} /></MemoryRouter>)) }
function button(label: string | RegExp) { const found = [...container.querySelectorAll('button')].find(button => typeof label === 'string' ? (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label : label.test(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '')); if (!found) throw new Error(`Missing button ${label}`); return found }

describe('CalendarView', () => {
  it('retains items-only Jobs compatibility with keyboard month controls', async () => {
    await render({ items: [item()] })
    expect(button('Month').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('table')?.getAttribute('aria-label')).toBe('October 2026 calendar')
    await act(async () => button('Next month').click())
    expect(container.querySelector('table')?.getAttribute('aria-label')).toBe('November 2026 calendar')
    await act(async () => button('Today').click())
    expect(container.querySelector('table')?.getAttribute('aria-label')).toBe('October 2026 calendar')
  })
  it('opens the full selected-day list, including every event beyond the grid preview', async () => {
    const items = Array.from({ length: 6 }, (_, index) => item({ id: `task-${index}`, title: `Task ${index}`, link: `/jobs/job?task=task-${index}` }))
    await render({ items })
    await act(async () => button('Monday, October 19, 2026, 6 dates').click())
    const selected = container.querySelector('[aria-label="Selected day"]')!
    expect(selected.querySelectorAll('.calendar-item-link')).toHaveLength(6)
    expect(selected.querySelector('a[href="/jobs/job?task=task-5"]')).toBeTruthy()
    expect(selected.textContent).toContain('Oak Builders · Synthetic residence · SYN-001')
    expect(container.querySelector('.calendar-more-count')?.textContent).toBe('+3 more')
  })
  it('renders completed past dates honestly in the agenda without calling them overdue', async () => {
    await render({ mode: 'agenda', agendaScope: 'month', month: '2026-10', items: [item({ id: 'done', title: 'Finished review', date: '2026-10-17', done: true }), item({ id: 'late', title: 'Open overdue review', date: '2026-10-18' }), item({ id: 'future', title: 'Next month review', date: '2026-11-01' })] })
    expect(container.querySelector('.calendar-agenda')?.textContent).toContain('Finished review')
    expect(container.querySelector('.calendar-agenda')?.textContent).not.toContain('Next month review')
    expect(container.querySelector('[aria-label="Overdue open dates"]')?.textContent).toContain('Open overdue review')
    expect(container.querySelector('[aria-label="Overdue open dates"]')?.textContent).not.toContain('Finished review')
    expect(container.querySelector('.calendar-agenda-row.is-done')?.textContent).toContain('Completed')
    expect(container.querySelector('.calendar-agenda-row.is-done .calendar-google-link')).toBeNull()
  })
  it('never silently truncates a long agenda and does not mutate incoming order', async () => {
    const items = Array.from({ length: 95 }, (_, index) => item({ id: `item-${index}`, title: `Synthetic ${index}`, link: `/jobs/job?task=${index}` })).reverse()
    const first = items[0].id
    await render({ mode: 'agenda', items })
    expect(container.querySelectorAll('.calendar-item-link')).toHaveLength(95)
    expect(items[0].id).toBe(first)
  })
  it('keeps controlled mode/month changes in callbacks and exposes named Google links', async () => {
    const onMonthChange = vi.fn(), onModeChange = vi.fn()
    await render({ items: [item()], month: '2026-10', mode: 'agenda', agendaScope: 'month', onMonthChange, onModeChange })
    await act(async () => { button('Next month').click(); button('Month').click() })
    expect(onMonthChange).toHaveBeenCalledWith('2026-11')
    expect(onModeChange).toHaveBeenCalledWith('month')
    const link = container.querySelector('a[aria-label="Add Review framing to Google Calendar"]')!
    expect(link.getAttribute('target')).toBe('_blank')
    expect(new URL(link.getAttribute('href')!).searchParams.get('details')).toContain('#/jobs/job?task=task')
  })
  it('defaults phones to a readable agenda and keeps Month reachable', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    await render({ items: [item({ time: new Date('2026-10-19T14:30:00').toISOString(), kind: 'site_visit' })] })
    expect(button('Agenda').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.calendar-item-time')?.textContent).toContain('2:30 PM')
    await act(async () => button('Month').click())
    expect(container.querySelector('table')).toBeTruthy()
  })
  it('labels an empty selected month without implying there are no dates elsewhere', async () => {
    await render({ items: [item({ date: '2026-11-01' })], month: '2026-10', mode: 'agenda', agendaScope: 'month' })
    expect(container.querySelector('.calendar-empty')?.textContent).toContain('in this month')
  })
})
