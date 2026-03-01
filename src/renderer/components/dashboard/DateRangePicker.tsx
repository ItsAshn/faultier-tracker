import { useEffect, useRef, useState } from 'react'
import type { DateRangePreset } from '@shared/types'
import { useSessionStore } from '../../store/sessionStore'

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all',   label: 'All Time' },
  { key: 'custom', label: 'Custom' }
]

function toDateInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fromDateInput(val: string): number {
  return new Date(val + 'T00:00:00').getTime()
}

export default function DateRangePicker(): JSX.Element {
  const preset = useSessionStore((s) => s.preset)
  const customFrom = useSessionStore((s) => s.customFrom)
  const customTo = useSessionStore((s) => s.customTo)
  const setPreset = useSessionStore((s) => s.setPreset)
  const setCustomRange = useSessionStore((s) => s.setCustomRange)

  const today = toDateInput(Date.now())
  const [fromVal, setFromVal] = useState(customFrom ? toDateInput(customFrom) : today)
  const [toVal, setToVal] = useState(customTo ? toDateInput(customTo) : today)
  const [showCustom, setShowCustom] = useState(preset === 'custom')

  const fromRef = useRef<HTMLInputElement>(null)

  // Arrow keys cycle through non-custom presets
  useEffect(() => {
    const nonCustomKeys = PRESETS.filter((p) => p.key !== 'custom').map((p) => p.key)
    function handler(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const currentIdx = nonCustomKeys.indexOf(preset as DateRangePreset)
      if (currentIdx === -1) return
      const next = e.key === 'ArrowLeft'
        ? nonCustomKeys[Math.max(0, currentIdx - 1)]
        : nonCustomKeys[Math.min(nonCustomKeys.length - 1, currentIdx + 1)]
      if (next && next !== preset) {
        setShowCustom(false)
        setPreset(next)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [preset, setPreset])

  function handleTabClick(key: DateRangePreset): void {
    if (key === 'custom') {
      setShowCustom(true)
      setPreset('custom')
      setTimeout(() => fromRef.current?.focus(), 50)
    } else {
      setShowCustom(false)
      setPreset(key)
    }
  }

  function applyCustomRange(): void {
    if (!fromVal || !toVal) return
    const from = fromDateInput(fromVal)
    const to = fromDateInput(toVal) + 86_400_000 - 1 // end of day
    if (from > to) return
    setCustomRange(from, to)
  }

  useEffect(() => {
    if (preset !== 'custom') {
      setShowCustom(false)
    }
  }, [preset])

  return (
    <div className="date-range-picker-wrap">
      <div className="date-range-picker">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            className={`date-range-picker__tab${preset === key ? ' date-range-picker__tab--active' : ''}`}
            onClick={() => handleTabClick(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {showCustom && (
        <div className="date-range-picker__custom">
          <input
            ref={fromRef}
            type="date"
            className="date-range-picker__date-input"
            value={fromVal}
            max={toVal || today}
            onChange={(e) => setFromVal(e.target.value)}
            onBlur={applyCustomRange}
          />
          <span className="date-range-picker__custom-sep">—</span>
          <input
            type="date"
            className="date-range-picker__date-input"
            value={toVal}
            min={fromVal}
            max={today}
            onChange={(e) => setToVal(e.target.value)}
            onBlur={applyCustomRange}
          />
        </div>
      )}
    </div>
  )
}
