import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { Search, Images, Zap, X, ExternalLink, ChevronDown } from 'lucide-react'
import '../styles/gallery.css'
import '../styles/dashboard.css'
import { useAppStore } from '../store/appStore'
import { useSessionStore } from '../store/sessionStore'
import AppCard from '../components/gallery/AppCard'
import Heatmap from '../components/dashboard/Heatmap'
import { api } from '../api/bridge'
import type { AppRecord, AppGroup, RangeSummary, BucketApp } from '@shared/types'

type FilterMode = 'tracked' | 'ignored'
type SortMode = 'time' | 'name' | 'last_seen'

const SCROLL_KEY = 'gallery-scroll'

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

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Gallery(): JSX.Element {
  const apps = useAppStore((s) => s.apps)
  const groups = useAppStore((s) => s.groups)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const lastTickAt = useSessionStore((s) => s.lastTickAt)
  const [allTimeSummary, setAllTimeSummary] = useState<RangeSummary | null>(null)
  const lastSummaryFetchRef = useRef<number>(0)

  // Refresh all-time summary on mount, when the app list changes, and when new
  // tracking ticks arrive — throttled to at most once per 30s so we don't hammer
  // the DB on every 5-second poll tick.
  useEffect(() => {
    const now = Date.now()
    if (lastSummaryFetchRef.current > 0 && now - lastSummaryFetchRef.current < 30_000) return
    lastSummaryFetchRef.current = now
    api.getSessionRange(0, Date.now()).then(setAllTimeSummary).catch(() => {})
  }, [apps.length, lastTickAt])

  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('tracked')
  const [sort, setSort] = useState<SortMode>('time')

  // Onboarding / steam banners
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const showOnboarding = lastTickAt === null && !bannerDismissed
  const steamPromptDismissed = settings['steam_prompt_dismissed'] === 'true' || settings['steam_prompt_dismissed'] === true
  const showSteamPrompt = apps.length > 10 && !steamPromptDismissed && lastTickAt !== null

  // Heatmap accordion
  const [heatmapOpen, setHeatmapOpen] = useState(() => {
    return localStorage.getItem('heatmap-expanded') !== 'false'
  })
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [dayApps, setDayApps] = useState<BucketApp[]>([])

  function toggleHeatmap(): void {
    const next = !heatmapOpen
    setHeatmapOpen(next)
    localStorage.setItem('heatmap-expanded', String(next))
    if (!next) setSelectedDay(null)
  }

  function handleHeatmapDayClick(dateStr: string): void {
    if (!heatmapOpen) {
      setHeatmapOpen(true)
      localStorage.setItem('heatmap-expanded', 'true')
    }
    setSelectedDay(dateStr)
    const from = new Date(dateStr + 'T00:00:00').getTime()
    const to = from + 86_400_000 - 1
    api.getBucketApps(from, to).then(setDayApps).catch(() => setDayApps([]))
  }

  function clearSelectedDay(): void {
    setSelectedDay(null)
    setDayApps([])
  }

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

  // Filter by tracked status
  const filtered = useMemo(() => {
    if (filter === 'tracked') {
      return allItems.filter((item) => {
        if (item.isGroup) return true
        return (item.item as AppRecord).is_tracked
      })
    }
    return allItems.filter((item) => {
      if (item.isGroup) return false
      return !(item.item as AppRecord).is_tracked
    })
  }, [allItems, filter])

  // Fuse.js search
  const fuse = useMemo(() => new Fuse(filtered, {
    keys: [
      { name: 'item.display_name', weight: 2 },
      { name: 'item.name', weight: 2 },
      { name: 'item.description', weight: 1 },
      { name: 'item.tags', weight: 0.5 }
    ],
    threshold: 0.4
  }), [filtered])

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
        running_ms: sums.reduce((acc, s) => acc + s.running_ms, 0)
      }
    }
    return allTimeSummary.apps.find((s) => s.app_id === item.id) ?? null
  }

  function getItemTotalMs(item: GalleryItem): number {
    const s = getAllTimeSummary(item)
    return s ? s.active_ms : 0
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
    if (search.trim()) return fuse.search(search).map((r) => r.item)
    return [...filtered].sort((a, b) => {
      if (sort === 'time') return getItemTotalMs(b) - getItemTotalMs(a)
      if (sort === 'name') return getItemName(a).localeCompare(getItemName(b), undefined, { sensitivity: 'base' })
      // last_seen
      return getItemLastSeen(b) - getItemLastSeen(a)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filtered, fuse, sort, allTimeSummary])

  function handleCardClick(item: GalleryItem): void {
    if (mainRef.current) sessionStorage.setItem(SCROLL_KEY, String(mainRef.current.scrollTop))
    navigate(item.isGroup ? `/group/${item.id}` : `/app/${item.id}`)
  }

  return (
    <main ref={mainRef} className="page-content">
      {showOnboarding && (
        <div className="onboarding-banner">
          <Zap size={16} className="onboarding-banner__icon" />
          <div className="onboarding-banner__text">
            <strong>Faultier Tracker is running.</strong>
            {' '}Apps will appear here automatically as you use your computer — typically within 5 seconds.
          </div>
          <button className="onboarding-banner__close" onClick={() => setBannerDismissed(true)} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {showSteamPrompt && (
        <div className="onboarding-banner onboarding-banner--steam">
          <ExternalLink size={16} className="onboarding-banner__icon" />
          <div className="onboarding-banner__text">
            <strong>Using Steam?</strong>
            {' '}Import your game library for better artwork and grouping.{' '}
            <button
              className="onboarding-banner__link"
              onClick={() => navigate('/settings')}
            >
              Go to Settings → Data
            </button>
          </div>
          <button
            className="onboarding-banner__close"
            onClick={() => setSetting('steam_prompt_dismissed', true)}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="heatmap-accordion">
        <button className="heatmap-accordion__toggle" onClick={toggleHeatmap}>
          <span>Activity</span>
          <ChevronDown
            size={14}
            style={{ transform: heatmapOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
          />
        </button>
        {heatmapOpen && (
          <div className="heatmap-accordion__body">
            <Heatmap onDayClick={handleHeatmapDayClick} />
            {selectedDay && (
              <div className="heatmap-day-detail">
                <span className="heatmap-day-detail__date">{formatDayLabel(selectedDay)}</span>
                {dayApps.length === 0 ? (
                  <span className="heatmap-day-detail__empty">No activity recorded</span>
                ) : (
                  dayApps.slice(0, 5).map((app) => (
                    <div key={app.app_id} className="heatmap-day-detail__row">
                      <span className="heatmap-day-detail__row-name">{app.display_name}</span>
                      <span className="heatmap-day-detail__row-time">{fmtMs(app.active_ms)}</span>
                    </div>
                  ))
                )}
                <button className="heatmap-day-detail__clear" onClick={clearSelectedDay} title="Clear">×</button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="gallery-toolbar">
        <div className="gallery-search">
          <Search size={15} className="gallery-search__icon" />
          <input
            className="gallery-search__input"
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="gallery-filter">
          <button
            className={`gallery-filter__btn${filter === 'tracked' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setFilter('tracked')}
          >
            Tracked
          </button>
          <button
            className={`gallery-filter__btn${filter === 'ignored' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setFilter('ignored')}
          >
            Ignored
          </button>
        </div>

        <div className="gallery-filter">
          <button
            className={`gallery-filter__btn${sort === 'time' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setSort('time')}
          >
            Most time
          </button>
          <button
            className={`gallery-filter__btn${sort === 'name' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setSort('name')}
          >
            Name
          </button>
          <button
            className={`gallery-filter__btn${sort === 'last_seen' ? ' gallery-filter__btn--active' : ''}`}
            onClick={() => setSort('last_seen')}
          >
            Recent
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

    </main>
  )
}
