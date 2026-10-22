import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Client } from '../lib/types'
import { ClientEditor } from './editors'

const store = vi.hoisted(() => ({
  clients: [] as Client[], jobs: [], insert: vi.fn(), update: vi.fn(), conditionalUpdate: vi.fn(), remove: vi.fn(), refresh: vi.fn(),
}))
vi.mock('../lib/store', () => ({ useData: () => store }))
vi.mock('./ui', () => ({
  Modal: ({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) => <section><h2>{title}</h2>{children}<footer>{footer}</footer></section>,
  Field: ({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) => <div><label htmlFor={htmlFor}>{label}</label>{children}</div>,
  NumberInput: () => null,
  Segmented: () => null,
  useConfirm: () => vi.fn(),
}))

let host: HTMLDivElement
let root: Root
let original: Client
const onClose = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  store.conditionalUpdate.mockResolvedValue(true)
  store.update.mockResolvedValue(true)
  store.refresh.mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  original = { id: 'client', name: 'Example client', contact_name: '', email: '', phone: '', address: '', notes: 'Original notes', is_sample: false, created_at: '' }
  store.clients = [original]
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

async function render() { await act(async () => root.render(<MemoryRouter><ClientEditor client={original} onClose={onClose} /></MemoryRouter>)) }
async function type(field: 'name' | 'notes', value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(field === 'notes' ? 'textarea' : 'input')!
  await act(async () => {
    const prototype = field === 'notes' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }) }
async function click(label: string) { await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click() }) }

describe('client editor note conflicts', () => {
  it('keeps the draft after a conflict and can explicitly retry against the latest saved notes', async () => {
    store.conditionalUpdate.mockImplementationOnce(async () => {
      store.clients = [{ ...original, notes: 'Edited in another tab' }]
      return false
    })
    await render()
    await type('notes', 'My edited notes')
    await submit()
    expect(store.conditionalUpdate).toHaveBeenLastCalledWith('clients', 'client', expect.objectContaining({ notes: 'My edited notes' }), { notes: 'Original notes' })
    expect(host.querySelector('textarea')!.value).toBe('My edited notes')
    expect(host.textContent).toContain('Edited in another tab')
    expect(onClose).not.toHaveBeenCalled()
    await submit()
    expect(store.conditionalUpdate).toHaveBeenCalledTimes(1)
    await click('Save my version')
    expect(store.conditionalUpdate).toHaveBeenLastCalledWith('clients', 'client', expect.objectContaining({ notes: 'My edited notes' }), { notes: 'Edited in another tab' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('can adopt the latest notes without losing other typed contact changes', async () => {
    store.conditionalUpdate.mockImplementationOnce(async () => {
      store.clients = [{ ...original, notes: 'Latest notes' }]
      return false
    })
    await render()
    await type('name', 'Updated client name')
    await type('notes', 'My edited notes')
    await submit()
    await click('Use latest notes')
    expect(host.querySelector('textarea')!.value).toBe('Latest notes')
    expect(host.querySelector('input')!.value).toBe('Updated client name')
    await submit()
    expect(store.update).toHaveBeenCalledWith('clients', 'client', expect.objectContaining({ name: 'Updated client name' }))
    expect(store.update.mock.calls[0][2]).not.toHaveProperty('notes')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('retains a raw null baseline when the first note is edited', async () => {
    original = { ...original, notes: null }; store.clients = [original]
    await render()
    await type('notes', 'First note')
    await submit()
    expect(store.conditionalUpdate).toHaveBeenCalledWith('clients', 'client', expect.objectContaining({ notes: 'First note' }), { notes: null })
  })

  it('does not write old notes back during a contact-only save', async () => {
    await render()
    store.clients = [{ ...original, notes: 'New note from another tab' }]
    await type('name', 'Updated client name')
    await submit()
    expect(store.conditionalUpdate).not.toHaveBeenCalled()
    expect(store.update.mock.calls[0][2]).not.toHaveProperty('notes')
  })
})
