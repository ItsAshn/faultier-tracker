import { useState, useEffect, KeyboardEvent } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Clock, Activity, AppWindow, X } from 'lucide-react'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import '../styles/app-detail.css'
import { useAppStore } from '../store/appStore'
import { api } from '../api/bridge'
import type { AppRecord, AppGroup, AppRangeSummary } from '@shared/types'
import TimeBarChart from '../components/dashboard/TimeBarChart'
import ImageUploader from '../components/gallery/ImageUploader'
import ArtworkSearchModal from '../components/gallery/ArtworkSearchModal'

type Preset = 'today' | 'week' | 'month'

function computeRange(preset: Preset): { from: number; to: number; groupBy: 'hour' | 'day' } {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime(), groupBy: 'hour' }
    case 'week':
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }).getTime(),
        to: endOfWeek(now, { weekStartsOn: 1 }).getTime(),
        groupBy: 'day'
      }
    case 'month':
      return { from: startOfMonth(now).getTime(), to: endOfMonth(now).getTime(), groupBy: 'day' }
  }
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return '<1m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

interface MemberRowProps {
  appId: number
  displayName: string
  activeMs: number
  maxMs: number
}

function MemberRow({ appId, displayName, activeMs, maxMs }: MemberRowProps): JSX.Element {
  const [icon, setIcon] = useState<string | null>(null)

  useEffect(() => {
    api.getIconForApp(appId).then(setIcon)
  }, [appId])

  return (
    <div className="app-detail__member-row">
      <div className="app-detail__member-icon">
        {icon
          ? <img src={icon} alt={displayName} />
          : <AppWindow size={14} />
        }
      </div>
      <span className="app-detail__member-name" title={displayName}>{displayName}</span>
      <div className="app-detail__member-bar-wrap">
        <div
          className="app-detail__member-bar"
          style={{ width: maxMs > 0 ? `${(activeMs / maxMs) * 100}%` : '0%' }}
        />
      </div>
      <span className="app-detail__member-time">{fmtMs(activeMs)}</span>
    </div>
  )
}

export default function AppDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const isGroup = location.pathname.startsWith('/group/')
  const numId = Number(id)

  const apps = useAppStore((s) => s.apps)
  const groups = useAppStore((s) => s.groups)
  const updateApp = useAppStore((s) => s.updateApp)
  const updateGroup = useAppStore((s) => s.updateGroup)
  const setAppTracked = useAppStore((s) => s.setAppTracked)
  const setAppGroup = useAppStore((s) => s.setAppGroup)

  const item = isGroup
    ? groups.find((g) => g.id === numId)
    : apps.find((a) => a.id === numId)

  // Analytics state
  const [preset, setPreset] = useState<Preset>('week')
  const [rangeData, setRangeData] = useState<AppRangeSummary | null>(null)
  const [loading, setLoading] = useState(false)

  // Hero icon
  const [iconSrc, setIconSrc] = useState<string | null>(null)

  // Edit section
  const [editOpen, setEditOpen] = useState(false)
  const [artworkModalOpen, setArtworkModalOpen] = useState(false)

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)

  // Sync form state when item loads
  useEffect(() => {
    if (!item) return
    if (isGroup) {
      const g = item as AppGroup
      setDisplayName(g.name)
      setDescription(g.description)
      setTags(g.tags)
    } else {
      const a = item as AppRecord
      setDisplayName(a.display_name)
      setDescription(a.description)
      setNotes(a.notes)
      setTags(a.tags)
      setGroupId(a.group_id)
    }
  }, [item?.id])

  // Load icon
  useEffect(() => {
    if (!item) return
    const src = item.custom_image_path || item.icon_cache_path
    if (src) {
      setIconSrc(src)
    } else if (isGroup) {
      api.getIconForGroup(numId).then(setIconSrc)
    } else {
      api.getIconForApp(numId).then(setIconSrc)
    }
  }, [numId, isGroup, item?.custom_image_path, item?.icon_cache_path])

  // Load range data
  useEffect(() => {
    if (!item) return
    const { from, to, groupBy } = computeRange(preset)
    setLoading(true)
    api.getAppSessionRange(numId, from, to, groupBy, isGroup)
      .then(setRangeData)
      .finally(() => setLoading(false))
  }, [numId, isGroup, preset, item?.id])

  function addTag(): void {
    const t = tagInput.trim().toLowerCase()
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t])
    setTagInput('')
  }

  function handleTagKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !tagInput) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

  async function handleSave(): Promise<void> {
    if (isGroup) {
      await updateGroup({ id: numId, name: displayName, description, tags })
    } else {
      await updateApp({ id: numId, display_name: displayName, description, notes, tags })
      if (groupId !== (item as AppRecord).group_id) {
        await setAppGroup(numId, groupId)
      }
    }
    setEditOpen(false)
  }

  function handleCancel(): void {
    if (!item) return
    if (isGroup) {
      const g = item as AppGroup
      setDisplayName(g.name)
      setDescription(g.description)
      setTags(g.tags)
    } else {
      const a = item as AppRecord
      setDisplayName(a.display_name)
      setDescription(a.description)
      setNotes(a.notes)
      setTags(a.tags)
      setGroupId(a.group_id)
    }
    setEditOpen(false)
  }

  // Not found
  if (!item) {
    return (
      <main className="page-content app-detail">
        <div className="app-detail__back-row">
          <button className="btn btn--ghost app-detail__back-btn" onClick={() => navigate('/gallery')}>
            <ArrowLeft size={16} /> Back to Gallery
          </button>
        </div>
        <div className="app-detail__not-found">App not found.</div>
      </main>
    )
  }

  const name = isGroup ? (item as AppGroup).name : (item as AppRecord).display_name
  const isTracked = !isGroup && (item as AppRecord).is_tracked
  const memberCount = isGroup ? apps.filter((a) => a.group_id === numId).length : 0
  const maxMemberMs = rangeData?.member_summaries[0]?.active_ms ?? 0

  return (
    <main className="page-content app-detail">

      {/* Back button */}
      <div className="app-detail__back-row">
        <button className="btn btn--ghost app-detail__back-btn" onClick={() => navigate('/gallery')}>
          <ArrowLeft size={16} /> Back to Gallery
        </button>
      </div>

      {/* Hero */}
      <div className="app-detail__hero">
        {iconSrc && (
          <div className="app-detail__hero-backdrop">
            <img src={iconSrc} alt="" aria-hidden />
          </div>
        )}
        <div className="app-detail__hero-art">
          {iconSrc
            ? <img src={iconSrc} alt={name} />
            : <div className="app-detail__hero-art-placeholder"><AppWindow size={40} /></div>
          }
        </div>
        <div className="app-detail__hero-info">
          <div className="app-detail__hero-name">{name}</div>
          <div className="app-detail__hero-meta">
            {isGroup
              ? <span>{memberCount} {memberCount === 1 ? 'app' : 'apps'}</span>
              : (
                <>
                  <span>{(item as AppRecord).exe_name}</span>
                  {(item as AppRecord).first_seen > 0 && (
                    <span>First seen {fmtDate((item as AppRecord).first_seen)}</span>
                  )}
                </>
              )
            }
          </div>
          {item.tags.length > 0 && (
            <div className="app-detail__hero-tags">
              {item.tags.map((tag) => (
                <span key={tag} className="app-detail__tag">{tag}</span>
              ))}
            </div>
          )}
          {!isGroup && (
            <div className="app-detail__hero-track">
              <label className="app-detail__track-label">
                <span>Tracked</span>
                <button
                  className={`app-detail__track-toggle${isTracked ? ' app-detail__track-toggle--on' : ''}`}
                  onClick={() => setAppTracked(numId, !isTracked)}
                  aria-label={isTracked ? 'Stop tracking' : 'Start tracking'}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Date range */}
      <div className="app-detail__range-row">
        <div className="date-range-picker">
          {(['today', 'week', 'month'] as Preset[]).map((p) => (
            <button
              key={p}
              className={`date-range-picker__tab${preset === p ? ' date-range-picker__tab--active' : ''}`}
              onClick={() => setPreset(p)}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="app-detail__stats">
        <div className="summary-card">
          <div className="summary-card__icon">
            <Activity size={16} />
          </div>
          <div className="summary-card__label">Active Time</div>
          <div className="summary-card__value">
            {loading ? '—' : rangeData ? fmtMs(rangeData.active_ms) : '—'}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-card__icon">
            <Clock size={16} />
          </div>
          <div className="summary-card__label">Running Time</div>
          <div className="summary-card__value">
            {loading ? '—' : rangeData ? fmtMs(rangeData.running_ms) : '—'}
          </div>
        </div>
      </div>

      {/* Chart */}
      {rangeData && rangeData.chart_points.length > 0 && (
        <TimeBarChart data={rangeData.chart_points} />
      )}
      {!loading && rangeData && rangeData.chart_points.length === 0 && (
        <div className="app-detail__empty-chart">No activity in this period.</div>
      )}

      {/* Member apps (groups only) */}
      {isGroup && rangeData && rangeData.member_summaries.length > 0 && (
        <div className="app-detail__members">
          <div className="app-detail__section-title">Member Apps</div>
          {rangeData.member_summaries.map((m) => (
            <MemberRow
              key={m.app_id}
              appId={m.app_id}
              displayName={m.display_name}
              activeMs={m.active_ms}
              maxMs={maxMemberMs}
            />
          ))}
        </div>
      )}

      {/* Edit section */}
      <div className="app-detail__edit">
        <button
          className="app-detail__edit-header"
          onClick={() => setEditOpen((v) => !v)}
        >
          <span className="app-detail__edit-header-title">Settings</span>
          <ChevronDown
            size={16}
            className={`app-detail__edit-chevron${editOpen ? ' app-detail__edit-chevron--open' : ''}`}
          />
        </button>

        {editOpen && (
          <div className="app-detail__edit-body">
            <ImageUploader
              id={numId}
              isGroup={isGroup}
              currentSrc={iconSrc}
              onUpdated={(url) => setIconSrc(url)}
              onSearchOnline={() => setArtworkModalOpen(true)}
            />

            <div className="field">
              <label className="field__label">{isGroup ? 'Group Name' : 'Display Name'}</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={isGroup ? 'Group name' : 'App name'}
              />
            </div>

            <div className="field">
              <label className="field__label">Description</label>
              <textarea
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
                style={{ resize: 'vertical' }}
              />
            </div>

            {!isGroup && (
              <div className="field">
                <label className="field__label">Notes</label>
                <textarea
                  className="input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Personal notes..."
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>
            )}

            <div className="field">
              <label className="field__label">Tags (press Enter or comma to add)</label>
              <div
                className="tags-input"
                onClick={() => document.getElementById('detail-tag-field')?.focus()}
              >
                {tags.map((tag) => (
                  <span key={tag} className="tags-input__tag">
                    {tag}
                    <button
                      className="tags-input__tag-remove"
                      onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <input
                  id="detail-tag-field"
                  className="tags-input__field"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKey}
                  onBlur={addTag}
                  placeholder={tags.length === 0 ? 'Add tags...' : ''}
                />
              </div>
            </div>

            {!isGroup && groups.length > 0 && (
              <div className="field">
                <label className="field__label">Group</label>
                <select
                  className="input"
                  value={groupId ?? ''}
                  onChange={(e) => setGroupId(e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">— No group —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="app-detail__edit-actions">
              <button className="btn btn--ghost" onClick={handleCancel}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        )}
      </div>

      {artworkModalOpen && (
        <ArtworkSearchModal
          appId={numId}
          displayName={name}
          isGroup={isGroup}
          onClose={() => setArtworkModalOpen(false)}
          onApply={(url) => setIconSrc(url)}
        />
      )}
    </main>
  )
}
