import { useRef, useState } from 'react'
import { Upload, Link, X, Loader, Globe } from 'lucide-react'
import { api } from '../../api/bridge'

interface Props {
  id: number
  isGroup?: boolean
  currentSrc: string | null
  onUpdated: (url: string | null) => void
  onSearchOnline?: () => void
}

export default function ImageUploader({ id, isGroup, currentSrc, onUpdated, onSearchOnline }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [urlMode, setUrlMode] = useState(false)
  const [urlValue, setUrlValue] = useState('')
  const [fetching, setFetching] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = reader.result as string
      const url = await api.setCustomIcon(id, base64, isGroup)
      onUpdated(url)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  async function handleFetchUrl(): Promise<void> {
    const trimmed = urlValue.trim()
    if (!trimmed) return
    if (!/^https?:\/\//i.test(trimmed)) {
      setUrlError('URL must start with http:// or https://')
      return
    }
    setFetching(true)
    setUrlError(null)
    try {
      const result = await api.fetchIconFromUrl(id, trimmed, isGroup)
      if (result) {
        onUpdated(result)
        setUrlMode(false)
        setUrlValue('')
      } else {
        setUrlError('Could not fetch image — check the URL and try again.')
      }
    } catch {
      setUrlError('Failed to fetch image.')
    } finally {
      setFetching(false)
    }
  }

  async function handleClear(): Promise<void> {
    await api.clearCustomIcon(id, isGroup)
    onUpdated(null)
  }

  return (
    <div className="editor-image-section">
      {/* Preview */}
      <div
        className="editor-image-preview"
        onClick={() => !urlMode && inputRef.current?.click()}
        title={urlMode ? undefined : 'Click to upload image'}
      >
        {currentSrc
          ? <img src={currentSrc} alt="App icon" />
          : <Upload size={24} color="var(--color-text-dim)" />
        }
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Actions */}
      <div className="editor-image-actions">
        {!urlMode ? (
          <>
            <button className="btn btn--ghost" onClick={() => inputRef.current?.click()}>
              <Upload size={14} /> Upload file
            </button>
            <button className="btn btn--ghost" onClick={() => { setUrlMode(true); setUrlError(null) }}>
              <Link size={14} /> Paste image URL
            </button>
            {onSearchOnline && (
              <button className="btn btn--ghost" onClick={onSearchOnline}>
                <Globe size={14} /> Search online
              </button>
            )}
            {currentSrc && (
              <button className="btn btn--ghost" onClick={handleClear}>
                <X size={14} /> Reset to EXE icon
              </button>
            )}
          </>
        ) : (
          <div className="url-fetch">
            <input
              className="input url-fetch__input"
              placeholder="https://example.com/image.png"
              value={urlValue}
              onChange={(e) => { setUrlValue(e.target.value); setUrlError(null) }}
              onKeyDown={(e) => e.key === 'Enter' && handleFetchUrl()}
              autoFocus
              disabled={fetching}
            />
            {urlError && <span className="url-fetch__error">{urlError}</span>}
            <div className="url-fetch__btns">
              <button
                className="btn btn--primary"
                onClick={handleFetchUrl}
                disabled={fetching || !urlValue.trim()}
              >
                {fetching ? <><Loader size={13} className="spin" /> Fetching…</> : 'Fetch'}
              </button>
              <button className="btn btn--ghost" onClick={() => { setUrlMode(false); setUrlValue(''); setUrlError(null) }} disabled={fetching}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
