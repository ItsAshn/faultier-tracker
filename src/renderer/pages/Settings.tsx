import { useState } from 'react'
import { Search, ExternalLink, Download, Upload } from 'lucide-react'
import '../styles/settings.css'
import { useAppStore } from '../store/appStore'
import AppFilterRow from '../components/settings/AppFilterRow'
import GroupEditor from '../components/settings/GroupEditor'

// Add import/export API
import { api } from '../api/bridge'

type Tab = 'general' | 'apps' | 'data'

const IDLE_OPTIONS = [
  { label: '5 min', value: 300000 },
  { label: '10 min', value: 600000 },
  { label: '15 min', value: 900000 },
]

export default function Settings(): JSX.Element {
  const [tab, setTab] = useState<Tab>('general')
  const [filterSearch, setFilterSearch] = useState('')
  const [customIdleMinutes, setCustomIdleMinutes] = useState<string>('')
  const [steamApiKey, setSteamApiKey] = useState('')
  const [steamId, setSteamId] = useState('')
  const [gridDbKey, setGridDbKey] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importStatus, setImportStatus] = useState<string | null>(null)

  const apps = useAppStore((s) => s.apps)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)

  const pollInterval = Number(settings['poll_interval_ms'] ?? 5000)
  const idleThreshold = Number(settings['idle_threshold_ms'] ?? 300000)
  const launchAtStartup = settings['launch_at_startup'] === true || settings['launch_at_startup'] === 'true'
  const steamApiKeyStored = (settings['steam_api_key'] as string) ?? ''
  const steamIdStored = (settings['steam_id'] as string) ?? ''
  const gridDbKeyStored = (settings['steamgriddb_api_key'] as string) ?? ''

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

  async function handleSteamImport() {
    if (!steamApiKey || !steamId) return
    setIsImporting(true)
    setImportStatus('Importing...')
    try {
      const result = await api.importSteamData(steamApiKey, steamId)
      await setSetting('steam_api_key', steamApiKey)
      await setSetting('steam_id', steamId)
      setImportStatus(`Imported ${result.gamesImported} games, ${result.sessionsAdded} sessions`)
    } catch (err) {
      setImportStatus('Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  async function handleExport() {
    try {
      const result = await api.exportData()
      if (result.success) {
        setImportStatus(`Exported to ${result.filePath}`)
      } else {
        setImportStatus('Export failed')
      }
    } catch {
      setImportStatus('Export failed')
    }
  }

  async function handleSaveGridDbKey() {
    if (gridDbKey) {
      await setSetting('steamgriddb_api_key', gridDbKey)
      setImportStatus('SteamGridDB key saved')
    }
  }

  const currentIdleMinutes = Math.round(idleThreshold / 60000)
  const isCustomIdle = !IDLE_OPTIONS.some(opt => opt.value === idleThreshold)

  return (
    <main className="page-content">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="settings-tabs">
        {[
          ['general', 'General'],
          ['apps', 'Apps'],
          ['data', 'Data & Steam']
        ].map(([key, label]) => (
          <button
            key={key}
            className={`settings-tab${tab === key ? ' settings-tab--active' : ''}`}
            onClick={() => setTab(key as Tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {tab === 'general' && (
        <div className="settings-section">
          {/* Launch at Startup */}
          <div className="settings-card">
            <div className="settings-card__title">Launch at Startup</div>
            <p className="settings-card__description">
              Automatically start Faultier Tracker when you log in to Windows.
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

          {/* Poll Interval */}
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

          {/* Idle Detection */}
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
        </div>
      )}

      {/* Apps Tab */}
      {tab === 'apps' && (
        <div className="settings-section">
          {/* Group Management */}
          <div className="settings-card">
            <div className="settings-card__title">Group Management</div>
            <GroupEditor />
          </div>

          {/* App List */}
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
              {apps
                .filter((app) => 
                  filterSearch === '' || 
                  app.display_name.toLowerCase().includes(filterSearch.toLowerCase()) ||
                  app.exe_name.toLowerCase().includes(filterSearch.toLowerCase())
                )
                .map((app) => (
                  <AppFilterRow key={app.id} app={app} />
                ))}
              {apps.length === 0 && (
                <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-dim)', fontSize: 'var(--text-sm)' }}>
                  No apps recorded yet. Use your computer — they'll appear here automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Data & Steam Tab */}
      {tab === 'data' && (
        <div className="settings-section">
          {/* Data Export/Import */}
          <div className="settings-card">
            <div className="settings-card__title">Data Backup</div>
            <p className="settings-card__description">
              Export your data for backup or import from a previous export.
            </p>
            <div className="data-actions">
              <button className="btn btn--secondary" onClick={handleExport}>
                <Download size={16} /> Export Data
              </button>
              <button className="btn btn--secondary" onClick={() => api.importData()}>
                <Upload size={16} /> Import Data
              </button>
            </div>
          </div>

          {/* Steam Import */}
          <div className="settings-card">
            <div className="settings-card__title">Steam Import</div>
            <p className="settings-card__description">
              Import your Steam library and playtime history. Steam games are not tracked by Faultier — Steam handles that.
            </p>
            <div className="steam-import-form">
              <div className="field">
                <label className="field__label">Steam API Key</label>
                <input
                  type="password"
                  className="input"
                  value={steamApiKey}
                  onChange={(e) => setSteamApiKey(e.target.value)}
                  placeholder={steamApiKeyStored ? '••••••••••••••••' : 'Paste your Steam API key'}
                />
                <a
                  href="https://steamcommunity.com/dev/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="field__help-link"
                >
                  <ExternalLink size={12} /> Get your API key
                </a>
              </div>
              <div className="field">
                <label className="field__label">Steam ID</label>
                <input
                  type="text"
                  className="input"
                  value={steamId}
                  onChange={(e) => setSteamId(e.target.value)}
                  placeholder={steamIdStored || 'Your Steam ID (e.g., 76561198...)'}
                />
              </div>
              <button
                className="btn btn--primary"
                onClick={handleSteamImport}
                disabled={isImporting || (!steamApiKey && !steamApiKeyStored) || (!steamId && !steamIdStored)}
              >
                {isImporting ? 'Importing...' : 'Import Steam Data'}
              </button>
            </div>
          </div>

          {/* SteamGridDB */}
          <div className="settings-card">
            <div className="settings-card__title">SteamGridDB Artwork</div>
            <p className="settings-card__description">
              Get beautiful artwork for games automatically from SteamGridDB.
            </p>
            <div className="steam-import-form">
              <div className="field">
                <label className="field__label">API Key</label>
                <input
                  type="password"
                  className="input"
                  value={gridDbKey}
                  onChange={(e) => setGridDbKey(e.target.value)}
                  placeholder={gridDbKeyStored ? '••••••••••••••••' : 'Paste your SteamGridDB API key'}
                />
                <a
                  href="https://www.steamgriddb.com/profile/preferences/api"
                  target="_blank"
                  rel="noreferrer"
                  className="field__help-link"
                >
                  <ExternalLink size={12} /> Get your free API key
                </a>
              </div>
              <button
                className="btn btn--primary"
                onClick={handleSaveGridDbKey}
                disabled={!gridDbKey}
              >
                Save Key
              </button>
            </div>
          </div>

          {/* Status Messages */}
          {importStatus && (
            <div className="settings-status">{importStatus}</div>
          )}
        </div>
      )}
    </main>
  )
}
