import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import type { ChartDataPoint } from '@shared/types'

function fmtMs(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtLabel(date: string): string {
  // date is either "YYYY-MM-DD" or "YYYY-MM-DD HH:00"
  if (date.includes(' ')) return date.split(' ')[1]
  const parts = date.split('-')
  return `${parts[2]}/${parts[1]}`
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ value: number; name: string; color: string }>
  label?: string
}

function CustomTooltip({ active, payload, label }: TooltipProps): JSX.Element | null {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 12px',
      fontSize: 'var(--text-xs)'
    }}>
      <div style={{ color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{fmtMs(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

interface Props {
  data: ChartDataPoint[]
}

export default function TimeBarChart({ data }: Props): JSX.Element {
  const [showActive, setShowActive] = useState(true)
  const [showRunning, setShowRunning] = useState(true)

  return (
    <div className="chart-container">
      <div className="chart-header">
        <span className="chart-title">Time Overview</span>
        <div className="chart-legend">
          <button
            className={`chart-legend__item${!showActive ? ' chart-legend__item--hidden' : ''}`}
            onClick={() => setShowActive((v) => !v)}
          >
            <span className="chart-legend__dot" style={{ background: '#4fc3f7' }} />
            Active
          </button>
          <button
            className={`chart-legend__item${!showRunning ? ' chart-legend__item--hidden' : ''}`}
            onClick={() => setShowRunning((v) => !v)}
          >
            <span className="chart-legend__dot" style={{ background: '#7986cb' }} />
            Running
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtLabel}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => fmtMs(v)}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          {showActive && (
            <Bar dataKey="active_ms" name="Active" fill="#4fc3f7" radius={[3, 3, 0, 0]} maxBarSize={40} />
          )}
          {showRunning && (
            <Bar dataKey="running_ms" name="Running" fill="#7986cb" radius={[3, 3, 0, 0]} maxBarSize={40} />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
