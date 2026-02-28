import { useState, useMemo } from 'react'
import Fuse from 'fuse.js'
import { Search, ExternalLink } from 'lucide-react'
import '../styles/settings.css'
import { useAppStore } from '../store/appStore'
import AppFilterRow from '../components/settings/AppFilterRow'
import GroupEditor from '../components/settings/GroupEditor'
import ImportExport from '../components/settings/ImportExport'
import AboutUpdates from '../components/settings/AboutUpdates'

type Tab = 'tracking' | 'groups' | 'data' | 'artwork' | 'about'

export default function Settings(): JSX.Element {
  const [tab, setTab] = useState<Tab>('tracking')
  const [filterSearch, setFilterSearch] = useState('')
  const [sgdbKey, setSgdbKey] = useState<string | null>(null)
  const [sgdbKeySaved, setSgdbKeySaved] = useState(false)

  const apps = useAppStore((s) => s.apps)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)

  const pollInterval = Number(settings['poll_interval_ms'] ?? 5000)
  const trackingMode = (settings['tracking_mode'] as string) ?? 'blacklist'
  const storedSgdbKey = (settings['steamgriddb_api_key'] as string) ?? ''

  async function saveSgdbKey(): Promise<void> {
    const key = sgdbKey ?? storedSgdbKey
    await setSetting('steamgriddb_api_key', key)
    setSgdbKeySaved(true)
    setTimeout(() => setSgdbKeySaved(false), 2500)
  }

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
          ['artwork',  'Artwork'],
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

      {tab === 'artwork' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">SteamGridDB Integration</div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              Connect to <b>SteamGridDB</b> to search and import community artwork for any game or app.
              It's free — just create an account and generate an API key.
            </p>
            <a
              href="https://www.steamgriddb.com/profile/preferences/api"
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)', color: 'var(--color-accent)', marginBottom: 'var(--space-4)', textDecoration: 'none' }}
            >
              <ExternalLink size={13} /> Get your free API key
            </a>
            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              <input
                className="input"
                type="password"
                placeholder={storedSgdbKey ? '••••••••••••••••' : 'Paste your API key here'}
                value={sgdbKey ?? ''}
                onChange={(e) => { setSgdbKey(e.target.value); setSgdbKeySaved(false) }}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn--primary"
                onClick={saveSgdbKey}
                disabled={sgdbKey === null || sgdbKey.trim() === ''}
              >
                Save
              </button>
            </div>
            {sgdbKeySaved && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-accent)', marginTop: 'var(--space-2)' }}>
                API key saved.
              </p>
            )}
            {storedSgdbKey && !sgdbKeySaved && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-dim)', marginTop: 'var(--space-2)' }}>
                A key is already configured. Paste a new one above to replace it.
              </p>
            )}
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
