import { useState, useEffect } from 'react'
import { Search, ExternalLink } from 'lucide-react'
import '../styles/settings.css'
import { useAppStore } from '../store/appStore'
import AppFilterRow from '../components/settings/AppFilterRow'
import GroupEditor from '../components/settings/GroupEditor'
import ImportExport from '../components/settings/ImportExport'
import AboutUpdates from '../components/settings/AboutUpdates'

type Tab = 'tracking' | 'groups' | 'data' | 'artwork' | 'about'

const IDLE_OPTIONS = [
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '15 min', value: 900000 },
]

export default function Settings(): JSX.Element {
  const [tab, setTab] = useState<Tab>('tracking')
  const [filterSearch, setFilterSearch] = useState('')
  const [customIdleMinutes, setCustomIdleMinutes] = useState<string>('')
  const [sgdbKey, setSgdbKey] = useState<string>('')
  const [sgdbKeySaved, setSgdbKeySaved] = useState(false)
  const [sgdbKeyError, setSgdbKeyError] = useState<string | null>(null)

  const apps = useAppStore((s) => s.apps)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)

  const pollInterval = Number(settings['poll_interval_ms'] ?? 5000)
  const idleThreshold = Number(settings['idle_threshold_ms'] ?? 300000)
  const launchAtStartup = settings['launch_at_startup'] === true || settings['launch_at_startup'] === 'true'
  const storedSgdbKey = (settings['steamgriddb_api_key'] as string) ?? ''

  // Initialize SteamGridDB key from stored settings
  useEffect(() => {
    setSgdbKey(storedSgdbKey)
  }, [storedSgdbKey])

  function handleIdleOption(value: number) {
    setSetting('idle_threshold_ms', value)
    setCustomIdleMinutes('')
  }

  function handleCustomIdle() {
    const minutes = parseInt(customIdleMinutes, 10)
    if (!isNaN(minutes) && minutes >= 1 && minutes <= 60) {
      setSetting('idle_threshold_ms', minutes * 60 * 1000)
    }
  }

  async function saveSgdbKey(): Promise<void> {
    if (!sgdbKey.trim()) return
    try {
      await setSetting('steamgriddb_api_key', sgdbKey.trim())
      setSgdbKeySaved(true)
      setSgdbKeyError(null)
      setTimeout(() => setSgdbKeySaved(false), 2500)
    } catch (err) {
      setSgdbKeyError('Failed to save API key. Please try again.')
    }
  }

  const currentIdleMinutes = Math.round(idleThreshold / 60000)
  const isCustomIdle = !IDLE_OPTIONS.some(opt => opt.value === idleThreshold)

  // Filter apps for display
  const displayedApps = filterSearch.trim()
    ? apps.filter(app => 
        app.display_name.toLowerCase().includes(filterSearch.toLowerCase()) ||
        app.exe_name.toLowerCase().includes(filterSearch.toLowerCase())
      )
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

      {/* Tracking Tab */}
      {tab === 'tracking' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">Launch at Startup</div>
            <p className="settings-card__description">
              Automatically start KIOKU when you log in to Windows.
            </p>
            <div className="mode-toggle">
              <button
                className={`mode-toggle__btn${launchAtStartup ? ' mode-toggle__btn--active' : ''}`}
                onClick={() => setSetting('launch_at_startup', true)}
              >
                On
              </button>
              <button
                className={`mode-toggle__btn${!launchAtStartup ? ' mode-toggle__btn--active' : ''}`}
                onClick={() => setSetting('launch_at_startup', false)}
              >
                Off
              </button>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card__title">Poll Interval</div>
            <p className="settings-card__description">
              How often to check for the active window. Lower = more accurate but slightly more CPU usage.
            </p>
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
            <div className="settings-card__title">Idle Detection</div>
            <p className="settings-card__description">
              When you step away from your computer, pause tracking after this period of inactivity.
            </p>
            <div className="idle-options">
              {IDLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`idle-option${idleThreshold === opt.value ? ' idle-option--active' : ''}`}
                  onClick={() => handleIdleOption(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
              <div className="idle-option-custom">
                <input
                  type="number"
                  min={1}
                  max={60}
                  placeholder="Custom"
                  value={isCustomIdle ? currentIdleMinutes : customIdleMinutes}
                  onChange={(e) => setCustomIdleMinutes(e.target.value)}
                  onBlur={handleCustomIdle}
                  className="input input--small"
                />
                <span>min</span>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card__title">Applications</div>
            <p className="settings-card__description">
              Toggle tracking for individual apps. Tracked apps appear in your gallery.
            </p>
            <div className="filter-list-header">
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
            </div>
            <div className="filter-list">
              {displayedApps.map((app) => (
                <AppFilterRow key={app.id} app={app} />
              ))}
              {displayedApps.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 'var(--text-sm)' }}>
                  No apps found. Use your computer — they'll appear here automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Groups Tab */}
      {tab === 'groups' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">Group Management</div>
            <GroupEditor />
          </div>
        </div>
      )}

      {/* Data Tab */}
      {tab === 'data' && (
        <div className="settings-section">
          <ImportExport />
        </div>
      )}

      {/* Artwork Tab */}
      {tab === 'artwork' && (
        <div className="settings-section">
          <div className="settings-card">
            <div className="settings-card__title">SteamGridDB Integration</div>
            <p className="artwork-description">
              Connect to <b>SteamGridDB</b> to search and import community artwork for any game or app.
              It's free — just create an account and generate an API key.
            </p>
            <a
              href="https://www.steamgriddb.com/profile/preferences/api"
              target="_blank"
              rel="noreferrer"
              className="artwork-api-link"
            >
              <ExternalLink size={13} /> Get your free API key
            </a>
            <div className="artwork-input-row">
              <input
                className="input"
                type="password"
                placeholder={storedSgdbKey ? '••••••••••••••••' : 'Paste your API key here'}
                value={sgdbKey}
                onChange={(e) => { setSgdbKey(e.target.value); setSgdbKeySaved(false) }}
              />
              <button
                className="btn btn--primary"
                onClick={saveSgdbKey}
                disabled={sgdbKey.trim() === ''}
              >
                Save
              </button>
            </div>
            <p className="artwork-help">
              Note: fetching artwork for your entire library may take a moment — requests are spaced out to avoid overloading the API.
            </p>
            {sgdbKeySaved && (
              <p className="artwork-saved">API key saved.</p>
            )}
            {sgdbKeyError && (
              <p className="artwork-error">{sgdbKeyError}</p>
            )}
            {storedSgdbKey && !sgdbKeySaved && !sgdbKeyError && (
              <p className="artwork-existing">A key is already configured. Paste a new one above to replace it.</p>
            )}
          </div>
        </div>
      )}

      {/* About Tab */}
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
