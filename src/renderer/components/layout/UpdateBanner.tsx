import { useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { useUpdateStore } from '../../store/updateStore'

export default function UpdateBanner(): JSX.Element | null {
  const status = useUpdateStore((s) => s.status)
  const info = useUpdateStore((s) => s.info)
  const progress = useUpdateStore((s) => s.progress)
  const downloadUpdate = useUpdateStore((s) => s.downloadUpdate)
  const quitAndInstall = useUpdateStore((s) => s.quitAndInstall)
  const setNotAvailable = useUpdateStore((s) => s.setNotAvailable)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  if (status === 'available' && info) {
    return (
      <div className="update-banner update-banner--available">
        <span>Version {info.version} is available.</span>
        <button
          className="btn btn--primary"
          style={{ padding: '2px 10px', fontSize: 'var(--text-xs)' }}
          onClick={() => downloadUpdate()}
        >
          <Download size={12} />
          Download
        </button>
        <button
          className="btn--icon"
          onClick={() => { setNotAvailable(); setDismissed(true) }}
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  if (status === 'downloading') {
    const pct = Math.round(progress?.percent ?? 0)
    return (
      <div className="update-banner update-banner--downloading">
        <span>Downloading update… {pct}%</span>
        <div className="update-banner__bar">
          <div className="update-banner__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  if (status === 'downloaded' && info) {
    return (
      <div className="update-banner update-banner--downloaded">
        <span>Update {info.version} ready to install.</span>
        <button
          className="btn btn--primary"
          style={{ padding: '2px 10px', fontSize: 'var(--text-xs)' }}
          onClick={() => quitAndInstall()}
        >
          <RefreshCw size={12} />
          Restart to Install
        </button>
        <button
          className="btn--icon"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  return null
}
