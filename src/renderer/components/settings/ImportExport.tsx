import { useState } from 'react'
import { Download, Upload, Trash2, Gamepad2, ChevronDown, ChevronUp, Table } from 'lucide-react'
import { api } from '../../api/bridge'
import type { ImportResult, SteamImportResult } from '@shared/types'
import { useSessionStore } from '../../store/sessionStore'
import { useAppStore } from '../../store/appStore'

export default function ImportExport(): JSX.Element {
  const [exporting, setExporting] = useState(false)
  const [exportingCsv, setExportingCsv] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)

  // Steam import state
  const [steamOpen, setSteamOpen] = useState(false)
  const [steamApiKey, setSteamApiKey] = useState('')
  const [steamId, setSteamId] = useState('')
  const [steamImporting, setSteamImporting] = useState(false)
  const [steamResult, setSteamResult] = useState<SteamImportResult | null>(null)

  const loadRange = useSessionStore((s) => s.loadRange)
  const loadAll = useAppStore((s) => s.loadAll)

  async function handleExport(): Promise<void> {
    setExporting(true)
    const result = await api.exportData()
    setExporting(false)
    if (result.success && result.filePath) {
      setExportPath(result.filePath)
    }
  }

  async function handleExportCsv(): Promise<void> {
    setExportingCsv(true)
    const result = await api.exportDataCsv()
    setExportingCsv(false)
    if (result.success && result.filePath) {
      setExportPath(result.filePath)
    }
  }

  async function handleImport(): Promise<void> {
    setImporting(true)
    const result = await api.importData()
    setImporting(false)
    setImportResult(result)
    loadRange()
  }

  async function handleClearAll(): Promise<void> {
    if (!window.confirm('This will permanently delete all tracked session data. Are you sure?')) return
    setClearing(true)
    await api.clearAllSessions()
    setClearing(false)
    loadRange()
    setImportResult(null)
    setSteamResult(null)
  }

  async function handleSteamImport(): Promise<void> {
    if (!steamApiKey.trim() || !steamId.trim()) return
    setSteamImporting(true)
    setSteamResult(null)
    const result = await api.importSteamData(steamApiKey.trim(), steamId.trim())
    setSteamImporting(false)
    setSteamResult(result)
    if (result.gamesImported > 0 || result.sessionsAdded > 0) {
      await loadAll()
      loadRange()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="data-actions">
        <button className="btn btn--ghost" onClick={handleExport} disabled={exporting}>
          <Download size={14} />
          {exporting ? 'Exporting...' : 'Export JSON'}
        </button>
        <button className="btn btn--ghost" onClick={handleExportCsv} disabled={exportingCsv}>
          <Table size={14} />
          {exportingCsv ? 'Exporting...' : 'Export CSV'}
        </button>
        <button className="btn btn--ghost" onClick={handleImport} disabled={importing}>
          <Upload size={14} />
          {importing ? 'Importing...' : 'Import data'}
        </button>
      </div>

      {exportPath && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)' }}>
          Exported to: {exportPath}
        </div>
      )}

      {importResult && (
        <div className="import-result">
          <div className="import-result__stat"><span>Apps added</span><span>{importResult.appsAdded}</span></div>
          <div className="import-result__stat"><span>Apps updated</span><span>{importResult.appsUpdated}</span></div>
          <div className="import-result__stat"><span>Sessions imported</span><span>{importResult.sessionsAdded}</span></div>
          <div className="import-result__stat"><span>Duplicates skipped</span><span>{importResult.duplicates}</span></div>
          {importResult.errors.length > 0 && (
            <div style={{ marginTop: 8, color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>
              {importResult.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}
        </div>
      )}

      {/* ── Steam Historical Import ────────────────────────────────────────── */}
      <div style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden'
      }}>
        <button
          onClick={() => setSteamOpen((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            width: '100%', padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-surface-2)', border: 'none', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text)',
            textAlign: 'left'
          }}
        >
          <Gamepad2 size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Import from Steam</span>
          {steamOpen ? <ChevronUp size={14} style={{ color: 'var(--color-text-dim)' }} /> : <ChevronDown size={14} style={{ color: 'var(--color-text-dim)' }} />}
        </button>

        {steamOpen && (
          <div style={{
            padding: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            display: 'flex', flexDirection: 'column', gap: 'var(--space-3)'
          }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
              Imports your Steam library as a one-time historical snapshot. Each game gets a single
              session representing its total playtime. Future play sessions will be tracked separately.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                Steam API Key
              </label>
              <input
                className="input"
                type="password"
                placeholder="XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                value={steamApiKey}
                onChange={(e) => setSteamApiKey(e.target.value)}
                autoComplete="off"
              />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-dim)' }}>
                Get yours at steamcommunity.com/dev/apikey
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>
                Steam ID (64-bit)
              </label>
              <input
                className="input"
                placeholder="76561198XXXXXXXXX"
                value={steamId}
                onChange={(e) => setSteamId(e.target.value)}
                autoComplete="off"
              />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-dim)' }}>
                Find yours at store.steampowered.com/account (shown as "Steam ID")
              </span>
            </div>

            <button
              className="btn btn--ghost"
              onClick={handleSteamImport}
              disabled={steamImporting || !steamApiKey.trim() || !steamId.trim()}
              style={{ alignSelf: 'flex-start' }}
            >
              <Gamepad2 size={14} />
              {steamImporting ? 'Importing...' : 'Import Steam library'}
            </button>

            {steamResult && (
              <div className="import-result" style={{ marginTop: 0 }}>
                <div className="import-result__stat"><span>Games added</span><span>{steamResult.gamesImported}</span></div>
                <div className="import-result__stat"><span>Sessions added</span><span>{steamResult.sessionsAdded}</span></div>
                <div className="import-result__stat"><span>Already imported</span><span>{steamResult.duplicates}</span></div>
                {steamResult.errors.length > 0 && (
                  <div style={{ marginTop: 8, color: 'var(--color-warning)', fontSize: 'var(--text-xs)' }}>
                    {steamResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="settings-card danger-zone" style={{ marginTop: 8 }}>
        <div className="settings-card__title">Danger Zone</div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
          This permanently deletes all session data. App list and settings are kept.
        </p>
        <button className="btn btn--danger" onClick={handleClearAll} disabled={clearing}>
          <Trash2 size={14} />
          {clearing ? 'Clearing...' : 'Clear all sessions'}
        </button>
      </div>
    </div>
  )
}
