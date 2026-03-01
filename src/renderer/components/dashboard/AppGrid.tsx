import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor } from 'lucide-react'
import type { AppRecord, SessionSummary } from '@shared/types'
import { api } from '../../api/bridge'

function fmtMs(ms: number): string {
  if (ms < 60_000) return '—'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export type GridPeriod = 'week' | 'month' | 'all'

const PERIOD_LABELS: Record<GridPeriod, string> = {
  week: 'This Week',
  month: 'This Month',
  all: 'All Time',
}

interface Props {
  summaries: SessionSummary[]
  allApps: AppRecord[]
  period: GridPeriod
  onPeriodChange: (p: GridPeriod) => void
  loading: boolean
}

export default function AppGrid({ summaries, allApps, period, onPeriodChange, loading }: Props): JSX.Element {
  const navigate = useNavigate()
  const [icons, setIcons] = useState<Map<number, string>>(new Map())

  // Stable string key — only changes when the actual app IDs change
  const appIds = useMemo(() => allApps.map((a) => a.id).join(','), [allApps])

  useEffect(() => {
    if (allApps.length === 0) return
    Promise.all(
      allApps.map((app) => api.getIconForApp(app.id).then((icon) => ({ id: app.id, icon })))
    ).then((results) => {
      const m = new Map<number, string>()
      for (const r of results) {
        if (r.icon) m.set(r.id, r.icon)
      }
      setIcons(m)
    })
  }, [appIds])

  // Memoize the merge+sort so it doesn't run on every parent render
  const merged = useMemo(() => {
    const result = allApps.map((app) => ({
      app,
      activeMs: summaries.find((s) => s.app_id === app.id)?.active_ms ?? 0,
    }))
    result.sort((a, b) => {
      if (a.activeMs > 0 && b.activeMs === 0) return -1
      if (a.activeMs === 0 && b.activeMs > 0) return 1
      if (a.activeMs !== b.activeMs) return b.activeMs - a.activeMs
      return a.app.display_name.localeCompare(b.app.display_name)
    })
    return result
  }, [allApps, summaries])

  return (
    <div className="app-grid">
      <div className="app-grid__header">
        <h2 className="app-grid__title">All Tracked Apps</h2>
        <div className="app-grid__period">
          {(['week', 'month', 'all'] as GridPeriod[]).map((p) => (
            <button
              key={p}
              className={`app-grid__period-btn${period === p ? ' app-grid__period-btn--active' : ''}`}
              onClick={() => onPeriodChange(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {allApps.length === 0 ? (
        <div className="app-grid__empty">
          <Monitor size={32} />
          <span>No apps tracked yet — use your computer and they'll appear here</span>
        </div>
      ) : (
        <div className={`app-grid__cards${loading ? ' app-grid__cards--loading' : ''}`}>
          {merged.map(({ app, activeMs }) => {
            const icon = icons.get(app.id) ?? null
            const time = fmtMs(activeMs)
            return (
              <button
                key={app.id}
                className={`app-grid__card${activeMs === 0 ? ' app-grid__card--inactive' : ''}`}
                onClick={() => navigate(`/app/${app.id}`)}
                title={app.display_name}
              >
                {/* Blurred backdrop */}
                <div className="app-grid__backdrop">
                  {icon
                    ? <img src={icon} alt="" className="app-grid__backdrop-img" />
                    : <div className="app-grid__backdrop-fallback" />
                  }
                </div>

                {/* Sharp centered icon */}
                <div className="app-grid__art">
                  {icon
                    ? <img src={icon} alt={app.display_name} className="app-grid__art-img" />
                    : <div className="app-grid__art-placeholder"><Monitor size={24} /></div>
                  }
                </div>

                {/* Name overlay */}
                <div className="app-grid__overlay">
                  <div className="app-grid__name">{app.display_name}</div>
                </div>

                {/* Time badge */}
                {time !== '—' && (
                  <div className="app-grid__time-badge">{time}</div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
