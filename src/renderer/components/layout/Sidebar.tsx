import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Images, Settings } from 'lucide-react'
import { useSessionStore } from '../../store/sessionStore'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { path: '/gallery',   label: 'Gallery',   Icon: Images },
  { path: '/settings',  label: 'Settings',  Icon: Settings }
]

export default function Sidebar(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()

  const activeDisplayName = useSessionStore((s) => s.activeDisplayName)
  const isIdle = useSessionStore((s) => s.isIdle)
  const lastTickAt = useSessionStore((s) => s.lastTickAt)

  const [stale, setStale] = useState(false)

  useEffect(() => {
    // Mark stale if no tick in the last 15 seconds
    const interval = setInterval(() => {
      if (lastTickAt !== null && Date.now() - lastTickAt > 15_000) {
        setStale(true)
      } else {
        setStale(false)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [lastTickAt])

  const dotColor = lastTickAt === null || stale
    ? 'var(--color-text-dim)'
    : isIdle
      ? 'var(--color-warning)'
      : 'var(--color-success)'

  const statusText = lastTickAt === null || stale
    ? 'Connecting…'
    : isIdle
      ? 'Idle'
      : activeDisplayName ?? 'Tracking'

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ path, label, Icon }) => (
          <button
            key={path}
            className={`sidebar__link${
            (path === '/gallery'
              ? location.pathname === '/gallery' ||
                location.pathname.startsWith('/app/') ||
                location.pathname.startsWith('/group/')
              : location.pathname === path)
              ? ' sidebar__link--active'
              : ''
          }`}
            onClick={() => navigate(path)}
          >
            <Icon className="sidebar__icon" />
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar__status">
        <span
          className={`sidebar__status-dot${lastTickAt !== null && !stale && !isIdle ? ' sidebar__status-dot--pulse' : ''}`}
          style={{ background: dotColor }}
        />
        <span className="sidebar__status-text" title={statusText}>{statusText}</span>
      </div>
    </aside>
  )
}
