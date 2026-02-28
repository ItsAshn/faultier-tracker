import { useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Images, Settings } from 'lucide-react'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { path: '/gallery',   label: 'Gallery',   Icon: Images },
  { path: '/settings',  label: 'Settings',  Icon: Settings }
]

export default function Sidebar(): JSX.Element {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <aside className="sidebar">
      <nav className="sidebar__nav">
        {NAV_ITEMS.map(({ path, label, Icon }) => (
          <button
            key={path}
            className={`sidebar__link${location.pathname === path ? ' sidebar__link--active' : ''}`}
            onClick={() => navigate(path)}
          >
            <Icon className="sidebar__icon" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
