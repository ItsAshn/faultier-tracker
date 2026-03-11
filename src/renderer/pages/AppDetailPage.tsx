import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Activity, AppWindow, X, Settings } from 'lucide-react'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import '../styles/app-detail.css'
import { useAppStore } from '../store/appStore'
import { api } from '../api/bridge'
import type { AppRecord, AppGroup, AppRangeSummary } from '@shared/types'
import TimeBarChart from '../components/dashboard/TimeBarChart'
import AppHeatmap from '../components/dashboard/AppHeatmap'
import ImageUploader from '../components/gallery/ImageUploader'
import ArtworkSearchModal from '../components/gallery/ArtworkSearchModal'

type Preset = 'today' | 'week' | 'month' | 'all'

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
    case 'all':
      return { from: 0, to: Date.now(), groupBy: 'day' }
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
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [artworkModalOpen, setArtworkModalOpen] = useState(false)

  // Form state
  const [displayName, setDisplayName] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)

  // Sync form state when item loads
  useEffect(() => {
    if (!item) return
    if (isGroup) {
      const g = item as AppGroup
      setDisplayName(g.name)
    } else {
      const a = item as AppRecord
      setDisplayName(a.display_name)
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
      api.getIconForGroup(numId).then(setIconSrc).catch(() => {})
    } else {
      api.getIconForApp(numId).then(setIconSrc).catch(() => {})
    }
  }, [numId, isGroup, item?.custom_image_path, item?.icon_cache_path])

  // Load range data
  useEffect(() => {
    if (!item) return
    let cancelled = false
    const { from, to, groupBy } = computeRange(preset)
    setLoading(true)
    api.getAppSessionRange(numId, from, to, groupBy, isGroup)
      .then((data) => { if (!cancelled) setRangeData(data) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [numId, isGroup, preset, item?.id])

  async function handleSave(): Promise<void> {
    if (isGroup) {
      await updateGroup({ id: numId, name: displayName })
    } else {
      await updateApp({ id: numId, display_name: displayName })
      if (groupId !== (item as AppRecord).group_id) {
        await setAppGroup(numId, groupId)
      }
    }
    setSettingsModalOpen(false)
  }

  function handleCancel(): void {
    if (!item) return
    if (isGroup) {
      const g = item as AppGroup
      setDisplayName(g.name)
    } else {
      const a = item as AppRecord
      setDisplayName(a.display_name)
      setGroupId(a.group_id)
    }
    setSettingsModalOpen(false)
  }

  // Check if this is a Steam game
  const isSteamGame = !isGroup && (item as AppRecord)?.exe_name?.startsWith('steam:')

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
        <button
          className="app-detail__hero-cog"
          onClick={() => setSettingsModalOpen(true)}
          title="App settings"
        >
          <Settings size={15} />
        </button>
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
          {!isGroup && !isSteamGame && (
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
          {!isGroup && isSteamGame && (
            <div className="app-detail__hero-track">
              <span className="app-detail__steam-badge">Steam</span>
              <span className="app-detail__steam-note">Tracked by Steam</span>
            </div>
          )}
        </div>
      </div>

      {/* Total time - Hero stat */}
      <div className="app-detail__total-time">
        <div className="app-detail__total-time-label">Total Time</div>
        <div className="app-detail__total-time-value">
          {loading ? '—' : rangeData ? fmtMs(rangeData.active_ms) : '—'}
        </div>
      </div>

      {/* Date range */}
      <div className="app-detail__range-row">
        <div className="date-range-picker">
          {(['today', 'week', 'month', 'all'] as Preset[]).map((p) => (
            <button
              key={p}
              className={`date-range-picker__tab${preset === p ? ' date-range-picker__tab--active' : ''}`}
              onClick={() => setPreset(p)}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
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
      </div>

      {/* Chart */}
      {rangeData && rangeData.chart_points.length > 0 && (
        <TimeBarChart data={rangeData.chart_points} />
      )}
      {!loading && rangeData && rangeData.chart_points.length === 0 && (
        <div className="app-detail__empty-chart">No activity in this period.</div>
      )}

      {/* Per-app heatmap */}
      <AppHeatmap appId={numId} isGroup={isGroup} />

      {/* Settings Modal */}
      {settingsModalOpen && (
        <div className="modal-overlay" onClick={() => setSettingsModalOpen(false)}>
          <div
            className="modal app-detail__settings-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__header">
              <h2 className="modal__title">Settings</h2>
              <button className="btn--icon" onClick={() => setSettingsModalOpen(false)}><X size={18} /></button>
            </div>

            <div className="app-detail__settings-body">
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
            </div>

            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={handleCancel}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

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
