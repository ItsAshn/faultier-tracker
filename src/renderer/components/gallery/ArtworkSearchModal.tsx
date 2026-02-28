import { useState } from 'react'
import { X, Search, Loader } from 'lucide-react'
import { api } from '../../api/bridge'
import type { ArtworkResult } from '@shared/types'

type ArtType = 'grids' | 'heroes' | 'logos' | 'icons'

interface Props {
  appId: number
  displayName: string
  isGroup: boolean
  onClose: () => void
  onApply: (dataUrl: string) => void
}

const ART_TYPES: { key: ArtType; label: string }[] = [
  { key: 'grids',  label: 'Grids'  },
  { key: 'heroes', label: 'Heroes' },
  { key: 'logos',  label: 'Logos'  },
  { key: 'icons',  label: 'Icons'  },
]

export default function ArtworkSearchModal({
  appId, displayName, isGroup, onClose, onApply,
}: Props): JSX.Element {
  const [query, setQuery] = useState(displayName)
  const [artType, setArtType] = useState<ArtType>('grids')
  const [results, setResults] = useState<ArtworkResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState<number | null>(null)

  async function handleSearch(): Promise<void> {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setResults([])
    try {
      const res = await api.searchArtwork(q, artType)
      if (res.error === 'no_key') {
        setError('No API key configured. Go to Settings → Artwork to add your SteamGridDB key.')
      } else if (res.error) {
        setError(res.error)
      } else if (res.results.length === 0) {
        setError('No artwork found for this search.')
      } else {
        setResults(res.results)
      }
    } catch {
      setError('Search failed. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handlePick(result: ArtworkResult): Promise<void> {
    setApplying(result.id)
    try {
      const dataUrl = await api.fetchIconFromUrl(appId, result.url, isGroup)
      if (dataUrl) {
        onApply(dataUrl)
        onClose()
      } else {
        setError('Could not download that image. Try another.')
      }
    } catch {
      setError('Download failed.')
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ width: 780, maxWidth: '95vw' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">Search Artwork</h2>
          <button className="btn--icon" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Search bar */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Game or app name..."
            style={{ flex: 1 }}
            autoFocus
          />
          <button
            className="btn btn--primary"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? <Loader size={14} className="spin" /> : <Search size={14} />}
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* Art type selector */}
        <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <div className="mode-toggle" style={{ width: '100%', justifyContent: 'flex-start' }}>
            {ART_TYPES.map(({ key, label }) => (
              <button
                key={key}
                className={`mode-toggle__btn${artType === key ? ' mode-toggle__btn--active' : ''}`}
                onClick={() => setArtType(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger, #e05c5c)', marginBottom: 'var(--space-3)' }}>
            {error}
          </p>
        )}

        {/* Results grid */}
        {results.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 'var(--space-3)',
              maxHeight: 420,
              overflowY: 'auto',
              paddingRight: 4,
            }}
          >
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => handlePick(r)}
                disabled={applying !== null}
                style={{
                  position: 'relative',
                  background: 'var(--color-surface-2)',
                  border: '2px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  cursor: applying !== null ? 'wait' : 'pointer',
                  padding: 0,
                  aspectRatio: artType === 'grids' ? '2/3' : artType === 'heroes' ? '92/31' : '1',
                  transition: 'border-color 120ms ease, transform 120ms ease',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-accent)'
                  ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.03)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)'
                  ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
                }}
              >
                <img
                  src={r.thumb}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {applying === r.id && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Loader size={20} className="spin" color="#fff" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Empty state before search */}
        {!loading && results.length === 0 && !error && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-dim)', textAlign: 'center', padding: 'var(--space-8) 0' }}>
            Enter a name and press Search to find artwork from SteamGridDB.
          </p>
        )}

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
