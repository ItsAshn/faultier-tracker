import { useEffect, useRef, useState } from 'react'
import { AppWindow } from 'lucide-react'
import type { AppRecord, AppGroup, SessionSummary } from '@shared/types'
import { api } from '../../api/bridge'
import { useAppStore } from '../../store/appStore'

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
  todaySummary: SessionSummary | null
  onClick: () => void
}

export default function AppCard({ item, isGroup, memberCount, todaySummary, onClick }: AppCardProps): JSX.Element {
  const [iconSrc, setIconSrc] = useState<string | null>(item.custom_image_path)
  const setAppTracked = useAppStore((s) => s.setAppTracked)
  const cardRef = useRef<HTMLDivElement>(null)

  const isTracked = isGroup ? true : (item as AppRecord).is_tracked

  useEffect(() => {
    if (item.custom_image_path) return

    const el = cardRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect()
          if (isGroup) {
            api.getIconForGroup(item.id).then(setIconSrc)
          } else {
            api.getIconForApp(item.id).then(setIconSrc)
          }
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [item.id, item.custom_image_path, isGroup])

  function handleTrackedToggle(e: React.MouseEvent): void {
    e.stopPropagation()
    if (!isGroup) {
      setAppTracked(item.id, !(item as AppRecord).is_tracked)
    }
  }

  const name = isGroup ? (item as AppGroup).name : (item as AppRecord).display_name
  const activeMs = todaySummary?.active_ms ?? 0
  const runningMs = todaySummary?.running_ms ?? 0
  const hasTime = activeMs > 0 || runningMs > 0

  return (
    <div
      ref={cardRef}
      className={`app-card${!isTracked ? ' app-card--ignored' : ''}`}
      onClick={onClick}
    >
      {/* Blurred backdrop — fills the whole card */}
      <div className="app-card__backdrop">
        {iconSrc
          ? <img src={iconSrc} alt="" aria-hidden className="app-card__backdrop-img" />
          : <div className="app-card__backdrop-fallback" />
        }
      </div>

      {/* Sharp icon/art centered in the card */}
      <div className="app-card__art">
        {iconSrc
          ? <img src={iconSrc} alt={name} className="app-card__img" />
          : (
            <div className="app-card__placeholder">
              <AppWindow size={48} strokeWidth={1} />
            </div>
          )
        }
      </div>

      {/* Bottom gradient overlay with name + time */}
      <div className="app-card__overlay">
        <span className="app-card__name" title={name}>{name}</span>
        <div className="app-card__overlay-meta">
          {hasTime && (
            <span className="app-card__time">
              {fmtMs(activeMs)} active
            </span>
          )}
          {memberCount !== undefined && memberCount > 1 && (
            <span className="app-card__count">{memberCount} apps</span>
          )}
        </div>
      </div>

      {/* Track toggle — top-right */}
      {!isGroup && (
        <button
          className={`app-card__track-btn${isTracked ? ' app-card__track-btn--on' : ''}`}
          onClick={handleTrackedToggle}
          title={isTracked ? 'Stop tracking' : 'Start tracking'}
        >
          {isTracked ? 'Tracking' : 'Ignored'}
        </button>
      )}
    </div>
  )
}
