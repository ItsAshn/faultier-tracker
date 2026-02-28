import type { DateRangePreset } from '@shared/types'
import { useSessionStore } from '../../store/sessionStore'

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'This Week' },
  { key: 'month', label: 'This Month' }
]

export default function DateRangePicker(): JSX.Element {
  const preset = useSessionStore((s) => s.preset)
  const setPreset = useSessionStore((s) => s.setPreset)

  return (
    <div className="date-range-picker">
      {PRESETS.map(({ key, label }) => (
        <button
          key={key}
          className={`date-range-picker__tab${preset === key ? ' date-range-picker__tab--active' : ''}`}
          onClick={() => setPreset(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
