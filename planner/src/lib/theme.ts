// Light / dark appearance. "system" follows the device setting.
export type Theme = 'system' | 'light' | 'dark'
const KEY = 'wp2:theme'

export function savedTheme(): Theme {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  try { localStorage.setItem(KEY, theme) } catch { /* private mode */ }
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1217' : '#f5f6f8')
}

/** Small per-device preferences (remembered view, filters). Never business data. */
export function pref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(`wp2:${key}`); return v == null ? fallback : JSON.parse(v) as T } catch { return fallback }
}
export function setPref(key: string, value: unknown) {
  try { localStorage.setItem(`wp2:${key}`, JSON.stringify(value)) } catch { /* private mode */ }
}
