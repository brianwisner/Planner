import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '../components/ui'
import { forgetQuote, pendingQuote, type QuoteRequest, type QuoteSaveResult } from '../lib/quoteSave'
import type { Job, JobType, Phase, Settings, TimeEntry } from '../lib/types'
import { FeeEstimator } from './FeeEstimator'

const store = vi.hoisted(() => ({
  settings: {} as Settings,
  me: { hourly_rate: 150 },
  session: { user: { id: 'owner', email: 'owner@example.com' } },
  jobTypes: [] as JobType[], jobs: [] as Job[], phases: [] as Phase[], timeEntries: [] as TimeEntry[],
  clients: [], pastJobs: [], invoices: [], deposits: [], items: [], profiles: [], quotes: [],
  insert: vi.fn(), update: vi.fn(), remove: vi.fn(), recordQuote: vi.fn(), undoQuote: vi.fn(), toast: vi.fn(),
}))
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('../components/editors', () => ({ useEditors: () => ({ jobType: vi.fn() }) }))

const adu: JobType = { id: 'adu', name: 'ADU', design_hours: 10, plan_check_hours: 4, construction_hours: 2, site_visits: 1, size_unit: 'sq ft', keywords: 'adu', notes: '', created_at: '' }
const deck: JobType = { ...adu, id: 'deck', name: 'Deck', design_hours: 8, plan_check_hours: 2, construction_hours: 1, site_visits: 2, keywords: 'deck' }
function job(id: string, patch: Partial<Job> = {}): Job {
  return {
    id, client_id: 'client', job_number: id, name: id, description: '', address: '', status: 'active', priority: 0,
    fee: null, job_type_id: null, size: null, use_in_estimates: true, estimate_note: '', closeout_reason: '',
    queued_date: null, start_date: null, due_date: null, created_at: '', ...patch,
  }
}

let host: HTMLDivElement
let root: Root
function Harness() {
  const [params, setParams] = useSearchParams()
  return <FeeEstimator jobId={params.get('job') ?? ''} typeId={params.get('type') ?? ''} patch={next => {
    setParams(previous => {
      const result = new URLSearchParams(previous)
      for (const [key, value] of Object.entries(next)) {
        if (value == null) result.delete(key)
        else result.set(key, value)
      }
      return result
    })
  }} />
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.resetAllMocks()
  store.recordQuote.mockImplementation(async (request: QuoteRequest) => ({ quote: { ...request.quote, id: request.id, created_at: '' }, rejected: false }))
  store.undoQuote.mockResolvedValue(true)
  store.settings = { id: 1, company_name: '', business_email: '', default_rate: 150, weekly_capacity: 40, minimum_fee: 0, site_visit_hours: 3, retainer_percent: 0, proposal_template: '' }
  store.jobTypes = [{ ...adu }, { ...deck }]
  store.jobs = [
    job('typed-adu', { name: 'Alpha project', job_type_id: 'adu', size: 600 }),
    job('other-adu', { name: 'Beta project', job_type_id: 'adu', size: 400 }),
    job('typed-deck', { name: 'Gamma project', job_type_id: 'deck' }),
    job('guessed-deck', { name: 'New deck' }),
    job('untyped', { name: 'New project' }),
  ]
  store.phases = []; store.timeEntries = []
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  for (const item of store.jobs) forgetQuote('owner', item.id)
  sessionStorage.clear()
  host.remove(); vi.unstubAllGlobals()
})

async function render(query = 'job=typed-adu') {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/money?${query}`]}><ConfirmProvider><Harness /></ConfirmProvider></MemoryRouter>))
}
function input(selector: string) { return host.querySelector<HTMLInputElement>(selector)! }
function selected(id: string) { return host.querySelector<HTMLSelectElement>(`#${id}`)!.value }
async function change(selector: string, value: string) {
  await act(async () => {
    const element = input(selector)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function select(id: string, value: string) {
  await act(async () => {
    const element = host.querySelector<HTMLSelectElement>(`#${id}`)!
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function updateUsualVisits(visits: number) {
  store.jobTypes = store.jobTypes.map(type => type.id === 'adu' ? { ...type, site_visits: visits } : type)
  await render()
}
function saveButton() { return [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Save quote to'))! }
async function clickDialog(label: string) {
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === label)!.click() })
}

describe('fee estimator site-visit defaults', () => {
  it('follows edits to the same job type until visits are deliberately changed', async () => {
    await render()
    expect(input('#est-visits').value).toBe('1')
    expect(input('#est-h-construction').value).toBe('5')
    expect(input('#est-fee').value).toBe('2850')
    await updateUsualVisits(3)
    expect(input('#est-visits').value).toBe('3')
    expect(input('#est-h-construction').value).toBe('11')
    expect(input('#est-fee').value).toBe('3750')
    await updateUsualVisits(0)
    expect(input('#est-visits').value).toBe('0')
    expect(input('#est-fee').value).toBe('2400')
  })

  it.each(['4', '0', '', '1'])('preserves deliberate visits "%s" when the same type changes', async value => {
    await render()
    await change('#est-visits', '2')
    await change('#est-visits', value)
    await change('#est-h-design', '20')
    await updateUsualVisits(3)
    expect(input('#est-visits').value).toBe(value)
    expect(input('#est-h-design').value).toBe('20')
    await updateUsualVisits(2)
    expect(input('#est-visits').value).toBe(value)
  })
})

describe('fee estimator job selection', () => {
  it('unlinks a job without losing the selected type or any manual estimate inputs', async () => {
    await render()
    const edits: [string, string][] = [
      ['#est-rate', '175'], ['#est-h-design', '11'], ['#est-h-plan_check', '6'], ['#est-h-construction', '9'],
      ['#est-visits', '4'], ['input[aria-label="Hours per visit, including travel"]', '4'],
      ['#est-allow', '8'], ['#est-rush', '15'], ['#est-size', '875'], ['#est-fee', '10000'],
      ['input[aria-label="Reason for the different fee"]', 'Repeat client'],
    ]
    for (const [selector, value] of edits) await change(selector, value)
    await act(async () => input('input[type="checkbox"]').click())
    const suggested = host.querySelector('.est-fee')!.textContent

    await select('est-job', '')

    expect(selected('est-job')).toBe('')
    expect(selected('est-type')).toBe('adu')
    for (const [selector, value] of edits) expect(input(selector).value).toBe(value)
    expect(input('input[type="checkbox"]').checked).toBe(false)
    expect(host.querySelector('.est-fee')!.textContent).toBe(suggested)
    expect(host.textContent).toContain('Pick a job above to save this quote to it.')
    expect(host.textContent).not.toContain('Save quote to typed-adu')
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    expect(store.recordQuote).not.toHaveBeenCalled()
  })

  it('keeps the existing evidence basis when unlinking a completed job', async () => {
    store.jobs = store.jobs.map(item => item.id === 'typed-adu' ? { ...item, status: 'complete' } : item)
    store.timeEntries = [{ id: 'hours', job_id: 'typed-adu', phase_id: null, task_id: null, user_id: 'owner', date: '2026-10-01', hours: 100, started_at: null, rate: 150, notes: '', billable: true, billed: false, invoice_id: null, deposit_applied: null, created_at: '' }]
    await render()
    const suggested = input('#est-fee').value
    const designHours = input('#est-h-design').value
    await select('est-job', '')
    expect(input('#est-fee').value).toBe(suggested)
    expect(input('#est-h-design').value).toBe(designHours)
  })

  it('uses a typed job or a fresh guess instead of carrying a previous type into it', async () => {
    await render('type=adu')
    await select('est-job', 'typed-deck')
    expect(selected('est-type')).toBe('deck')
    await select('est-type', 'adu')
    await select('est-job', 'guessed-deck')
    expect(selected('est-type')).toBe('deck')
    expect(host.textContent).toContain("Type guessed from the job's name and scope")
    await select('est-job', 'typed-adu')
    expect(selected('est-type')).toBe('adu')
  })

  it('keeps the current type when selecting an untyped job that has no guess', async () => {
    await render('type=deck')
    await select('est-job', 'untyped')
    expect(selected('est-type')).toBe('deck')
    expect(selected('est-job')).toBe('untyped')
    expect(host.textContent).not.toContain("Type guessed from the job's name and scope")
  })

  it('starts fresh for another job of the same type, for a reselected job, and for a different type', async () => {
    await render()
    await change('#est-rate', '175')
    await change('#est-h-design', '99')
    await change('#est-visits', '7')
    await select('est-job', 'other-adu')
    expect(input('#est-h-design').value).toBe('10')
    expect(input('#est-visits').value).toBe('1')
    expect(input('#est-size').value).toBe('400')
    await change('#est-h-design', '99')
    await select('est-job', '')
    expect(input('#est-h-design').value).toBe('99')
    await select('est-job', 'other-adu')
    expect(input('#est-h-design').value).toBe('10')
    await change('#est-visits', '7')
    await select('est-type', 'deck')
    expect(input('#est-h-design').value).toBe('8')
    expect(input('#est-visits').value).toBe('2')
    expect(input('#est-rate').value).toBe('175')
  })
})

describe('fee estimator quote saving', () => {
  it('submits only one atomic quote request after a double click and shows success only when it completes', async () => {
    let resolve!: (result: QuoteSaveResult) => void
    store.recordQuote.mockReturnValue(new Promise<QuoteSaveResult>(done => { resolve = done }))
    await render()
    const button = saveButton()
    await act(async () => { button.click(); button.click() })
    expect(store.recordQuote).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(true)
    expect(store.toast).not.toHaveBeenCalled()
    expect(store.insert).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
    const request = store.recordQuote.mock.calls[0][0] as QuoteRequest
    expect(request.quote).toMatchObject({ job_id: 'typed-adu', fee: 2850, site_visits: 1 })
    expect(request.expected).toMatchObject({ fee: null, job_type_id: 'adu', size: 600 })
    await act(async () => resolve({ quote: { ...request.quote, id: request.id, created_at: '' }, rejected: false }))
    expect(store.toast).toHaveBeenCalledWith('Quote of $2,850 saved to Alpha project', 'ok', expect.objectContaining({ label: 'Undo' }))
    expect(pendingQuote('owner', 'typed-adu')).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('does not show a success toast for a rejected save and permits a new corrected request', async () => {
    store.recordQuote.mockResolvedValue({ quote: null, rejected: true })
    await render()
    await act(async () => saveButton().click())
    expect(store.recordQuote).toHaveBeenCalledOnce()
    expect(store.toast).not.toHaveBeenCalled()
    expect(pendingQuote('owner', 'typed-adu')).toBeNull()
    expect(saveButton().disabled).toBe(false)
    const first = store.recordQuote.mock.calls[0][0] as QuoteRequest
    await change('#est-h-design', '20')
    await act(async () => saveButton().click())
    const corrected = store.recordQuote.mock.calls[1][0] as QuoteRequest
    expect(corrected.id).not.toBe(first.id)
    expect(corrected.quote.fee).toBe(4350)
    expect(store.toast).not.toHaveBeenCalled()
  })

  it('confirms the previous amount and retries the exact unresolved request even after inputs and saved data change', async () => {
    store.recordQuote.mockResolvedValueOnce({ quote: null, rejected: false })
    await render()
    await act(async () => saveButton().click())
    const first = store.recordQuote.mock.calls[0][0] as QuoteRequest
    expect(pendingQuote('owner', 'typed-adu')).toEqual(first)
    expect(store.toast).not.toHaveBeenCalled()
    await change('#est-h-design', '20')
    await change('#est-size', '850')
    store.jobs = store.jobs.map(item => item.id === 'typed-adu' ? { ...item, fee: 9000, size: 900 } : item)
    await render()
    await act(async () => saveButton().click())
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('earlier quote of $2,850')
    expect(dialog.textContent).toContain('Your current edited inputs will not be saved in this retry')
    expect(store.recordQuote).toHaveBeenCalledOnce()
    await clickDialog('Retry earlier save')
    expect(store.recordQuote).toHaveBeenCalledTimes(2)
    expect(store.recordQuote.mock.calls[1][0]).toEqual(first)
    expect(store.recordQuote.mock.calls[1][0]).toBe(first)
    expect(first.quote).toMatchObject({ fee: 2850, design_hours: 10, size: 600 })
    expect(first.expected).toMatchObject({ fee: null, size: 600 })
    expect(input('#est-h-design').value).toBe('20')
    expect(input('#est-size').value).toBe('850')
    expect(store.toast).toHaveBeenCalledWith('Quote of $2,850 saved to Alpha project', 'ok', expect.anything())
    expect(pendingQuote('owner', 'typed-adu')).toBeNull()
  })

  it('does not retry an unresolved save when its confirmation is cancelled', async () => {
    store.recordQuote.mockResolvedValue({ quote: null, rejected: false })
    await render()
    await act(async () => saveButton().click())
    const pending = pendingQuote('owner', 'typed-adu')
    await act(async () => saveButton().click())
    await clickDialog('Cancel')
    expect(store.recordQuote).toHaveBeenCalledOnce()
    expect(pendingQuote('owner', 'typed-adu')).toEqual(pending)
    expect(store.toast).not.toHaveBeenCalled()
    expect(saveButton().disabled).toBe(false)
  })
})
