import { Download, Minus, RefreshCw, Square, X } from 'lucide-react'
import { useUpdateStore } from '../../store/updateStore'
import { api } from '../../api/bridge'

export default function TitleBar(): JSX.Element {
  const status = useUpdateStore((s) => s.status)
  const info = useUpdateStore((s) => s.info)
  const downloadUpdate = useUpdateStore((s) => s.downloadUpdate)
  const quitAndInstall = useUpdateStore((s) => s.quitAndInstall)

  const showUpdate = status === 'available' || status === 'downloading' || status === 'downloaded'
  const updateTitle =
    status === 'available' && info ? `Download v${info.version}`
    : status === 'downloading' ? 'Downloading update…'
    : status === 'downloaded' && info ? `Restart to install v${info.version}`
    : undefined

  const handleUpdateClick = () => {
    if (status === 'available') downloadUpdate()
    else if (status === 'downloaded') quitAndInstall()
  }

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
            onClick={handleUpdateClick}
            title={updateTitle}
            disabled={status === 'downloading'}
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
