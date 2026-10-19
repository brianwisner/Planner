// Desktop keyboard shortcuts. Press ? in the app to see this list.
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './ui'

export const SHORTCUTS: [string, string][] = [
  ['n', 'New task (quick add)'],
  ['/', 'Search'],
  ['t', 'Log hours'],
  ['g then d', 'Go to Dashboard'],
  ['g then j', 'Go to Jobs'],
  ['g then c', 'Go to Clients'],
  ['g then a', 'Go to Calendar'],
  ['g then t', 'Go to Time'],
  ['g then b', 'Go to Billing'],
  ['g then r', 'Go to Reports'],
  ['Esc', 'Close any pop-up'],
  ['?', 'Show this help'],
]

const GO: Record<string, string> = { d: '/', j: '/jobs', c: '/clients', a: '/calendar', t: '/time', b: '/billing', r: '/reports' }

export function useShortcuts(actions: { quickAdd: () => void; search: () => void; logTime: () => void; help: () => void }) {
  const nav = useNavigate()
  useEffect(() => {
    let pendingG = 0
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('.modal-backdrop')) return
      const now = Date.now()
      if (pendingG && now - pendingG < 1200 && GO[e.key]) { e.preventDefault(); nav(GO[e.key]!); pendingG = 0; return }
      pendingG = 0
      switch (e.key) {
        case 'n': e.preventDefault(); actions.quickAdd(); break
        case '/': e.preventDefault(); actions.search(); break
        case 't': e.preventDefault(); actions.logTime(); break
        case '?': e.preventDefault(); actions.help(); break
        case 'g': pendingG = now; break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nav, actions])
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <div className="shortcuts">
        {SHORTCUTS.map(([k, d]) => <div key={k}><span>{d}</span><kbd>{k}</kbd></div>)}
      </div>
    </Modal>
  )
}
