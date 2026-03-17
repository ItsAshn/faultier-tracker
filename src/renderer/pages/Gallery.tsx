import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { Search, Images, Calendar, RefreshCw, Filter } from 'lucide-react'
import '../styles/gallery.css'
import { useAppStore } from '../store/appStore'
import { useSessionStore } from '../store/sessionStore'
import AppCard from '../components/gallery/AppCard'
import { api } from '../api/bridge'
import type { AppRecord, AppGroup, RangeSummary, SessionSummary } from '@shared/types'
import GalleryHeatmap from '../components/gallery/GalleryHeatmap'

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
  const loadAll = useAppStore((s) => s.loadAll)
  const lastTickAt = useSessionStore((s) => s.lastTickAt)
  const loadRange = useSessionStore((s) => s.loadRange)
  const [allTimeSummary, setAllTimeSummary] = useState<RangeSummary | null>(_cachedAllTimeSummary)
  const lastSummaryFetchRef = useRef<number>(0)
  const prevAppsLengthRef = useRef<number>(apps.length)

  function fetchSummary(force = false): void {
    const now = Date.now()
    if (!force && lastSummaryFetchRef.current > 0 && now - lastSummaryFetchRef.current < 30_000) return
    lastSummaryFetchRef.current = now
    api.getSessionRange(0, Date.now()).then((data) => {
      _cachedAllTimeSummary = data
      setAllTimeSummary(data)
    }).catch(() => {})
  }

  // Refresh all-time summary on mount and when tracking ticks arrive — throttled
  // to at most once per 30s so we don't hammer the DB on every 5-second poll tick.
  useEffect(() => {
    fetchSummary()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTickAt])

  // When a new app is detected (apps.length increases), force an immediate refresh
  // so it appears with its time straight away without waiting for the throttle.
  useEffect(() => {
    if (apps.length > prevAppsLengthRef.current) {
      fetchSummary(true)
    }
    prevAppsLengthRef.current = apps.length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apps.length])

  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('time')
  
  // Modal states
  const [heatmapOpen, setHeatmapOpen] = useState(false)
  const [steamRefreshing, setSteamRefreshing] = useState(false)

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
  // Pre-index group membership (O(N)) so sort and summary lookups don't filter per call.
  const groupMembers = useMemo(() => {
    const m = new Map<number, AppRecord[]>()
    for (const app of apps) {
      if (app.group_id !== null) {
        const arr = m.get(app.group_id)
        if (arr) arr.push(app)
        else m.set(app.group_id, [app])
      }
    }
    return m
  }, [apps])

  const allItems: GalleryItem[] = useMemo(() => {
    const items: GalleryItem[] = []
    for (const group of groups) {
      const members = groupMembers.get(group.id) ?? []
      items.push({ id: group.id, isGroup: true, item: group, memberCount: members.length })
    }
    for (const app of apps) {
      if (app.group_id === null) {
        items.push({ id: app.id, isGroup: false, item: app })
      }
    }
    return items
  }, [apps, groups, groupMembers])

  // Fuse.js search
  const fuse = useMemo(() => new Fuse(allItems, {
    keys: [
      { name: 'item.display_name', weight: 2 },
      { name: 'item.name', weight: 2 },
    ],
    threshold: 0.4
  }), [allItems])

  // O(1) lookup map from allTimeSummary.apps
  const summaryByAppId = useMemo(() => {
    const m = new Map<number, SessionSummary>()
    if (allTimeSummary) {
      for (const s of allTimeSummary.apps) m.set(s.app_id, s)
    }
    return m
  }, [allTimeSummary])

  function getAllTimeSummary(item: GalleryItem) {
    if (!allTimeSummary) return null
    if (item.isGroup) {
      const members = groupMembers.get(item.id) ?? []
      let total = 0
      for (const a of members) {
        total += summaryByAppId.get(a.id)?.active_ms ?? 0
      }
      if (total === 0) return null
      return {
        app_id: item.id,
        exe_name: '',
        display_name: (item.item as AppGroup).name,
        group_id: null,
        active_ms: total,
      }
    }
    return summaryByAppId.get(item.id) ?? null
  }

  const displayed = useMemo(() => {
    let items = allItems
    if (search.trim()) {
      items = fuse.search(search).map((r) => r.item)
    }

    // Pre-compute sort keys once (O(N)) to avoid repeated O(N) lookups inside
    // the comparator which would make the overall sort O(N² log N).
    const totalMs = new Map<string, number>()
    const lastSeen = new Map<string, number>()
    const name = new Map<string, string>()

    for (const item of items) {
      const key = `${item.isGroup ? 'g' : 'a'}-${item.id}`
      const s = getAllTimeSummary(item)
      totalMs.set(key, s ? s.active_ms : 0)
      if (item.isGroup) {
        const members = groupMembers.get(item.id) ?? []
        lastSeen.set(key, members.reduce((max, a) => Math.max(max, a.last_seen), 0))
      } else {
        lastSeen.set(key, (item.item as AppRecord).last_seen)
      }
      name.set(key, item.isGroup
        ? (item.item as AppGroup).name
        : (item.item as AppRecord).display_name)
    }

    return [...items].sort((a, b) => {
      const ka = `${a.isGroup ? 'g' : 'a'}-${a.id}`
      const kb = `${b.isGroup ? 'g' : 'a'}-${b.id}`
      if (sort === 'time') return (totalMs.get(kb) ?? 0) - (totalMs.get(ka) ?? 0)
      if (sort === 'name') return (name.get(ka) ?? '').localeCompare(name.get(kb) ?? '', undefined, { sensitivity: 'base' })
      // last_seen
      return (lastSeen.get(kb) ?? 0) - (lastSeen.get(ka) ?? 0)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, allItems, fuse, sort, allTimeSummary, groupMembers, summaryByAppId])

  function handleCardClick(item: GalleryItem): void {
    if (mainRef.current) sessionStorage.setItem(SCROLL_KEY, String(mainRef.current.scrollTop))
    navigate(item.isGroup ? `/group/${item.id}` : `/app/${item.id}`)
  }

  const handleSteamRefresh = useCallback(async (): Promise<void> => {
    if (steamRefreshing) return;
    setSteamRefreshing(true);
    try {
      const result = await api.refreshSteamData();
      // Always reload so charts reflect the latest data regardless of delta.
      await loadAll();
      loadRange();
      fetchSummary(true);
      if (result.updated === 0) {
        console.log('[Gallery] Steam refresh: no new playtime detected');
      }
    } catch (err) {
      console.error('[Gallery] Steam refresh failed:', err);
    } finally {
      setSteamRefreshing(false);
    }
  }, [steamRefreshing, loadAll, loadRange]);

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
            disabled={steamRefreshing}
          >
            <RefreshCw size={16} className={steamRefreshing ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="gallery-grid">
        {displayed.length === 0 ? (
          <div className="gallery-empty">
            <Images size={40} />
            {search.trim() ? (
              <span>No apps match &ldquo;{search}&rdquo;</span>
            ) : (
              <>
                <span>No apps yet</span>
                <span className="gallery-empty__hint">Open any app or game and KIOKU will detect it automatically.</span>
              </>
            )}
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
        <GalleryHeatmap onClose={() => setHeatmapOpen(false)} />
      )}

    </main>
  )
}
