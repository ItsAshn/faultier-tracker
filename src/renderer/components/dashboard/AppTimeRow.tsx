import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AppRecord, AppGroup, SessionSummary } from '@shared/types'
import { useAppStore } from '../../store/appStore'
import { getIconUrl } from '../../utils/iconUrl'

function fmtMs(ms: number): string {
  if (ms < 60_000) return '< 1m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface AppIconProps {
  appId: number
  size?: number
}

function AppIcon({ appId, size = 40 }: AppIconProps): JSX.Element {
  const [error, setError] = useState(false)
  const url = getIconUrl('app', appId)
  if (error) {
    return <div className="time-row__icon-placeholder" style={{ width: size, height: size }}>□</div>
  }
  return <img className="time-row__icon" src={url} alt="" width={size} height={size} onError={() => setError(true)} />
}

interface RowProps {
  summary: SessionSummary
  app: AppRecord
}

function ChildRow({ summary, app }: RowProps): JSX.Element {
  const setAppTracked = useAppStore((s) => s.setAppTracked)
  return (
    <div className="time-row time-row--child">
      <div className="time-row__app">
        <AppIcon appId={app.id} size={28} />
        <span className="time-row__name" title={app.exe_name}>{app.exe_name}</span>
      </div>
      <span className={`time-row__duration${summary.active_ms > 0 ? ' time-row__duration--active' : ''}`}>
        {fmtMs(summary.active_ms)}
      </span>
      <div className="time-row__actions">
        <label className="toggle" title={app.is_tracked ? 'Stop tracking' : 'Start tracking'}>
          <input
            type="checkbox"
            className="toggle__input"
            checked={app.is_tracked}
            onChange={(e) => setAppTracked(app.id, e.target.checked)}
          />
          <span className="toggle__track" />
          <span className="toggle__thumb" />
        </label>
      </div>
    </div>
  )
}

interface GroupRowProps {
  group: AppGroup
  summaries: SessionSummary[]
  apps: AppRecord[]
}

export function GroupTimeRow({ group, summaries, apps }: GroupRowProps): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [iconError, setIconError] = useState(false)
  const iconUrl = getIconUrl('group', group.id)

  const totalActive = summaries.reduce((acc, s) => acc + s.active_ms, 0)

  return (
    <>
      <div
        className="time-row time-row--group"
        onClick={() => summaries.length > 1 && setExpanded((v) => !v)}
      >
        <div className="time-row__app">
          {!iconError
            ? <img className="time-row__icon" src={iconUrl} alt="" onError={() => setIconError(true)} />
            : <div className="time-row__icon-placeholder">□</div>
          }
          <span className="time-row__name">{group.name}</span>
          {summaries.length > 1 && (
            <ChevronRight
              size={14}
              className={`time-row__expand${expanded ? ' time-row__expand--open' : ''}`}
            />
          )}
        </div>
        <span className={`time-row__duration${totalActive > 0 ? ' time-row__duration--active' : ''}`}>
          {fmtMs(totalActive)}
        </span>
        <div className="time-row__actions" onClick={(e) => e.stopPropagation()}>
          <span className="badge">{summaries.length}</span>
        </div>
      </div>

      {expanded && summaries.map((s) => {
        const app = apps.find((a) => a.id === s.app_id)
        if (!app) return null
        return <ChildRow key={s.app_id} summary={s} app={app} />
      })}
    </>
  )
}

interface UngroupedRowProps {
  summary: SessionSummary
  app: AppRecord
}

export function UngroupedTimeRow({ summary, app }: UngroupedRowProps): JSX.Element {
  const setAppTracked = useAppStore((s) => s.setAppTracked)
  return (
    <div className="time-row">
      <div className="time-row__app">
        <AppIcon appId={app.id} />
        <span className="time-row__name" title={app.display_name}>{app.display_name}</span>
      </div>
      <span className={`time-row__duration${summary.active_ms > 0 ? ' time-row__duration--active' : ''}`}>
        {fmtMs(summary.active_ms)}
      </span>
      <div className="time-row__actions">
        <label className="toggle">
          <input
            type="checkbox"
            className="toggle__input"
            checked={app.is_tracked}
            onChange={(e) => setAppTracked(app.id, e.target.checked)}
          />
          <span className="toggle__track" />
          <span className="toggle__thumb" />
        </label>
      </div>
    </div>
  )
}
