import { useEffect, useCallback, useRef, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import TitleBar from './components/layout/TitleBar'
import NavPills from './components/layout/NavPills'
import UpdateBanner from './components/layout/UpdateBanner'
import SetupWalkthrough from './components/setup/SetupWalkthrough'
import { ToastContainer } from './components/ui/Toast'
import { SteamLinkBannerContainer } from './components/ui/SteamLinkBanner'
import Gallery from './pages/Gallery'
import Settings from './pages/Settings'
import AppDetailPage from './pages/AppDetailPage'
import { useAppStore } from './store/appStore'
import { useSessionStore } from './store/sessionStore'
import { useUpdateStore } from './store/updateStore'
import { api } from './api/bridge'
import { bumpIconVersion } from './components/gallery/AppCard'

function ErrorBoundary({ children }: { children: React.ReactNode }): JSX.Element {
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      // Ignore resource load errors (broken image/script src) — those set event.error to null
      // and are not fatal JS crashes. Only treat real exceptions as fatal.
      if (event.error === null) return
      setHasError(true)
    }
    const handleUnhandled = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason)
      setHasError(true)
    }
    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandled)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandled)
    }
  }, [])

  if (hasError) {
    return (
      <div className="app-shell">
        <TitleBar />
        <div className="main-layout">
          <div className="main-content" style={{ padding: '2rem', textAlign: 'center' }}>
            <h2 style={{ marginBottom: '1rem' }}>Something went wrong</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
              The app encountered an unexpected error. Please restart the application.
            </p>
            <button
              onClick={() => {
                try { api.windowControl('restart') } catch { window.location.reload() }
              }}
              style={{
                padding: '0.5rem 1rem',
                background: 'var(--color-accent)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Restart App
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

function LoadingOverlay(): JSX.Element | null {
  const [loading, setLoading] = useState(true)
  const apps = useAppStore((s) => s.apps)

  useEffect(() => {
    if (apps.length > 0) {
      const timer = setTimeout(() => setLoading(false), 500)
      return () => clearTimeout(timer)
    }
  }, [apps])

  if (!loading) return null

  return (
    <div className="loading-overlay">
      <div className="loading-spinner" />
    </div>
  )
}

export default function App(): JSX.Element {
  const loadAll = useAppStore((s) => s.loadAll)
  const loadRange = useSessionStore((s) => s.loadRange)
  const onTick = useSessionStore((s) => s.onTick)
  const onDataCleared = useSessionStore((s) => s.onDataCleared)
  const setAvailable = useUpdateStore((s) => s.setAvailable)
  const setNotAvailable = useUpdateStore((s) => s.setNotAvailable)
  const setProgress = useUpdateStore((s) => s.setProgress)
  const setDownloaded = useUpdateStore((s) => s.setDownloaded)
  const setError = useUpdateStore((s) => s.setError)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  
  const [showSetup, setShowSetup] = useState(false)

  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    loadAll().then(() => {
      // Check if first run after loading settings
      // Must read from store directly to get fresh value after loadAll
      const firstRunCompleted = useAppStore.getState().settings['first_run_completed']
      // Treat undefined, null, false, or 'false' as not completed
      const isCompleted = firstRunCompleted === true || firstRunCompleted === 'true'
      if (!isCompleted) {
        setShowSetup(true)
      }
    })
    loadRange()

    const unsubTick = api.onTick((payload) => {
      onTick(payload)
    })
    const unsubAppSeen = api.onAppSeen((app) => {
      useAppStore.getState().upsertApp(app)
    })
    const unsubArtwork = api.onArtworkUpdated(() => {
      bumpIconVersion()
      useAppStore.getState().loadAll()
    })
    const unsubDataCleared = api.onDataCleared(() => {
      // Main process wiped the DB — reload apps/groups and reset session summary
      useAppStore.getState().loadAll()
      useSessionStore.getState().onDataCleared()
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
      unsubDataCleared()
      unsubAvailable()
      unsubNotAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [loadAll, loadRange, onTick, onDataCleared, setAvailable, setNotAvailable, setProgress, setDownloaded, setError])

  const handleSetupComplete = () => {
    setShowSetup(false)
    setSetting('first_run_completed', true)
  }

  if (showSetup) {
    return (
      <ErrorBoundary>
        <div className="app-shell">
          <TitleBar />
          <SetupWalkthrough onComplete={handleSetupComplete} />
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div className="app-shell">
        <LoadingOverlay />
        <TitleBar />
        <UpdateBanner />
        <ToastContainer />
        <SteamLinkBannerContainer onAnyMerged={loadAll} />
        <div className="main-layout">
          <NavPills />
          <div className="main-content">
            <Routes>
              <Route path="/" element={<Navigate to="/gallery" replace />} />
              <Route path="/gallery" element={<Gallery />} />
              <Route path="/app/:id" element={<AppDetailPage />} />
              <Route path="/group/:id" element={<AppDetailPage />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
