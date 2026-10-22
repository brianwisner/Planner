import type { Job, Phase, Quote } from './types'

export type QuoteInput = Omit<Quote, 'id' | 'created_at'>
export interface QuoteExpected {
  fee: Job['fee']; job_type_id: Job['job_type_id']; size: Job['size']
  phases: Pick<Phase, 'id' | 'estimate_hours'>[]
}
export interface QuoteRequest { id: string; quote: QuoteInput; expected: QuoteExpected }
export interface QuoteSaveResult { quote: Quote | null; rejected: boolean }

// Keep an unresolved request through navigation/reload. A lost response must not
// turn a retry into a second quote or overwrite a newer edit with a new request.
const pending = new Map<string, QuoteRequest>()
const keyFor = (owner: string, job: string) => `planner:pending-quote:${owner}:${job}`
export function pendingQuote(owner: string, job: string): QuoteRequest | null {
  const key = keyFor(owner, job)
  if (pending.has(key)) return pending.get(key)!
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) {
      const value = JSON.parse(raw) as QuoteRequest
      if (value.id && value.quote?.job_id === job && Array.isArray(value.expected?.phases)) {
        pending.set(key, value); return value
      }
    }
  } catch { /* In-memory retry protection still works if storage is unavailable. */ }
  return null
}
export function rememberQuote(owner: string, request: QuoteRequest) {
  const key = keyFor(owner, request.quote.job_id)
  pending.set(key, request)
  try { sessionStorage.setItem(key, JSON.stringify(request)) } catch { /* See above. */ }
}
export function forgetQuote(owner: string, job: string) {
  const key = keyFor(owner, job)
  pending.delete(key)
  try { sessionStorage.removeItem(key) } catch { /* See above. */ }
}
