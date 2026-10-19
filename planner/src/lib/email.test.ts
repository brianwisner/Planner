import { describe, expect, it } from 'vitest'
import { gmailLink } from './email'

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

  it('sends from the owner\'s Gmail account when signed in with one', () => {
    expect(new URL(gmailLink('a@b.com', { account: 'owner@gmail.com' })).searchParams.get('authuser')).toBe('owner@gmail.com')
    expect(new URL(gmailLink('a@b.com', { account: 'owner@company.com' })).searchParams.has('authuser')).toBe(false)
    expect(new URL(gmailLink('a@b.com', { account: null })).searchParams.has('authuser')).toBe(false)
  })

  it('leaves out empty fields', () => {
    const url = new URL(gmailLink('  ', {}))
    expect([...url.searchParams.keys()]).toEqual(['view', 'fs'])
  })
})
