import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvoiceView } from './InvoiceView'

const data = vi.hoisted(() => ({
  settings: { id: 1, company_name: 'Example Engineering', business_email: 'office@company.example', default_rate: 150, weekly_capacity: 40 },
  me: { id: 'owner', full_name: 'Example Owner', email: 'personal@gmail.com' },
  session: { user: { id: 'owner', email: 'personal@gmail.com' } },
  invoices: [{ id: 'invoice', job_id: 'job', number: 'INV-1', amount: 150, issued_date: '2026-10-19', paid_date: null, notes: '' }],
  jobs: [{ id: 'job', client_id: 'client', name: 'Example project', job_number: '26-1', address: '' }],
  clients: [{ id: 'client', name: 'Example Client', contact_name: 'Pat', email: 'pat@client.example', address: '' }],
  timeEntries: [], items: [], phases: [],
}))
vi.mock('../lib/store', () => ({ useData: () => data }))
vi.mock('../lib/supabase', () => ({ DEMO: false }))
vi.mock('../components/editors', () => ({ useEditors: () => ({}) }))

beforeEach(() => { data.settings.business_email = 'office@company.example' })

function renderInvoice() {
  const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/money/invoice/invoice']}>
    <Routes><Route path="/money/invoice/:id" element={<InvoiceView />} /></Routes>
  </MemoryRouter>)
  const page = document.createElement('div')
  page.innerHTML = html
  return page
}

describe('invoice business contact', () => {
  it('prints the business email and selects it for the Gmail message while retaining the personal login', () => {
    const page = renderInvoice()
    const header = page.querySelector('.inv-head')!
    expect(header.textContent).toContain('office@company.example')
    expect(header.textContent).not.toContain('personal@gmail.com')
    const email = page.querySelector<HTMLAnchorElement>('a[aria-label="Email client"]')!
    expect(new URL(email.href).searchParams.get('authuser')).toBe('office@company.example')
    expect(new URL(email.href).searchParams.get('to')).toBe('pat@client.example')
    expect(data.session.user.email).toBe('personal@gmail.com')
    expect(data.me.email).toBe('personal@gmail.com')
  })

  it('keeps a blank business contact off the invoice while preserving the existing Gmail fallback', () => {
    data.settings.business_email = ''
    const page = renderInvoice()
    expect(page.querySelector('.inv-head')!.textContent).not.toContain('personal@gmail.com')
    const email = page.querySelector<HTMLAnchorElement>('a[aria-label="Email client"]')!
    expect(new URL(email.href).searchParams.get('authuser')).toBe('personal@gmail.com')
  })
})
