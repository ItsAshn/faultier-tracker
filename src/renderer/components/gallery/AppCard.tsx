import { useEffect, useRef, useState } from 'react'
import { AppWindow } from 'lucide-react'
import type { AppRecord, AppGroup, SessionSummary } from '@shared/types'
import { api } from '../../api/bridge'
import { useAppStore } from '../../store/appStore'

// ── Module-level icon batch queue ────────────────────────────────────────────
// Collects icon requests from all visible cards within a 50ms window and fires
// a single IPC call instead of one call per card.
const _iconCache = new Map<string, string | null>()
const _pending = new Map<string, Array<(icon: string | null) => void>>()
let _batchTimer: ReturnType<typeof setTimeout> | null = null

function requestIcon(id: number, isGroup: boolean): Promise<string | null> {
  const key = `${isGroup ? 'g' : 'a'}:${id}`
  if (_iconCache.has(key)) return Promise.resolve(_iconCache.get(key)!)
  return new Promise((resolve) => {
    if (!_pending.has(key)) _pending.set(key, [])
    _pending.get(key)!.push(resolve)
    if (_batchTimer) clearTimeout(_batchTimer)
    _batchTimer = setTimeout(async () => {
      _batchTimer = null
      const keys = [..._pending.keys()]
      const reqs = keys.map((k) => ({ id: +k.split(':')[1], isGroup: k.startsWith('g:') }))
      const captured = new Map(_pending)
      _pending.clear()
      try {
        const results = await api.getIconBatch(reqs)
        for (const [k, resolvers] of captured) {
          const icon = results[k] ?? null
          _iconCache.set(k, icon)
          resolvers.forEach((r) => r(icon))
        }
      } catch {
        for (const [k, resolvers] of captured) {
          _iconCache.set(k, null)
          resolvers.forEach((r) => r(null))
        }
      }
    }, 50)
  })
}

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
          requestIcon(item.id, isGroup).then(setIconSrc).catch(() => {})
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
  const activeMs = summary?.active_ms ?? 0
  const hasTime = activeMs > 0

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

      {/* Time badge — top left, always visible when there's data */}
      {hasTime && (
        <div className="app-card__time-badge">
          {fmtMs(activeMs)}
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
