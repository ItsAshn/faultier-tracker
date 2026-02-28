import { useState, useMemo } from 'react'
import Fuse from 'fuse.js'
import { Search, Images } from 'lucide-react'
import '../styles/gallery.css'
import { useAppStore } from '../store/appStore'
import { useSessionStore } from '../store/sessionStore'
import AppCard from '../components/gallery/AppCard'
import AppCardEditor from '../components/gallery/AppCardEditor'
import type { AppRecord, AppGroup } from '@shared/types'

type FilterMode = 'all' | 'tracked' | 'ignored'

interface GalleryItem {
  id: number
  isGroup: boolean
  item: AppRecord | AppGroup
  memberCount?: number
}

export default function Gallery(): JSX.Element {
  const apps = useAppStore((s) => s.apps)
  const groups = useAppStore((s) => s.groups)
  const summary = useSessionStore((s) => s.summary)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [editing, setEditing] = useState<GalleryItem | null>(null)

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
    if (filter === 'all') return allItems
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

  const displayed = search.trim()
    ? fuse.search(search).map((r) => r.item)
    : filtered

  function getTodaySummary(item: GalleryItem) {
    if (!summary) return null
    if (item.isGroup) {
      const memberIds = apps.filter((a) => a.group_id === item.id).map((a) => a.id)
      const sums = summary.apps.filter((s) => memberIds.includes(s.app_id))
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
    return summary.apps.find((s) => s.app_id === item.id) ?? null
  }

  return (
    <main className="page-content">
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
          {(['all', 'tracked', 'ignored'] as FilterMode[]).map((f) => (
            <button
              key={f}
              className={`gallery-filter__btn${filter === f ? ' gallery-filter__btn--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
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
              todaySummary={getTodaySummary(item)}
              onClick={() => setEditing(item)}
            />
          ))
        )}
      </div>

      {editing && (
        <AppCardEditor
          item={editing.item}
          isGroup={editing.isGroup}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  )
}
