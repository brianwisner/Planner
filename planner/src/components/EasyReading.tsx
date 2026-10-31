// Easy reading controls: the full set in Settings → Appearance, and a single
// switch for the sign-in screen. The choice is remembered on this device only.
import { useEasyReading, type EasyColors, type TextSize } from '../lib/theme'
import './easyReading.css'

const SIZES: { value: TextSize; label: string; hint: string }[] = [
  { value: 'large', label: 'Large', hint: 'Text 25% bigger' },
  { value: 'xlarge', label: 'Extra large', hint: 'Text 50% bigger' },
]

const COLORS: { value: EasyColors; label: string; hint: string }[] = [
  { value: 'cream', label: 'Cream', hint: 'Black text on a soft cream page' },
  { value: 'dark', label: 'Dark', hint: 'Light text on black — less glare' },
  { value: 'yellow', label: 'Yellow on black', hint: 'Highest contrast' },
]

export function EasyReadingSwitch({ label = 'Easy reading' }: { label?: string }) {
  const [easy, setEasy] = useEasyReading()
  return <label className="switch easy-switch">
    <input type="checkbox" checked={easy.on} onChange={e => setEasy({ ...easy, on: e.target.checked })} />
    <span>{label}</span>
  </label>
}

export function EasyReadingSettings() {
  const [easy, setEasy] = useEasyReading()
  return <div className="easy-settings stack">
    <div className="easy-intro">
      <EasyReadingSwitch />
      <p className="small soft">Larger, clearer text in Atkinson Hyperlegible — a typeface made for people with low vision — and strong, high-contrast colors. Only on this device; printed letters and invoices don’t change.</p>
    </div>
    {easy.on && <>
      <div className="easy-choice" role="group" aria-label="Text size">
        <span className="field-label">Text size</span>
        <div className="easy-options">
          {SIZES.map(s => <button key={s.value} type="button" aria-pressed={easy.size === s.value} className={`easy-option ${easy.size === s.value ? 'on' : ''}`} onClick={() => setEasy({ ...easy, size: s.value })}>
            <span className={`easy-aa size-${s.value}`} aria-hidden="true">Aa</span>
            <span className="easy-option-text"><strong>{s.label}</strong><span>{s.hint}</span></span>
          </button>)}
        </div>
      </div>
      <div className="easy-choice" role="group" aria-label="Colors">
        <span className="field-label">Colors</span>
        <div className="easy-options">
          {COLORS.map(c => <button key={c.value} type="button" aria-pressed={easy.colors === c.value} className={`easy-option ${easy.colors === c.value ? 'on' : ''}`} onClick={() => setEasy({ ...easy, colors: c.value })}>
            <span className="easy-swatch" data-colors={c.value} aria-hidden="true">Aa</span>
            <span className="easy-option-text"><strong>{c.label}</strong><span>{c.hint}</span></span>
          </button>)}
        </div>
      </div>
    </>}
  </div>
}
