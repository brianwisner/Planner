import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gmailLink, isEmailAddress, useEmailLink } from './email'

const sender = vi.hoisted(() => ({
  demo: false, businessEmail: '', profileEmail: null as string | null, sessionEmail: null as string | null,
}))
vi.mock('./store', () => ({
  useData: () => ({
    settings: { business_email: sender.businessEmail },
    me: sender.profileEmail ? { email: sender.profileEmail } : null,
    session: sender.sessionEmail ? { user: { email: sender.sessionEmail } } : null,
  }),
}))
vi.mock('./supabase', () => ({ get DEMO() { return sender.demo } }))

beforeEach(() => { sender.demo = false; sender.businessEmail = ''; sender.profileEmail = null; sender.sessionEmail = null })

describe('gmailLink', () => {
  it('opens a Gmail message with the address, subject and body filled in', () => {
    const url = new URL(gmailLink('pat@example.com', { subject: 'Invoice INV-1001 — Deck', body: 'Hi Pat,\n\nThanks & regards' }))
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/')
    expect(url.searchParams.get('view')).toBe('cm')
    expect(url.searchParams.get('to')).toBe('pat@example.com')
    expect(url.searchParams.get('su')).toBe('Invoice INV-1001 — Deck')
    expect(url.searchParams.get('body')).toBe('Hi Pat,\n\nThanks & regards')
    expect(url.search).not.toContain('+') // spaces are %20, never "+"
  })

  it.each(['owner@gmail.com', 'owner@googlemail.com', 'owner@company.com', 'owner+invoices@company.co.uk'])('selects the Google account: %s', account => {
    const url = new URL(gmailLink('a@b.com', { account }))
    expect(url.searchParams.get('authuser')).toBe(account)
    expect([...url.searchParams.keys()]).toEqual(['authuser', 'view', 'fs', 'to'])
  })

  it('trims the account address and preserves alias and message encoding', () => {
    const url = new URL(gmailLink('a@b.com', { account: '  owner+invoices@company.com  ', subject: 'Plans & invoice', body: 'A + B\nThanks' }))
    expect(url.searchParams.get('authuser')).toBe('owner+invoices@company.com')
    expect(url.searchParams.get('su')).toBe('Plans & invoice')
    expect(url.searchParams.get('body')).toBe('A + B\nThanks')
    expect(url.search).not.toContain('+')
  })

  it.each([null, '', ' ', '0', 'owner', 'owner@', '@company.com', 'owner@@company.com', 'Owner <owner@company.com>', 'owner@company.com\nother@company.com'])('omits an empty or invalid account: %j', account => {
    expect(new URL(gmailLink('a@b.com', { account })).searchParams.has('authuser')).toBe(false)
  })

  it('leaves out empty fields', () => {
    const url = new URL(gmailLink('  ', {}))
    expect([...url.searchParams.keys()]).toEqual(['view', 'fs'])
  })
})

describe('isEmailAddress', () => {
  it('validates business addresses and aliases after trimming surrounding spaces', () => {
    expect(isEmailAddress('  owner+invoices@company.com  ')).toBe(true)
    expect(isEmailAddress('Owner <owner@company.com>')).toBe(false)
    expect(isEmailAddress('owner@')).toBe(false)
    expect(isEmailAddress('owner@-company.com')).toBe(false)
    expect(isEmailAddress('owner@company..com')).toBe(false)
  })
})

describe('useEmailLink', () => {
  it('uses the saved business email before the personal profile and sign-in emails', () => {
    sender.businessEmail = '  office@company.com  '
    sender.profileEmail = 'personal@gmail.com'
    sender.sessionEmail = 'another@gmail.com'
    expect(new URL(useEmailLink()('client@example.com')).searchParams.get('authuser')).toBe('office@company.com')
  })

  it.each(['', '  '])('keeps the profile-first login fallback when business email is blank: %j', businessEmail => {
    sender.businessEmail = businessEmail
    sender.profileEmail = 'personal@gmail.com'
    sender.sessionEmail = 'another@gmail.com'
    expect(new URL(useEmailLink()('client@example.com')).searchParams.get('authuser')).toBe('personal@gmail.com')
  })

  it('uses the sign-in email before the profile loads when business email is blank', () => {
    sender.sessionEmail = 'owner@company.com'
    expect(new URL(useEmailLink()('client@example.com')).searchParams.get('authuser')).toBe('owner@company.com')
  })

  it('leaves Gmail to choose an account when no business or owner email is available', () => {
    expect(new URL(useEmailLink()('client@example.com')).searchParams.has('authuser')).toBe(false)
  })

  it('does not replace an invalid saved business email with the personal account', () => {
    sender.businessEmail = 'not-an-email'
    sender.profileEmail = sender.sessionEmail = 'personal@gmail.com'
    expect(new URL(useEmailLink()('client@example.com')).searchParams.has('authuser')).toBe(false)
  })

  it('never selects a fictional account in the practice copy', () => {
    sender.demo = true
    sender.businessEmail = 'office@example.com'
    sender.profileEmail = sender.sessionEmail = 'owner@example.com'
    const url = new URL(useEmailLink()('client@example.com', 'Demo message', 'Made-up data'))
    expect(url.searchParams.has('authuser')).toBe(false)
    expect(url.searchParams.get('to')).toBe('client@example.com')
    expect(url.searchParams.get('su')).toBe('Demo message')
    expect(url.searchParams.get('body')).toBe('Made-up data')
  })
})
