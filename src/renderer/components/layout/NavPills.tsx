import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSessionStore } from '../../store/sessionStore'
import '../../styles/nav-pills.css'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/gallery',   label: 'Gallery'   },
  { path: '/settings',  label: 'Settings'  },
]

export default function NavPills(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()

  const activeDisplayName = useSessionStore((s) => s.activeDisplayName)
  const isIdle = useSessionStore((s) => s.isIdle)
  const lastTickAt = useSessionStore((s) => s.lastTickAt)

  const [stale, setStale] = useState(false)

  // Keep a ref so the interval can read the latest value without being a dependency
  const lastTickAtRef = useRef(lastTickAt)
  useEffect(() => {
    lastTickAtRef.current = lastTickAt
  }, [lastTickAt])

  // Single stable interval — created once, reads via ref
  useEffect(() => {
    const interval = setInterval(() => {
      const ts = lastTickAtRef.current
      setStale(ts !== null && Date.now() - ts > 15_000)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  const dotColor =
    lastTickAt === null || stale
      ? 'var(--color-text-dim)'
      : isIdle
        ? 'var(--color-warning)'
        : 'var(--color-success)'

  const statusText =
    lastTickAt === null || stale
      ? 'Connecting…'
      : isIdle
        ? 'Idle'
        : activeDisplayName ?? 'Tracking'

  const isPulse = lastTickAt !== null && !stale && !isIdle

  return (
    <div className="nav-pills">
      <div className="nav-pills__links">
        {NAV_ITEMS.map(({ path, label }) => {
          const isActive =
            path === '/gallery'
              ? location.pathname === '/gallery' ||
                location.pathname.startsWith('/app/') ||
                location.pathname.startsWith('/group/')
              : location.pathname === path

          return (
            <button
              key={path}
              className={`nav-pills__pill ${isActive ? 'nav-pills__pill--active' : 'nav-pills__pill--inactive'}`}
              onClick={() => navigate(path)}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="nav-pills__status">
        <span
          className={`nav-pills__status-dot${isPulse ? ' nav-pills__status-dot--pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <span className="nav-pills__status-text" title={statusText}>
          {statusText}
        </span>
      </div>
    </div>
  )
}
