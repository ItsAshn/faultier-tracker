import { Minus, Square, X } from 'lucide-react'
import { useSessionStore } from '../../store/sessionStore'
import { useAppStore } from '../../store/appStore'
import { api } from '../../api/bridge'

function formatDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function TitleBar(): JSX.Element {
  const activeAppId = useSessionStore((s) => s.activeAppId)
  const activeExeName = useSessionStore((s) => s.activeExeName)
  const apps = useAppStore((s) => s.apps)
  const summary = useSessionStore((s) => s.summary)

  const activeApp = apps.find((a) => a.id === activeAppId)
  const todayActive = summary?.total_active_ms ?? 0

  return (
    <header className="titlebar">
      <div className="titlebar__logo">
        <span style={{ fontSize: 18 }}>🦥</span>
        <span className="titlebar__logo-text">Faultier Tracker</span>
      </div>

      <div className="titlebar__spacer" />

      <div className="titlebar__status">
        <span className={`titlebar__status-dot${activeAppId ? '' : ' titlebar__status-dot--idle'}`} />
        {activeApp
          ? `${activeApp.display_name} — ${formatDuration(todayActive)} today`
          : activeExeName
          ? activeExeName
          : 'Idle'}
      </div>

      <div className="titlebar__controls">
        <button
          className="titlebar__control"
          onClick={() => api.windowControl('minimize')}
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          className="titlebar__control"
          onClick={() => api.windowControl('maximize')}
          title="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          className="titlebar__control titlebar__control--close"
          onClick={() => api.windowControl('close')}
          title="Hide to tray"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  )
}
