import { RefreshCw, Download } from 'lucide-react'
import { useUpdateStore } from '../../store/updateStore'

const APP_VERSION = (import.meta as any).env?.VITE_APP_VERSION ?? '0.1.0'

export default function AboutUpdates(): JSX.Element {
  const status = useUpdateStore((s) => s.status)
  const info = useUpdateStore((s) => s.info)
  const progress = useUpdateStore((s) => s.progress)
  const error = useUpdateStore((s) => s.error)
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates)
  const downloadUpdate = useUpdateStore((s) => s.downloadUpdate)
  const quitAndInstall = useUpdateStore((s) => s.quitAndInstall)

  const isChecking = status === 'checking'
  const pct = Math.round(progress?.percent ?? 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Faultier Tracker</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Version {APP_VERSION}
          </div>
        </div>
        <button
          className="btn btn--ghost"
          onClick={() => checkForUpdates()}
          disabled={isChecking || status === 'downloading'}
        >
          <RefreshCw
            size={13}
            style={isChecking ? { animation: 'spin 1s linear infinite' } : undefined}
          />
          {isChecking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {status === 'not-available' && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)' }}>
          You are on the latest version.
        </div>
      )}

      {status === 'available' && info && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-sm)' }}>Version {info.version} is available.</span>
          <button className="btn btn--primary" onClick={() => downloadUpdate()}>
            <Download size={13} />
            Download
          </button>
        </div>
      )}

      {status === 'downloading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Downloading… {pct}%
          </span>
          <div className="update-banner__bar" style={{ width: '100%' }}>
            <div className="update-banner__bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {status === 'downloaded' && info && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>
            Version {info.version} is ready to install.
          </span>
          <button className="btn btn--primary" onClick={() => quitAndInstall()}>
            Restart to Install
          </button>
        </div>
      )}

      {status === 'error' && error && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)' }}>
          {error.startsWith('404')
            ? 'No releases have been published yet.'
            : `Update check failed: ${error}`}
        </div>
      )}
    </div>
  )
}
