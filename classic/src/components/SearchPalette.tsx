// Global search (press / or click the search box): finds jobs, clients and tasks.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../lib/store'
import { Modal } from './ui'

interface Result { kind: 'Job' | 'Client' | 'Task'; title: string; sub: string; to: string }

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { jobs, clients, tasks } = useData()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const hit = (s: string | null | undefined) => (s ?? '').toLowerCase().includes(needle)
    const out: Result[] = []
    for (const j of jobs) if (hit(j.name) || hit(j.job_number) || hit(j.address) || hit(j.description))
      out.push({ kind: 'Job', title: `${j.job_number ? j.job_number + ' · ' : ''}${j.name}`, sub: clients.find(c => c.id === j.client_id)?.name ?? '', to: `/jobs/${j.id}` })
    for (const c of clients) if (hit(c.name) || hit(c.contact_name) || hit(c.email) || hit(c.phone))
      out.push({ kind: 'Client', title: c.name, sub: c.contact_name, to: `/clients/${c.id}` })
    for (const t of tasks) if (hit(t.title) || hit(t.description))
      out.push({ kind: 'Task', title: t.title, sub: jobs.find(j => j.id === t.job_id)?.name ?? '', to: `/jobs/${t.job_id}?task=${t.id}` })
    return out.slice(0, 20)
  }, [q, jobs, clients, tasks])

  function go(r: Result) { nav(r.to); onClose() }

  return (
    <Modal title={null} onClose={onClose} className="palette">
      <input ref={inputRef} type="search" placeholder="Search jobs, clients, tasks…" value={q}
        onChange={e => { setQ(e.target.value); setSel(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
          if (e.key === 'Enter' && results[sel]) go(results[sel])
        }} />
      <div className="results">
        {q && results.length === 0 && <div className="empty">Nothing found</div>}
        {results.map((r, i) => (
          <div key={r.to + r.title} className={`result ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
            <span className="kind">{r.kind}</span>
            <span className="grow">{r.title}</span>
            <span className="small muted">{r.sub}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
