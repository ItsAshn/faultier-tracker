import { useState, useMemo } from 'react'
import Fuse from 'fuse.js'
import { Search } from 'lucide-react'
import '../styles/settings.css'
import { useAppStore } from '../store/appStore'
import AppFilterRow from '../components/settings/AppFilterRow'
import GroupEditor from '../components/settings/GroupEditor'
import ImportExport from '../components/settings/ImportExport'
import AboutUpdates from '../components/settings/AboutUpdates'

type Tab = 'tracking' | 'groups' | 'data' | 'about'

export default function Settings(): JSX.Element {
  const [tab, setTab] = useState<Tab>('tracking')
  const [filterSearch, setFilterSearch] = useState('')

  const apps = useAppStore((s) => s.apps)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)

  const pollInterval = Number(settings['poll_interval_ms'] ?? 5000)
  const trackingMode = (settings['tracking_mode'] as string) ?? 'blacklist'

  const fuse = useMemo(
    () => new Fuse(apps, { keys: ['display_name', 'exe_name'], threshold: 0.35 }),
    [apps]
  )

  const displayedApps = filterSearch.trim()
    ? fuse.search(filterSearch).map((r) => r.item)
    : apps

  return (
    <main className="page-content">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="settings-tabs">
        {([
          ['tracking', 'Tracking'],
          ['groups',   'Groups'],
          ['data',     'Data'],
          ['about',    'About']
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`settings-tab${tab === key ? ' settings-tab--active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'tracking' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">Poll Interval</div>
            <div className="polling-row">
              <span className="polling-row__label">Check every</span>
              <input
                type="range"
                min={1000}
                max={60000}
                step={1000}
                value={pollInterval}
                onChange={(e) => setSetting('poll_interval_ms', Number(e.target.value))}
              />
              <span className="polling-row__value">{pollInterval / 1000}s</span>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card__title">Tracking Mode</div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              <b>Blacklist:</b> track all apps except those you disable.<br />
              <b>Whitelist:</b> only track apps you explicitly enable.
            </p>
            <div className="mode-toggle">
              <button
                className={`mode-toggle__btn${trackingMode === 'blacklist' ? ' mode-toggle__btn--active' : ''}`}
                onClick={() => setSetting('tracking_mode', 'blacklist')}
              >
                Blacklist
              </button>
              <button
                className={`mode-toggle__btn${trackingMode === 'whitelist' ? ' mode-toggle__btn--active' : ''}`}
                onClick={() => setSetting('tracking_mode', 'whitelist')}
              >
                Whitelist
              </button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card__title">Applications</div>
            <div style={{ position: 'relative', marginBottom: 'var(--space-3)' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-dim)', pointerEvents: 'none' }} />
              <input
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="Search apps..."
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
              />
            </div>
            <div className="filter-list">
              {displayedApps.map((app) => (
                <AppFilterRow key={app.id} app={app} />
              ))}
              {displayedApps.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 'var(--text-sm)' }}>
                  No apps recorded yet. Use your computer — they'll appear here automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'groups' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">Group Management</div>
            <GroupEditor />
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">Import & Export</div>
            <ImportExport />
          </div>
        </div>
      )}

      {tab === 'about' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">About & Updates</div>
            <AboutUpdates />
          </div>
        </div>
      )}
    </main>
  )
}
