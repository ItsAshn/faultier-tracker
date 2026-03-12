import { useState } from 'react'
import { ArrowRight, Check, Gamepad2, Image, ExternalLink } from 'lucide-react'
import { api } from '../../api/bridge'
import { useAppStore } from '../../store/appStore'

interface Props {
  onComplete: () => void
}

type Step = 'welcome' | 'steam' | 'artwork' | 'complete'

export default function SetupWalkthrough({ onComplete }: Props): JSX.Element {
  const [step, setStep] = useState<Step>('welcome')
  const [steamApiKey, setSteamApiKey] = useState('')
  const [steamId, setSteamId] = useState('')
  const [steamGridKey, setSteamGridKey] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ games: number; sessions: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const setSetting = useAppStore((s) => s.setSetting)

  async function handleSteamImport() {
    setError(null)
    // Save any entered values even if import isn't performed
    try {
      if (steamApiKey) {
        await setSetting('steam_api_key', steamApiKey)
      }
      if (steamId) {
        await setSetting('steam_id', steamId)
      }
    } catch (err) {
      setError('Failed to save Steam credentials. Please try again.')
      return
    }
    
    // Only attempt import if both values are provided
    if (!steamApiKey || !steamId) {
      setStep('artwork')
      return
    }

    setImporting(true)
    try {
      const result = await api.importSteamData(steamApiKey, steamId)
      setImportResult({
        games: result.gamesImported,
        sessions: result.sessionsAdded
      })
    } catch (err) {
      console.error('Steam import failed:', err)
      setError('Steam import failed. You can skip this step and try again later in settings.')
    } finally {
      setImporting(false)
    }
  }

  async function handleArtworkSave() {
    setError(null)
    try {
      // Save SteamGridDB key if provided
      if (steamGridKey) {
        await setSetting('steamgriddb_api_key', steamGridKey)
      }
      await setSetting('first_run_completed', true)
      onComplete()
    } catch (err) {
      setError('Failed to save settings. Please try again.')
    }
  }

  async function skipToComplete() {
    setError(null)
    try {
      // Save any entered API keys before skipping
      if (steamApiKey) {
        await setSetting('steam_api_key', steamApiKey)
      }
      if (steamId) {
        await setSetting('steam_id', steamId)
      }
      if (steamGridKey) {
        await setSetting('steamgriddb_api_key', steamGridKey)
      }
      await setSetting('first_run_completed', true)
      onComplete()
    } catch (err) {
      setError('Failed to save settings. Please try again.')
    }
  }

  return (
    <div className="setup-walkthrough">
      <div className="setup-walkthrough__container">
        {/* Progress indicator */}
        <div className="setup-progress">
          {['welcome', 'steam', 'artwork', 'complete'].map((s, i) => (
            <div
              key={s}
              className={`setup-progress__step${step === s ? ' setup-progress__step--active' : ''}${
                ['welcome', 'steam', 'artwork', 'complete'].indexOf(step) > i ? ' setup-progress__step--completed' : ''
              }`}
            >
              {['welcome', 'steam', 'artwork', 'complete'].indexOf(step) > i ? (
                <Check size={14} />
              ) : (
                i + 1
              )}
            </div>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div style={{ 
            background: 'rgba(239, 68, 68, 0.1)', 
            border: '1px solid #ef4444', 
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            marginBottom: 'var(--space-4)',
            color: '#ef4444',
            fontSize: 'var(--text-sm)'
          }}>
            {error}
          </div>
        )}

        {/* Step 1: Welcome */}
        {step === 'welcome' && (
          <div className="setup-step">
            <div className="setup-step__icon">
              <Gamepad2 size={48} />
            </div>
            <h1 className="setup-step__title">Welcome to Faultier Tracker</h1>
            <p className="setup-step__description">
              Track your focused time across all apps and games. Perfect for tracking
              games and programs not covered by Steam's time tracking.
            </p>
            <div className="setup-step__features">
              <div className="setup-feature">
                <Check size={16} />
                <span>Automatic focused-time tracking</span>
              </div>
              <div className="setup-feature">
                <Check size={16} />
                <span>Visual activity history</span>
              </div>
              <div className="setup-feature">
                <Check size={16} />
                <span>Steam library import</span>
              </div>
            </div>
            <div className="setup-step__actions">
              <button
                className="btn btn--primary btn--lg"
                onClick={() => setStep('steam')}
              >
                Get Started <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Steam Import */}
        {step === 'steam' && (
          <div className="setup-step">
            <div className="setup-step__icon">
              <Gamepad2 size={48} />
            </div>
            <h1 className="setup-step__title">Import Steam Library</h1>
            <p className="setup-step__description">
              Import your Steam playtime history. This is optional but recommended
              for a complete picture of your gaming time.
            </p>

            {importResult && (
              <div className="setup-result">
                <Check size={24} className="setup-result__icon" />
                <p>
                  Successfully imported {importResult.games} games with{' '}
                  {importResult.sessions} sessions!
                </p>
                <button
                  className="btn btn--primary"
                  onClick={() => setStep('artwork')}
                >
                  Continue
                </button>
              </div>
            )}

            {!importResult && (
              <>
                <div className="setup-form">
                  <div className="field">
                    <label className="field__label">Steam API Key</label>
                    <input
                      type="text"
                      className="input"
                      value={steamApiKey}
                      onChange={(e) => setSteamApiKey(e.target.value)}
                      placeholder="Paste your Steam API key"
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
                      placeholder="Your Steam ID (e.g., 76561198...)"
                    />
                  </div>
                </div>

                <div className="setup-step__actions">
                  <button
                    className="btn btn--ghost"
                    onClick={() => setStep('artwork')}
                  >
                    Skip
                  </button>
                  <button
                    className="btn btn--primary"
                    onClick={handleSteamImport}
                    disabled={importing}
                  >
                    {importing ? 'Importing...' : (steamApiKey && steamId ? 'Import Steam Data' : 'Continue')}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: SteamGridDB */}
        {step === 'artwork' && (
          <div className="setup-step">
            <div className="setup-step__icon">
              <Image size={48} />
            </div>
            <h1 className="setup-step__title">Add Game Artwork</h1>
            <p className="setup-step__description">
              Connect to SteamGridDB to automatically fetch beautiful artwork
              for your games. This is optional but makes your library look great!
            </p>

            <div className="setup-form">
              <div className="field">
                <label className="field__label">SteamGridDB API Key (optional)</label>
                <input
                  type="password"
                  className="input"
                  value={steamGridKey}
                  onChange={(e) => setSteamGridKey(e.target.value)}
                  placeholder="Paste your SteamGridDB API key"
                />
                <a
                  href="https://www.steamgriddb.com/profile/preferences/api"
                  target="_blank"
                  rel="noreferrer"
                  className="field__help-link"
                >
                  <ExternalLink size={12} /> Get your free API key
                </a>
                <p className="field__hint">
                  Note: fetching artwork for your entire library may take a moment — requests are spaced out to avoid overloading the API.
                </p>
              </div>
            </div>

            <div className="setup-step__actions">
              <button
                className="btn btn--ghost"
                onClick={skipToComplete}
              >
                Skip
              </button>
              <button
                className="btn btn--primary"
                onClick={handleArtworkSave}
              >
                Finish Setup
              </button>
            </div>
          </div>
        )}

        {/* Skip option always visible */}
        {step !== 'complete' && (
          <button
            className="setup-skip"
            onClick={skipToComplete}
          >
            Skip Setup
          </button>
        )}
      </div>
    </div>
  )
}
