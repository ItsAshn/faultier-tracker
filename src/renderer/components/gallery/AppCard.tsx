import { useState, useEffect } from 'react'
import { AppWindow, Cloud } from 'lucide-react'
import type { AppRecord, AppGroup, SessionSummary } from '@shared/types'
import { getIconUrl, bumpIconVersion } from '../../utils/iconUrl'

export { bumpIconVersion }

function fmtMs(ms: number): string {
  if (ms < 60_000) return '< 1m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface AppCardProps {
  item: AppRecord | AppGroup
  isGroup: boolean
  memberCount?: number
  summary: SessionSummary | null
  onClick: () => void
}

export default function AppCard({ item, isGroup, memberCount, summary, onClick }: AppCardProps): JSX.Element {
  const iconUrl = getIconUrl(isGroup ? 'group' : 'app', item.id)
  const [imgVisible, setImgVisible] = useState(false)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    setImgVisible(false)
    setImgError(false)
  }, [iconUrl])

  const name = isGroup ? (item as AppGroup).name : (item as AppRecord).display_name
  const activeMs = summary ? summary.active_ms : 0
  const hasTime = activeMs > 0
  const isUntracked = !isGroup && !(item as AppRecord).is_tracked
  const isSteamGame = !isGroup && (item as AppRecord).exe_name?.startsWith('steam:')

  return (
    <div
      className={`app-card${isUntracked ? ' app-card--ignored' : ''}`}
      onClick={onClick}
    >
      {/* Blurred ambient backdrop */}
      <div className="app-card__backdrop">
        {!imgError ? (
          <img
            src={iconUrl}
            alt=""
            aria-hidden
            className="app-card__backdrop-img"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="app-card__backdrop-fallback" />
        )}
      </div>

      {/* Sharp icon/art centered in the card */}
      <div className="app-card__art">
        {!imgError ? (
          <img
            src={iconUrl}
            alt={name}
            className={`app-card__img${imgVisible ? ' app-card__img--visible' : ''}`}
            onLoad={() => setImgVisible(true)}
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="app-card__placeholder">
            <AppWindow size={56} strokeWidth={1} />
          </div>
        )}
        {!imgVisible && !imgError && <div className="app-card__skeleton" />}
      </div>

      {/* Time badge */}
      {hasTime && (
        <div className="app-card__time-badge">
          {fmtMs(activeMs)}
          {isSteamGame && (
            <span className="app-card__steam-icon" title="Playtime from Steam">
              <Cloud size={12} style={{ marginLeft: 4, opacity: 0.8 }} />
            </span>
          )}
        </div>
      )}

      {/* Bottom gradient overlay with name + member count */}
      <div className="app-card__overlay">
        <span className="app-card__name" title={name}>{name}</span>
        {memberCount !== undefined && memberCount > 1 && (
          <div className="app-card__overlay-meta">
            <span className="app-card__count">{memberCount} apps</span>
          </div>
        )}
      </div>
    </div>
  )
}