import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, ArrowRight } from 'lucide-react'
import type { SessionSummary } from '@shared/types'
import { api } from '../../api/bridge'

function fmtMs(ms: number): string {
  if (ms < 60_000) return '<1m'
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

const TOP_N = 7

interface Props {
  summaries: SessionSummary[]
  period: GridPeriod
  onPeriodChange: (p: GridPeriod) => void
  loading: boolean
}

export default function TopAppsLeaderboard({ summaries, period, onPeriodChange, loading }: Props): JSX.Element {
  const navigate = useNavigate()
  const [icons, setIcons] = useState<Map<number, string>>(new Map())

  // Only the top N apps by active_ms (summaries arrive pre-sorted from handlers.ts)
  const topApps = useMemo(() => summaries.slice(0, TOP_N), [summaries])
  const maxMs = topApps[0]?.active_ms ?? 0

  // Stable key — only refetch icons when the top-N app IDs change
  const topIds = useMemo(() => topApps.map((a) => a.app_id).join(','), [topApps])

  useEffect(() => {
    if (topApps.length === 0) { setIcons(new Map()); return }
    Promise.all(
      topApps.map((app) => api.getIconForApp(app.app_id).then((icon) => ({ id: app.app_id, icon })))
    ).then((results) => {
      const m = new Map<number, string>()
      for (const r of results) {
        if (r.icon) m.set(r.id, r.icon)
      }
      setIcons(m)
    })
  }, [topIds]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="leaderboard">
      <div className="leaderboard__header">
        <h2 className="leaderboard__title">Top Apps</h2>
        <div className="leaderboard__period">
          {(['week', 'month', 'all'] as GridPeriod[]).map((p) => (
            <button
              key={p}
              className={`leaderboard__period-btn${period === p ? ' leaderboard__period-btn--active' : ''}`}
              onClick={() => onPeriodChange(p)}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="leaderboard__rows">
          {Array.from({ length: TOP_N }).map((_, i) => (
            <div key={i} className="leaderboard__row leaderboard__row--skeleton">
              <div className="leaderboard__rank-skel" />
              <div className="leaderboard__icon-skel" />
              <div className="leaderboard__name-skel" />
              <div className="leaderboard__bar-wrap">
                <div className="leaderboard__bar-skel" style={{ width: `${80 - i * 10}%` }} />
              </div>
              <div className="leaderboard__time-skel" />
            </div>
          ))}
        </div>
      ) : topApps.length === 0 ? (
        <div className="leaderboard__empty">
          <Monitor size={28} />
          <span>No activity recorded — use your computer and data will appear here</span>
        </div>
      ) : (
        <div className="leaderboard__rows">
          {topApps.map((app, i) => {
            const icon = icons.get(app.app_id) ?? null
            const barPct = maxMs > 0 ? (app.active_ms / maxMs) * 100 : 0
            return (
              <button
                key={app.app_id}
                className="leaderboard__row"
                onClick={() => navigate(`/app/${app.app_id}`)}
                title={app.display_name}
              >
                <span className="leaderboard__rank">{i + 1}</span>
                <div className="leaderboard__icon">
                  {icon
                    ? <img src={icon} alt="" className="leaderboard__icon-img" />
                    : <div className="leaderboard__icon-placeholder"><Monitor size={16} /></div>
                  }
                </div>
                <span className="leaderboard__name">{app.display_name}</span>
                <div className="leaderboard__bar-wrap">
                  <div className="leaderboard__bar" style={{ width: `${barPct}%` }} />
                </div>
                <span className="leaderboard__time">{fmtMs(app.active_ms)}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="leaderboard__footer">
        <button className="leaderboard__gallery-link" onClick={() => navigate('/gallery')}>
          View all apps in Gallery
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  )
}
