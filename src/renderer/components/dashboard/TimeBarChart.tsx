import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import type { ChartDataPoint, SessionSummary } from '@shared/types'

const APP_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#f06292',
  '#4db6ac', '#ff8a65', '#ba68c8', '#90a4ae'
]

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

const TOP_N = 7

interface BreakdownProps {
  appSummaries: SessionSummary[]
}

function AppBreakdown({ appSummaries }: BreakdownProps): JSX.Element | null {
  const totalActive = appSummaries.reduce((acc, a) => acc + a.active_ms, 0)
  if (totalActive === 0) return null

  const topApps = appSummaries.slice(0, TOP_N)
  const otherMs = appSummaries.slice(TOP_N).reduce((acc, a) => acc + a.active_ms, 0)
  const maxMs = topApps[0]?.active_ms ?? 0
  if (maxMs === 0) return null

  return (
    <div className="chart-breakdown">
      <div className="chart-breakdown__title">Top Apps · Active Time</div>
      {topApps.map((app, i) => (
        <div key={app.app_id} className="chart-breakdown__row">
          <span className="chart-breakdown__dot" style={{ background: APP_COLORS[i] }} />
          <span className="chart-breakdown__name" title={app.display_name}>{app.display_name}</span>
          <div className="chart-breakdown__bar-wrap">
            <div
              className="chart-breakdown__bar"
              style={{ width: `${(app.active_ms / maxMs) * 100}%`, background: APP_COLORS[i] }}
            />
          </div>
          <span className="chart-breakdown__time">{fmtMs(app.active_ms)}</span>
          <span className="chart-breakdown__pct">{Math.round((app.active_ms / totalActive) * 100)}%</span>
        </div>
      ))}
      {otherMs > 0 && (
        <div className="chart-breakdown__row chart-breakdown__row--other">
          <span className="chart-breakdown__dot" style={{ background: 'var(--color-text-dim)' }} />
          <span className="chart-breakdown__name">Other</span>
          <div className="chart-breakdown__bar-wrap">
            <div
              className="chart-breakdown__bar"
              style={{ width: `${(otherMs / maxMs) * 100}%`, background: 'var(--color-text-dim)' }}
            />
          </div>
          <span className="chart-breakdown__time">{fmtMs(otherMs)}</span>
          <span className="chart-breakdown__pct">{Math.round((otherMs / totalActive) * 100)}%</span>
        </div>
      )}
    </div>
  )
}

interface Props {
  data: ChartDataPoint[]
  appSummaries?: SessionSummary[]
}

export default function TimeBarChart({ data, appSummaries = [] }: Props): JSX.Element {
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

      {appSummaries.length > 0 && <AppBreakdown appSummaries={appSummaries} />}
    </div>
  )
}
