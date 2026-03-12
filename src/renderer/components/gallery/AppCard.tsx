import { useEffect, useRef, useState } from 'react'
import { AppWindow, Cloud } from 'lucide-react'
import type { AppRecord, AppGroup, SessionSummary } from '@shared/types'
import { api } from '../../api/bridge'

// ── Module-level icon batch queue ────────────────────────────────────────────
// Collects icon requests from all visible cards within a 50ms window and fires
// a single IPC call instead of one call per card.
const _iconCache = new Map<string, string | null>()
const _pending = new Map<string, Array<(icon: string | null) => void>>()
let _batchTimer: ReturnType<typeof setTimeout> | null = null

// Bust cache for a single item (e.g. after user sets a custom image).
export function bustIconCache(id: number, isGroup: boolean): void {
  const key = `${isGroup ? 'g' : 'a'}:${id}`
  _iconCache.delete(key)
}

// Clear entire icon cache — used when auto-fetch artwork update fires.
export function clearIconCache(): void {
  _iconCache.clear()
}

function requestIcon(id: number, isGroup: boolean, bust = false): Promise<string | null> {
  const key = `${isGroup ? 'g' : 'a'}:${id}`
  if (!bust && _iconCache.has(key)) return Promise.resolve(_iconCache.get(key)!)
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
  const [iconSrc, setIconSrc] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
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
  }, [item.id, isGroup])

  const name = isGroup ? (item as AppGroup).name : (item as AppRecord).display_name
  const activeMs = summary ? summary.active_ms : 0
  const hasTime = activeMs > 0
  const isSteamGame = !isGroup && (item as AppRecord).exe_name?.startsWith('steam:')

  return (
    <div
      ref={cardRef}
      className="app-card"
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
