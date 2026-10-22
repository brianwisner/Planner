import { useId, useRef, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { useData } from '../lib/store'
import type { Client } from '../lib/types'
import './ClientNotes.css'

/** A client's shared notes, editable without opening their contact form. */
export function ClientNotes({ client, compact = false }: { client: Client; compact?: boolean }) {
  const { conditionalUpdate, toast } = useData()
  const inputId = useId()
  const savingRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [original, setOriginal] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const savedNotes = client.notes ?? ''
  const conflict = editing && client.notes !== original

  function edit() {
    setOriginal(client.notes)
    setDraft(savedNotes)
    setMessage('')
    setEditing(true)
  }
  function cancel() {
    if (savingRef.current) return
    setEditing(false)
    setMessage('')
  }
  async function save(replaceLatest = false) {
    if (savingRef.current || (conflict && !replaceLatest)) return
    const expected = replaceLatest ? client.notes : original
    const notes = draft.trim()
    if (notes === (expected ?? '')) { setEditing(false); setMessage(''); return }
    savingRef.current = true
    setSaving(true)
    setMessage('')
    try {
      const ok = await conditionalUpdate('clients', client.id, { notes }, { notes: expected })
      if (ok) { setEditing(false); toast('Client notes saved') }
      else setMessage('Notes were not saved. Your draft is still here.')
    } catch {
      setMessage('Could not save the notes. Your draft is still here. Try again.')
    } finally { savingRef.current = false; setSaving(false) }
  }

  return <section className={`client-notes-panel${compact ? ' compact' : ' card'}`} aria-label={`Notes for ${client.name}`} onClick={e => e.stopPropagation()}>
    <div className="client-notes-panel-head">
      <h3>Client notes</h3>
      {!editing && <button type="button" className="btn ghost sm" onClick={edit} aria-label={`${savedNotes ? 'Edit' : 'Add'} notes for ${client.name}`}>
        {savedNotes ? <Pencil size={14} /> : <Plus size={14} />}{savedNotes ? 'Edit notes' : 'Add notes'}
      </button>}
    </div>
    {editing ? <form className="client-notes-form" onSubmit={e => { e.preventDefault(); void save() }}>
      <label className="sr-only" htmlFor={inputId}>Notes for {client.name}</label>
      <textarea id={inputId} className="input" value={draft} onChange={e => setDraft(e.target.value)} rows={compact ? 4 : 6} autoFocus disabled={saving} placeholder="Preferences, reminders or anything to remember about this client…" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }} />
      {conflict && <div className="client-notes-conflict" role="alert">
        <p>The saved notes changed while you were editing. Your draft is still here.</p>
        <details><summary>Review the latest saved notes</summary><p className="client-notes-text">{savedNotes || 'No notes saved.'}</p></details>
        <p>“Save my version” replaces the saved notes with your draft.</p>
      </div>}
      {message && <p className="small danger-text" role="status">{message}</p>}
      <div className="client-notes-actions">
        <button type="button" className="btn" disabled={saving} onClick={cancel}>Cancel</button>
        {conflict
          ? <button type="button" className="btn primary" disabled={saving} onClick={() => void save(true)}>{saving ? 'Saving…' : 'Save my version'}</button>
          : <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save notes'}</button>}
      </div>
    </form> : <p className={`client-notes-text${savedNotes ? '' : ' muted'}`}>{savedNotes || 'Add preferences, reminders or other details about this client.'}</p>}
  </section>
}
