import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppWindow, Cloud } from 'lucide-react'
import type { AppRecord, AppGroup, SessionSummary } from '@shared/types'
import { api } from '../../api/bridge'

// ── Persistent session-storage cache ─────────────────────────────────────────
// Survives React unmount/remount (navigation back to gallery) but is cleared
// when the Electron window closes. Falls back gracefully if sessionStorage is
// unavailable (sandboxed contexts, quota full, etc.).

const SESSION_PREFIX = 'ic:'
const THUMB_PREFIX = 'th:'

function ssGet(key: string): string | null | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key)
    if (raw === null) return undefined         // key not present
    if (raw === '\x00') return null            // stored null sentinel
    return raw
  } catch {
    return undefined
  }
}

function ssSet(key: string, value: string | null): void {
  try {
    sessionStorage.setItem(SESSION_PREFIX + key, value === null ? '\x00' : value)
  } catch {
    // Quota exceeded — in-memory cache still works
  }
}

function ssDel(key: string): void {
  try { sessionStorage.removeItem(SESSION_PREFIX + key) } catch { /* ignore */ }
}

function ssGetThumb(key: string): string | undefined {
  try {
    const raw = sessionStorage.getItem(THUMB_PREFIX + key)
    return raw === null ? undefined : raw
  } catch {
    return undefined
  }
}

function ssSetThumb(key: string, value: string): void {
  try {
    sessionStorage.setItem(THUMB_PREFIX + key, value)
  } catch {
    // Quota exceeded — in-memory cache still works
  }
}

function ssDelThumb(key: string): void {
  try { sessionStorage.removeItem(THUMB_PREFIX + key) } catch { /* ignore */ }
}

// ── Module-level in-memory icon batch queue ───────────────────────────────────
// Collects icon requests from all visible cards within a 30ms window and fires
// a single IPC call instead of one call per card.
// In-memory cache is warmed from sessionStorage on first miss.
const _iconCache = new Map<string, string | null>()
const _thumbCache = new Map<string, string>()
const _pending = new Map<string, Array<(icon: string | null) => void>>()
let _batchTimer: ReturnType<typeof setTimeout> | null = null

// Bust cache for a single item (e.g. after user sets a custom image).
export function bustIconCache(id: number, isGroup: boolean): void {
  const key = `${isGroup ? 'g' : 'a'}:${id}`
  const existingSrc = _iconCache.get(key)
  if (existingSrc) _thumbCache.delete(existingSrc)
  _iconCache.delete(key)
  ssDel(key)
  ssDelThumb(key)
}

// Clear entire icon cache — used when auto-fetch artwork update fires.
export function clearIconCache(): void {
  // Remove only our prefixed keys from sessionStorage
  try {
    const toRemove: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && (k.startsWith(SESSION_PREFIX) || k.startsWith(THUMB_PREFIX))) toRemove.push(k)
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k))
  } catch { /* ignore */ }
  _iconCache.clear()
  _thumbCache.clear()
}

// Read from in-memory cache, falling back to sessionStorage.
// Returns undefined when key is completely absent (IPC fetch required).
// Also warms _thumbCache from sessionStorage when a persisted thumb exists.
function readCache(key: string): string | null | undefined {
  if (_iconCache.has(key)) return _iconCache.get(key)!
  const ss = ssGet(key)
  if (ss !== undefined) {
    _iconCache.set(key, ss)   // warm in-memory layer
    // Warm thumb cache from sessionStorage so it's instantly available
    if (ss !== null && !_thumbCache.has(ss)) {
      const storedThumb = ssGetThumb(key)
      if (storedThumb !== undefined) _thumbCache.set(ss, storedThumb)
    }
    return ss
  }
  return undefined
}

function writeCache(key: string, value: string | null): void {
  _iconCache.set(key, value)
  ssSet(key, value)
  // Pre-generate and persist the tiny thumb so it's instantly available on
  // back-navigation — the blurred placeholder will appear before the full
  // image decodes on subsequent visits.
  if (value !== null && !_thumbCache.has(value)) {
    makeTinyThumb(value).then((thumb) => {
      ssSetThumb(key, thumb)
    }).catch(() => {})
  }
}

function requestIcon(id: number, isGroup: boolean): Promise<string | null> {
  const key = `${isGroup ? 'g' : 'a'}:${id}`
  const cached = readCache(key)
  if (cached !== undefined) return Promise.resolve(cached)
  return new Promise((resolve) => {
    if (!_pending.has(key)) _pending.set(key, [])
    _pending.get(key)!.push(resolve)
    if (_batchTimer) clearTimeout(_batchTimer)
    // 30ms debounce — tight enough for fast scrolls, wide enough to batch a full viewport
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
          writeCache(k, icon)
          resolvers.forEach((r) => r(icon))
        }
      } catch {
        for (const [k, resolvers] of captured) {
          writeCache(k, null)
          resolvers.forEach((r) => r(null))
        }
      }
    }, 30)
  })
}

// ── Blur-up thumb generation ──────────────────────────────────────────────────
// Downscales the full data URL to a 12×18 px canvas and re-encodes it as a
// low-quality JPEG (~300–500 bytes). This tiny image is rendered at full card
// size with CSS blur, giving a coloured wash instantly while the full image
// decodes in the browser. The thumb is module-level cached (never regenerated
// for the same source URL).

function makeTinyThumb(dataUrl: string): Promise<string> {
  const hit = _thumbCache.get(dataUrl)
  if (hit !== undefined) return Promise.resolve(hit)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const W = 12, H = 18
        const canvas = document.createElement('canvas')
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0, W, H)
        const thumb = canvas.toDataURL('image/jpeg', 0.3)
        _thumbCache.set(dataUrl, thumb)
        resolve(thumb)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
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
  // Three states: undefined = IPC in-flight, null = resolved no image, string = data URL
  const [iconSrc, setIconSrc] = useState<string | null | undefined>(() => {
    const key = `${isGroup ? 'g' : 'a'}:${item.id}`
    const cached = readCache(key)
    return cached !== undefined ? cached : undefined
  })
  // Tiny blurred placeholder (blur-up): pre-populated from cache on back-navigation,
  // otherwise set as soon as full src arrives, hidden after onLoad.
  const [thumbSrc, setThumbSrc] = useState<string | null>(() => {
    const key = `${isGroup ? 'g' : 'a'}:${item.id}`
    const cached = readCache(key)
    if (cached == null) return null
    return _thumbCache.get(cached) ?? null
  })
  // True only after the full <img> fires onLoad — triggers the opacity-1 class.
  // Pre-set to true when iconSrc is already resolved from cache so the image
  // doesn't get stuck invisible if onLoad fires before the blur-up effect runs.
  const [imgVisible, setImgVisible] = useState<boolean>(() => {
    const key = `${isGroup ? 'g' : 'a'}:${item.id}`
    const cached = readCache(key)
    return cached != null
  })
  const cardRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  // Tracks if we've successfully shown the full image for this iconSrc.
  // Prevents flicker and handles the case where onLoad doesn't fire for cached images.
  const hasShownFullRef = useRef<boolean>(false)

  // ── Lazy load: request icon when card enters 400px pre-load zone ─────────────
  useEffect(() => {
    const key = `${isGroup ? 'g' : 'a'}:${item.id}`
    // Already resolved (from memory or sessionStorage) — skip observer setup
    if (readCache(key) !== undefined) return

    const el = cardRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect()
          requestIcon(item.id, isGroup)
            .then((src) => setIconSrc(src))
            .catch(() => setIconSrc(null))
        }
      },
      // 400px pre-load zone — icons start loading well before cards reach the viewport
      { rootMargin: '400px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [item.id, isGroup])

  // ── Blur-up: generate tiny thumb and manage visibility ──────────────────────────
  // Key insight: we need to handle THREE scenarios:
  // 1. Image freshly loaded from IPC: show blurred thumb, then fade in full image
  // 2. Image already cached in memory: show immediately, no blur phase
  // 3. Image src changed (e.g., user updated artwork): reset and re-fade
  useLayoutEffect(() => {
    if (!iconSrc) {
      setThumbSrc(null)
      setImgVisible(false)
      hasShownFullRef.current = false
      return
    }

    // Generate the tiny blurred thumb for progressive loading
    makeTinyThumb(iconSrc).then(setThumbSrc).catch(() => {})

    // Check if this image was already shown (prevents flicker on re-renders)
    if (hasShownFullRef.current) {
      setImgVisible(true)
      return
    }

    // Check if the <img> element already has the image loaded.
    // This handles the case where `onLoad` doesn't fire for cached images.
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) {
      setImgVisible(true)
      hasShownFullRef.current = true
    } else {
      // Image not yet loaded - start invisible, will fade in on onLoad
      setImgVisible(false)
    }
  }, [iconSrc])

  // ── Handle onLoad for the full image ────────────────────────────────────────────
  // When the browser finishes decoding, mark as visible and record that we've shown it.
  const handleImgLoad = (): void => {
    setImgVisible(true)
    hasShownFullRef.current = true
  }

  const name = isGroup ? (item as AppGroup).name : (item as AppRecord).display_name
  const activeMs = summary ? summary.active_ms : 0
  const hasTime = activeMs > 0
  const isUntracked = !isGroup && !(item as AppRecord).is_tracked
  const isSteamGame = !isGroup && (item as AppRecord).exe_name?.startsWith('steam:')

  // iconSrc === undefined means IPC is in-flight — show skeleton shimmer
  const isLoading = iconSrc === undefined

  return (
    <div
      ref={cardRef}
      className={`app-card${isUntracked ? ' app-card--ignored' : ''}`}
      onClick={onClick}
    >
      {/* Blurred ambient backdrop — fills the whole card */}
      <div className="app-card__backdrop">
        {iconSrc
          ? <img src={iconSrc} alt="" aria-hidden className="app-card__backdrop-img" />
          : <div className={`app-card__backdrop-fallback${isLoading ? ' app-card__backdrop-fallback--shimmer' : ''}`} />
        }
      </div>

      {/* Sharp icon/art centered in the card */}
      <div className="app-card__art">
        {iconSrc
          ? (
            <>
              {/* Blur-up placeholder: tiny thumb at full size, blurred + fades out on load */}
              <img
                src={thumbSrc ?? iconSrc}
                alt=""
                aria-hidden
                className={`app-card__thumb${imgVisible ? ' app-card__thumb--hidden' : ''}`}
              />
              {/* Full image: starts transparent, fades in after browser decode */}
              <img
                ref={imgRef}
                src={iconSrc}
                alt={name}
                className={`app-card__img${imgVisible ? ' app-card__img--visible' : ''}`}
                onLoad={handleImgLoad}
              />
            </>
          )
          : isLoading
            ? <div className="app-card__skeleton" />
            : (
              <div className="app-card__placeholder">
                <AppWindow size={56} strokeWidth={1} />
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
