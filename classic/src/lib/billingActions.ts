import { jobCharges } from './calc'

export interface InvoiceWorkLink {
  table: 'time_entries' | 'job_items'
  id: string
  amount: number
  depositApplied: number
}

/** Capture credits before any row becomes billed, including on a later retry. */
export function invoiceWorkLinks(
  store: Parameters<typeof jobCharges>[0], jobId: string, entryIds: string[], itemIds: string[],
): InvoiceWorkLink[] {
  const charges = jobCharges(store, jobId)
  const links: InvoiceWorkLink[] = []
  for (const id of new Set(entryIds)) {
    const h = charges.hours.find(h => h.entry.id === id && (h.status === 'unbilled' || h.status === 'partial'))
    if (!h) throw new Error('Selected hours have changed. Close this form and select the unbilled work again.')
    links.push({ table: 'time_entries', id, amount: h.amount, depositApplied: h.covered })
  }
  for (const id of new Set(itemIds)) {
    const i = charges.items.find(i => i.item.id === id && (i.status === 'unbilled' || i.status === 'partial'))
    if (!i) throw new Error('Selected charges have changed. Close this form and select the unbilled work again.')
    links.push({ table: 'job_items', id, amount: i.amount, depositApplied: i.covered })
  }
  return links
}
