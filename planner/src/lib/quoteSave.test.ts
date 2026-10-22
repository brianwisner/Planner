import { describe, expect, it } from 'vitest'
import { forgetQuote, pendingQuote, rememberQuote, type QuoteRequest } from './quoteSave'

describe('pending quote requests', () => {
  it('retains the original quote and expected values for retry, scoped to owner and job', () => {
    const request = { id: 'retry-id', quote: { job_id: 'test-job', fee: 500 }, expected: { fee: null, job_type_id: null, size: null, phases: [] } } as unknown as QuoteRequest
    rememberQuote('owner', request)
    expect(pendingQuote('owner', 'test-job')).toEqual(request)
    expect(pendingQuote('other-owner', 'test-job')).toBeNull()
    expect(JSON.parse(sessionStorage.getItem('planner:pending-quote:owner:test-job')!)).toEqual(request)
    forgetQuote('owner', 'test-job')
    expect(pendingQuote('owner', 'test-job')).toBeNull()
    expect(sessionStorage.getItem('planner:pending-quote:owner:test-job')).toBeNull()
  })
  it('recovers an unresolved request after component/navigation state is lost', () => {
    const request = { id: 'recovered', quote: { job_id: 'reload-job', fee: 700 }, expected: { phases: [] } }
    sessionStorage.setItem('planner:pending-quote:owner:reload-job', JSON.stringify(request))
    expect(pendingQuote('owner', 'reload-job')).toEqual(request)
    forgetQuote('owner', 'reload-job')
  })
})
