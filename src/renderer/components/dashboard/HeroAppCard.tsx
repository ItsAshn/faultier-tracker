import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { RangeSummary } from '@shared/types'
import { api } from '../../api/bridge'

function fmtMs(ms: number): string {
  if (ms < 60_000) return '0m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface Props {
  summary: RangeSummary | null
  loading: boolean
}

export default function HeroAppCard({ summary, loading }: Props): JSX.Element {
  const navigate = useNavigate()
  const topApp = summary?.top_app ?? null
  const [icon, setIcon] = useState<string | null>(null)

  useEffect(() => {
    if (!topApp) { setIcon(null); return }
    api.getIconForApp(topApp.app_id).then(setIcon)
  }, [topApp?.app_id])

  const daysActive = summary?.chart_points.filter((p) => p.active_ms > 0).length ?? 0

  if (loading) {
    return (
      <div className="hero-card hero-card--loading">
        <div className="hero-skeleton hero-skeleton--icon" />
        <div className="hero-card__text">
          <div className="hero-skeleton hero-skeleton--label" />
          <div className="hero-skeleton hero-skeleton--name" />
          <div className="hero-skeleton hero-skeleton--time" />
        </div>
      </div>
    )
  }

  if (!topApp) {
    return (
      <div className="hero-card hero-card--empty">
        <Trophy size={44} className="hero-card__empty-icon" />
        <div className="hero-card__empty-text">No activity recorded this week</div>
        <div className="hero-card__empty-sub">Open any tracked app to get started</div>
      </div>
    )
  }

  return (
    <button
      className="hero-card"
      onClick={() => navigate(`/gallery/app/${topApp.app_id}`)}
    >
      <div className="hero-card__label">
        <Trophy size={13} />
        App of the Week
      </div>
      <div className="hero-card__body">
        <div className="hero-card__icon-wrap">
          {icon
            ? <img src={icon} alt={topApp.display_name} className="hero-card__icon" />
            : <div className="hero-card__icon-placeholder"><Trophy size={48} /></div>
          }
        </div>
        <div className="hero-card__text">
          <div className="hero-card__name">{topApp.display_name}</div>
          <div className="hero-card__time">{fmtMs(topApp.active_ms)}</div>
          <div className="hero-card__sub">
            {daysActive > 0
              ? `${daysActive} day${daysActive !== 1 ? 's' : ''} active this week`
              : 'Active this week'
            }
          </div>
        </div>
      </div>
    </button>
  )
}
