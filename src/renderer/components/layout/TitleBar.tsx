import { Download, Minus, RefreshCw, Square, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useUpdateStore } from '../../store/updateStore'
import { api } from '../../api/bridge'

export default function TitleBar(): JSX.Element {
  const navigate = useNavigate()
  const status = useUpdateStore((s) => s.status)
  const info = useUpdateStore((s) => s.info)

  const showUpdate = status === 'available' || status === 'downloading' || status === 'downloaded'
  const updateTitle =
    status === 'available' && info ? `Update available: v${info.version} — click to view`
    : status === 'downloading' ? 'Downloading update…'
    : status === 'downloaded' && info ? `v${info.version} ready to install — click to view`
    : undefined

  return (
    <header className="titlebar">
      <div className="titlebar__logo">
        <span className="titlebar__logo-text">Faultier Tracker</span>
      </div>

      <div className="titlebar__spacer" />

      <div className="titlebar__controls">
        {showUpdate && (
          <button
            className={`titlebar__control titlebar__control--update${status === 'downloaded' ? ' titlebar__control--update-ready' : ''}`}
            onClick={() => navigate('/settings?tab=about')}
            title={updateTitle}
          >
            {status === 'downloaded' ? <RefreshCw size={14} /> : <Download size={14} />}
          </button>
        )}
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
