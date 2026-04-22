import { useState, useEffect, useRef, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell
} from 'recharts'
import type { ChartDataPoint, SessionSummary, BucketApp } from '@shared/types'
import { X } from 'lucide-react'
import { getIconUrl } from '../../utils/iconUrl'
import { api } from '../../api/bridge'

const APP_COLORS = [
  '#e8e8e8', '#888888', '#bbbbbb', '#666666',
  '#aaaaaa', '#999999', '#cccccc', '#777777'
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
      borderRadius: 0,
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
  const topApps = useMemo(() => appSummaries.slice(0, TOP_N), [appSummaries])

  // Stable key — only rebuild when the top-N app IDs change
  const topIds = useMemo(() => topApps.map((a) => a.app_id).join(','), [topApps])

  // No batch IPC needed — icons loaded via kioku:// protocol URLs

  const totalActive = appSummaries.reduce((acc, a) => acc + a.active_ms, 0)
  if (totalActive === 0) return null

  const otherMs = appSummaries.slice(TOP_N).reduce((acc, a) => acc + a.active_ms, 0)
  const maxMs = topApps[0]?.active_ms ?? 0
  if (maxMs === 0) return null

  return (
    <div className="chart-breakdown">
      <div className="chart-breakdown__title">Top Apps · Active Time</div>
      {topApps.map((app, i) => {
        return (
          <div key={app.app_id} className="chart-breakdown__row">
            <span className="chart-breakdown__dot" style={{ background: APP_COLORS[i] }} />
            <img
              src={getIconUrl('app', app.app_id)}
              alt=""
              width={20}
              height={20}
              style={{ borderRadius: 0, objectFit: 'contain', flexShrink: 0 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
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
        )
      })}
      {otherMs > 0 && (
        <div className="chart-breakdown__row chart-breakdown__row--other">
          <span className="chart-breakdown__dot" style={{ background: 'var(--color-text-dim)' }} />
          <div style={{ width: 20, height: 20 }} />
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

interface DrilldownPopover {
  bucketDate: string
  apps: BucketApp[]
  x: number
  y: number
}

function parseBucketRange(date: string): { from: number; to: number } {
  // date is either 'YYYY-MM-DD' or 'YYYY-MM-DD HH:00'
  if (date.includes(' ')) {
    const from = new Date(date.replace(' ', 'T') + ':00').getTime()
    return { from, to: from + 3_600_000 - 1 }
  }
  const from = new Date(date + 'T00:00:00').getTime()
  return { from, to: from + 86_400_000 - 1 }
}

interface Props {
  data: ChartDataPoint[]
  appSummaries?: SessionSummary[]
}

export default function TimeBarChart({ data, appSummaries = [] }: Props): JSX.Element {
  const [drilldown, setDrilldown] = useState<DrilldownPopover | null>(null)
  const [activeBucket, setActiveBucket] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!drilldown) return
    function handler(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDrilldown(null)
        setActiveBucket(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [drilldown])

  async function handleBarClick(barData: ChartDataPoint, _index: number, e: React.MouseEvent): Promise<void> {
    if (activeBucket === barData.date) {
      setDrilldown(null)
      setActiveBucket(null)
      return
    }
    setActiveBucket(barData.date)
    try {
      const { from, to } = parseBucketRange(barData.date)
      const apps = await api.getBucketApps(from, to)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setDrilldown({ bucketDate: barData.date, apps, x: rect.left, y: rect.top })
    } catch {
      setActiveBucket(null)
    }
  }

  return (
    <div className="chart-container" ref={containerRef} style={{ position: 'relative' }}>
      <div className="chart-header">
        <span className="chart-title">Time Overview</span>
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
          <Bar
            dataKey="active_ms"
            name="Focused"
            fill="#e8e8e8"
            radius={[0, 0, 0, 0]}
            maxBarSize={40}
            style={{ cursor: 'pointer' }}
            onClick={(barData: ChartDataPoint, index: number, e: React.MouseEvent) => handleBarClick(barData, index, e)}
          >
            {data.map((entry) => (
              <Cell
                key={entry.date}
                fill={activeBucket === entry.date ? '#ffffff' : '#e8e8e8'}
                opacity={activeBucket && activeBucket !== entry.date ? 0.55 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {appSummaries.length > 0 && <AppBreakdown appSummaries={appSummaries} />}

      {/* Drill-down popover */}
      {drilldown && (
        <div
          className="chart-drilldown"
          style={{ position: 'fixed', left: drilldown.x, top: drilldown.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          <div className="chart-drilldown__header">
            <span className="chart-drilldown__title">{fmtLabel(drilldown.bucketDate)}</span>
            <button
              className="chart-drilldown__close"
              onClick={() => { setDrilldown(null); setActiveBucket(null) }}
              title="Close"
            >
              <X size={12} />
            </button>
          </div>
          {drilldown.apps.length === 0 ? (
            <div className="chart-drilldown__empty">No data</div>
          ) : (
            drilldown.apps.map((app) => (
              <div key={app.app_id} className="chart-drilldown__row">
                <span className="chart-drilldown__name">{app.display_name}</span>
                <span className="chart-drilldown__time">{fmtMs(app.active_ms)}</span>
              </div>
            ))
          )}
          <div className="chart-drilldown__arrow" />
        </div>
      )}
    </div>
  )
}
