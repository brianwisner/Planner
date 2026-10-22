import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '../lib/types'
import { ClientNotes } from './ClientNotes'

const store = vi.hoisted(() => ({ conditionalUpdate: vi.fn(), toast: vi.fn() }))
vi.mock('../lib/store', () => ({ useData: () => store }))
let host: HTMLDivElement
let root: Root
let client: Client

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  store.conditionalUpdate.mockResolvedValue(true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = { id: 'client', name: 'Example client', contact_name: '', email: '', phone: '', address: '', notes: 'Original notes', is_sample: false, created_at: '' }
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render() { await act(async () => root.render(<ClientNotes client={client} compact />)) }
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)!
  await act(async () => button.click())
}
async function type(text: string) {
  const field = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('client notes', () => {
  it('saves a first note with a null original value', async () => {
    client.notes = null
    await render()
    await click('Add notes')
    await type('New client preference')
    await click('Save notes')
    expect(store.conditionalUpdate).toHaveBeenCalledWith('clients', 'client', { notes: 'New client preference' }, { notes: null })
    expect(store.toast).toHaveBeenCalledWith('Client notes saved')
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('keeps the typed draft after a rejected save', async () => {
    store.conditionalUpdate.mockResolvedValue(false)
    await render()
    await click('Edit notes')
    await type('Keep this draft')
    await click('Save notes')
    expect(host.querySelector('textarea')!.value).toBe('Keep this draft')
    expect(host.textContent).toContain('Your draft is still here')
    expect(store.toast).not.toHaveBeenCalled()
  })

  it('requires an explicit choice to replace concurrently changed notes', async () => {
    await render()
    await click('Edit notes')
    await type('My version')
    client = { ...client, notes: 'Saved from another tab' }
    await render()
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(store.conditionalUpdate).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Saved from another tab')
    expect(host.querySelector('textarea')!.value).toBe('My version')
    await click('Save my version')
    expect(store.conditionalUpdate).toHaveBeenCalledWith('clients', 'client', { notes: 'My version' }, { notes: 'Saved from another tab' })
  })

  it('cancels without a write and opens the latest saved value next time', async () => {
    await render()
    await click('Edit notes')
    await type('Discard this draft')
    await click('Cancel')
    client = { ...client, notes: 'Latest note' }
    await render()
    await click('Edit notes')
    expect(host.querySelector('textarea')!.value).toBe('Latest note')
    expect(store.conditionalUpdate).not.toHaveBeenCalled()
  })

  it('blocks repeated saves while waiting for confirmation', async () => {
    let resolve!: (ok: boolean) => void
    store.conditionalUpdate.mockReturnValue(new Promise<boolean>(done => { resolve = done }))
    await render()
    await click('Edit notes')
    await type('Save once')
    const form = host.querySelector('form')!
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(store.conditionalUpdate).toHaveBeenCalledTimes(1)
    expect(host.querySelector('textarea')!.disabled).toBe(true)
    await act(async () => resolve(true))
    expect(host.querySelector('textarea')).toBeNull()
  })
})
