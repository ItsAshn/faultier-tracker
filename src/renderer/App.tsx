import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import TitleBar from './components/layout/TitleBar'
import Sidebar from './components/layout/Sidebar'
import UpdateBanner from './components/layout/UpdateBanner'
import Dashboard from './pages/Dashboard'
import Gallery from './pages/Gallery'
import Settings from './pages/Settings'
import AppDetailPage from './pages/AppDetailPage'
import { useAppStore } from './store/appStore'
import { useSessionStore } from './store/sessionStore'
import { useUpdateStore } from './store/updateStore'
import { api } from './api/bridge'

export default function App(): JSX.Element {
  const loadAll = useAppStore((s) => s.loadAll)
  const loadRange = useSessionStore((s) => s.loadRange)
  const onTick = useSessionStore((s) => s.onTick)
  const setAvailable = useUpdateStore((s) => s.setAvailable)
  const setNotAvailable = useUpdateStore((s) => s.setNotAvailable)
  const setProgress = useUpdateStore((s) => s.setProgress)
  const setDownloaded = useUpdateStore((s) => s.setDownloaded)
  const setError = useUpdateStore((s) => s.setError)

  useEffect(() => {
    loadAll()
    loadRange()

    const unsubTick = api.onTick((payload) => {
      onTick(payload)
    })
    const unsubAppSeen = api.onAppSeen((app) => {
      useAppStore.getState().upsertApp(app)
    })
    const unsubArtwork = api.onArtworkUpdated(() => {
      useAppStore.getState().loadAll()
    })
    const unsubAvailable = api.onUpdateAvailable(setAvailable)
    const unsubNotAvailable = api.onUpdateNotAvailable(setNotAvailable)
    const unsubProgress = api.onUpdateDownloadProgress(setProgress)
    const unsubDownloaded = api.onUpdateDownloaded(setDownloaded)
    const unsubError = api.onUpdateError(setError)

    return () => {
      unsubTick()
      unsubAppSeen()
      unsubArtwork()
      unsubAvailable()
      unsubNotAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  return (
    <div className="app-shell">
      <TitleBar />
      <UpdateBanner />
      <div className="main-layout">
        <Sidebar />
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/app/:id" element={<AppDetailPage />} />
          <Route path="/group/:id" element={<AppDetailPage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </div>
  )
}
