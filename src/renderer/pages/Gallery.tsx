import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Fuse from 'fuse.js'
import { Search, Images } from 'lucide-react'
import '../styles/gallery.css'
import { useAppStore } from '../store/appStore'
import AppCard from '../components/gallery/AppCard'
import { api } from '../api/bridge'
import type { AppRecord, AppGroup, RangeSummary } from '@shared/types'

type FilterMode = 'tracked' | 'ignored'
type SortMode = 'time' | 'name' | 'last_seen'

const SCROLL_KEY = 'gallery-scroll'

interface GalleryItem {
  id: number
  isGroup: boolean
  item: AppRecord | AppGroup
  memberCount?: number
}

export default function Gallery(): JSX.Element {
  const apps = useAppStore((s) => s.apps)
  const groups = useAppStore((s) => s.groups)
  const [allTimeSummary, setAllTimeSummary] = useState<RangeSummary | null>(null)

  useEffect(() => {
    api.getSessionRange(0, Date.now()).then(setAllTimeSummary)
  }, [])

  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('tracked')
  const [sort, setSort] = useState<SortMode>('time')

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
    return s ? s.active_ms + s.running_ms : 0
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
      <div className="page-header">
        <h1 className="page-title">Gallery</h1>
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
