// Light / dark appearance. "system" follows the device setting.
import { useSyncExternalStore } from 'react'

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
  updateThemeColor()
}

// Easy reading: bigger text in Atkinson Hyperlegible (made for low vision) and
// high-contrast colors. Per device, so it can be on for one person's computer
// or phone without changing anyone else's. Stored as data-easy (the colors)
// and data-text-size on <html>; styles live in tokens.css and easy.css.
export type TextSize = 'large' | 'xlarge'
export type EasyColors = 'cream' | 'dark' | 'yellow'
export interface EasyReading { on: boolean; size: TextSize; colors: EasyColors }
const EASY_KEY = 'wp2:easy'

export function savedEasy(): EasyReading {
  let v: Partial<EasyReading> | null = null
  try { v = JSON.parse(localStorage.getItem(EASY_KEY) ?? 'null') } catch { /* private mode or bad value */ }
  return {
    on: v?.on === true,
    size: v?.size === 'xlarge' ? 'xlarge' : 'large',
    colors: v?.colors === 'dark' || v?.colors === 'yellow' ? v.colors : 'cream',
  }
}

let easy = savedEasy()
const listeners = new Set<() => void>()

export function applyEasy(next: EasyReading) {
  easy = next
  const root = document.documentElement
  if (next.on) { root.dataset.easy = next.colors; root.dataset.textSize = next.size }
  else { delete root.dataset.easy; delete root.dataset.textSize }
  try { localStorage.setItem(EASY_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  updateThemeColor()
  listeners.forEach(l => l())
}

/** The current easy-reading choice and a setter that applies it right away. */
export function useEasyReading(): [EasyReading, (next: EasyReading) => void] {
  const value = useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => easy)
  return [value, applyEasy]
}

const EASY_BAR: Record<EasyColors, string> = { cream: '#f2ede1', dark: '#0b0b0b', yellow: '#000000' }

function updateThemeColor() {
  const root = document.documentElement
  const colors = root.dataset.easy as EasyColors | undefined
  const theme = root.dataset.theme
  const dark = theme === 'dark' || (!theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const color = colors && EASY_BAR[colors] ? EASY_BAR[colors] : dark ? '#0e1217' : '#f5f6f8'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

/** Small per-device preferences (remembered view, filters). Never business data. */
export function pref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(`wp2:${key}`); return v == null ? fallback : JSON.parse(v) as T } catch { return fallback }
}
export function setPref(key: string, value: unknown) {
  try { localStorage.setItem(`wp2:${key}`, JSON.stringify(value)) } catch { /* private mode */ }
}
