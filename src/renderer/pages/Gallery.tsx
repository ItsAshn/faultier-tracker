import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { Search, Images, Calendar, RefreshCw, Filter } from 'lucide-react'
import '../styles/gallery.css'
import { useAppStore } from '../store/appStore'
import { useSessionStore } from '../store/sessionStore'
import AppCard from '../components/gallery/AppCard'
import { api } from '../api/bridge'
import type { AppRecord, AppGroup, RangeSummary } from '@shared/types'
import GlobalHeatmapModal from '../components/heatmap/GlobalHeatmapModal'

type SortMode = 'time' | 'name' | 'last_seen'

const SCROLL_KEY = 'gallery-scroll'

// Module-level cache so allTimeSummary survives Gallery unmount/remount (navigation).
let _cachedAllTimeSummary: RangeSummary | null = null

interface GalleryItem {
  id: number
  isGroup: boolean
  item: AppRecord | AppGroup
  memberCount?: number
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return '<1m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function Gallery(): JSX.Element {
  const apps = useAppStore((s) => s.apps)
  const groups = useAppStore((s) => s.groups)
  const lastTickAt = useSessionStore((s) => s.lastTickAt)
  const [allTimeSummary, setAllTimeSummary] = useState<RangeSummary | null>(_cachedAllTimeSummary)
  const lastSummaryFetchRef = useRef<number>(0)

  // Refresh all-time summary on mount, when the app list changes, and when new
  // tracking ticks arrive — throttled to at most once per 30s so we don't hammer
  // the DB on every 5-second poll tick.
  useEffect(() => {
    const now = Date.now()
    if (lastSummaryFetchRef.current > 0 && now - lastSummaryFetchRef.current < 30_000) return
    lastSummaryFetchRef.current = now
    api.getSessionRange(0, Date.now()).then((data) => {
      _cachedAllTimeSummary = data
      setAllTimeSummary(data)
    }).catch(() => {})
  }, [apps.length, lastTickAt])

  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('time')
  
  // Modal states
  const [heatmapOpen, setHeatmapOpen] = useState(false)

  // Restore scroll position when returning from a detail page
  useEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (!saved) return
    sessionStorage.removeItem(SCROLL_KEY)
    const y = parseInt(saved, 10)
    requestAnimationFrame(() => {
      if (mainRef.current) mainRef.current.scrollTop = y
    })
  }, [])

  // Build gallery items: one per group + ungrouped apps
  const allItems: GalleryItem[] = useMemo(() => {
    const items: GalleryItem[] = []

    for (const group of groups) {
      const members = apps.filter((a) => a.group_id === group.id)
      items.push({ id: group.id, isGroup: true, item: group, memberCount: members.length })
    }

    for (const app of apps) {
      if (app.group_id === null) {
        items.push({ id: app.id, isGroup: false, item: app })
      }
    }

    return items
  }, [apps, groups])

  // Fuse.js search
  const fuse = useMemo(() => new Fuse(allItems, {
    keys: [
      { name: 'item.display_name', weight: 2 },
      { name: 'item.name', weight: 2 },
    ],
    threshold: 0.4
  }), [allItems])

  function getAllTimeSummary(item: GalleryItem) {
    if (!allTimeSummary) return null
    if (item.isGroup) {
      const memberIds = apps.filter((a) => a.group_id === item.id).map((a) => a.id)
      const sums = allTimeSummary.apps.filter((s) => memberIds.includes(s.app_id))
      if (!sums.length) return null
      return {
        app_id: item.id,
        exe_name: '',
        display_name: (item.item as AppGroup).name,
        group_id: null,
        active_ms: sums.reduce((acc, s) => acc + s.active_ms, 0),
      }
    }
    return allTimeSummary.apps.find((s) => s.app_id === item.id) ?? null
  }

  function getItemTotalMs(item: GalleryItem): number {
    const s = getAllTimeSummary(item)
    if (!s) return 0
    return s.active_ms
  }

  function getItemLastSeen(item: GalleryItem): number {
    if (item.isGroup) {
      return apps
        .filter((a) => a.group_id === item.id)
        .reduce((max, a) => Math.max(max, a.last_seen), 0)
    }
    return (item.item as AppRecord).last_seen
  }

  function getItemName(item: GalleryItem): string {
    return item.isGroup ? (item.item as AppGroup).name : (item.item as AppRecord).display_name
  }

  const displayed = useMemo(() => {
    let items = allItems
    if (search.trim()) {
      items = fuse.search(search).map((r) => r.item)
    }
    return [...items].sort((a, b) => {
      if (sort === 'time') return getItemTotalMs(b) - getItemTotalMs(a)
      if (sort === 'name') return getItemName(a).localeCompare(getItemName(b), undefined, { sensitivity: 'base' })
      // last_seen
      return getItemLastSeen(b) - getItemLastSeen(a)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, allItems, fuse, sort, allTimeSummary])

  function handleCardClick(item: GalleryItem): void {
    if (mainRef.current) sessionStorage.setItem(SCROLL_KEY, String(mainRef.current.scrollTop))
    navigate(item.isGroup ? `/group/${item.id}` : `/app/${item.id}`)
  }

  function handleSteamRefresh(): void {
    // TODO: Implement steam refresh
    console.log('[Gallery] Steam refresh requested')
  }

  return (
    <main ref={mainRef} className="page-content">
      {/* Toolbar */}
      <div className="gallery-toolbar">
        <div className="gallery-toolbar__search">
          <Search size={16} className="gallery-search__icon" />
          <input
            className="gallery-search__input"
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="gallery-filter">
          <button
            className={`gallery-filter__btn${sort === 'time' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setSort('time')}
          >
            <Filter size={14} />
            <span>Most time</span>
          </button>
          <button
            className={`gallery-filter__btn${sort === 'name' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setSort('name')}
          >
            <Filter size={14} />
            <span>Name</span>
          </button>
          <button
            className={`gallery-filter__btn${sort === 'last_seen' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setSort('last_seen')}
          >
            <Filter size={14} />
            <span>Recent</span>
          </button>
        </div>

        <div className="gallery-toolbar__actions">
          <button
            className="gallery-toolbar__btn"
            onClick={() => setHeatmapOpen(true)}
            title="View activity heatmap"
          >
            <Calendar size={16} />
          </button>
          <button
            className="gallery-toolbar__btn"
            onClick={handleSteamRefresh}
            title="Refresh Steam data"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div className="gallery-grid">
        {displayed.length === 0 ? (
          <div className="gallery-empty">
            <Images size={40} />
            <span>No apps found</span>
          </div>
        ) : (
          displayed.map((item) => (
            <AppCard
              key={`${item.isGroup ? 'g' : 'a'}-${item.id}`}
              item={item.item}
              isGroup={item.isGroup}
              memberCount={item.memberCount}
              summary={getAllTimeSummary(item)}
              onClick={() => handleCardClick(item)}
            />
          ))
        )}
      </div>

      {/* Global Heatmap Modal */}
      {heatmapOpen && (
        <GlobalHeatmapModal onClose={() => setHeatmapOpen(false)} />
      )}

    </main>
  )
}
