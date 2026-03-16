import { useState, useCallback, useEffect, useRef } from 'react'
import { X, Link, ExternalLink } from 'lucide-react'
import type { SteamLinkSuggestion, AppRecord } from '@shared/types'
import { api } from '../../api/bridge'

interface SteamLinkBannerProps {
  suggestion: SteamLinkSuggestion
  onDismiss: (exeAppId: number) => void
  onMerged: () => void
}

function SteamLinkBanner({ suggestion, onDismiss, onMerged }: SteamLinkBannerProps): JSX.Element {
  const [selected, setSelected] = useState<AppRecord>(suggestion.candidates[0])
  const [merging, setMerging] = useState(false)
  // Auto-dismiss after 30 seconds
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss(suggestion.exeApp.id)
    }, 30_000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [suggestion.exeApp.id, onDismiss])

  const handleMerge = useCallback(async () => {
    setMerging(true)
    try {
      const result = await api.mergeSteamApp(suggestion.exeApp.id, selected.id)
      if (result.success) {
        onMerged()
      } else {
        console.error('[SteamLinkBanner] Merge failed:', result.error)
        onDismiss(suggestion.exeApp.id)
      }
    } catch (err) {
      console.error('[SteamLinkBanner] Merge error:', err)
      onDismiss(suggestion.exeApp.id)
    } finally {
      setMerging(false)
    }
  }, [suggestion.exeApp.id, selected.id, onMerged, onDismiss])

  const handleNotSteam = useCallback(() => {
    onDismiss(suggestion.exeApp.id)
  }, [suggestion.exeApp.id, onDismiss])

  return (
    <div className="steam-link-banner">
      <div className="steam-link-banner__icon">
        <Link size={16} />
      </div>
      <div className="steam-link-banner__body">
        <span className="steam-link-banner__label">
          <strong>{suggestion.exeApp.exe_name}</strong> looks like a Steam game. Link it to:
        </span>
        <div className="steam-link-banner__candidates">
          {suggestion.candidates.map((c) => (
            <button
              key={c.id}
              className={`steam-link-banner__candidate${selected.id === c.id ? ' steam-link-banner__candidate--selected' : ''}`}
              onClick={() => setSelected(c)}
              disabled={merging}
            >
              {c.display_name}
            </button>
          ))}
        </div>
      </div>
      <div className="steam-link-banner__actions">
        <button
          className="steam-link-banner__btn steam-link-banner__btn--confirm"
          onClick={handleMerge}
          disabled={merging}
        >
          <ExternalLink size={13} />
          {merging ? 'Linking…' : 'Link & merge'}
        </button>
        <button
          className="steam-link-banner__btn steam-link-banner__btn--dismiss"
          onClick={handleNotSteam}
          disabled={merging}
        >
          Not a Steam game
        </button>
      </div>
      <button
        className="steam-link-banner__close"
        onClick={handleNotSteam}
        disabled={merging}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

interface SteamLinkBannerContainerProps {
  onAnyMerged: () => void
}

export function SteamLinkBannerContainer({ onAnyMerged }: SteamLinkBannerContainerProps): JSX.Element | null {
  const [suggestions, setSuggestions] = useState<SteamLinkSuggestion[]>([])

  useEffect(() => {
    const unsub = api.onSteamLinkSuggested((suggestion) => {
      setSuggestions((prev) => {
        // Don't show the same exe twice
        const already = prev.some((s) => s.exeApp.id === suggestion.exeApp.id)
        if (already) return prev
        return [...prev, suggestion]
      })
    })
    return unsub
  }, [])

  const handleDismiss = useCallback((exeAppId: number) => {
    setSuggestions((prev) => prev.filter((s) => s.exeApp.id !== exeAppId))
    // Persist ignore flag via settings so we don't re-prompt next startup
    api.setSetting(`steam_link_ignored_${exeAppId}`, true).catch(console.error)
  }, [])

  const handleMerged = useCallback(
    (exeAppId: number) => {
      setSuggestions((prev) => prev.filter((s) => s.exeApp.id !== exeAppId))
      onAnyMerged()
    },
    [onAnyMerged],
  )

  if (suggestions.length === 0) return null

  return (
    <div className="steam-link-banners">
      {suggestions.map((s) => (
        <SteamLinkBanner
          key={s.exeApp.id}
          suggestion={s}
          onDismiss={handleDismiss}
          onMerged={() => handleMerged(s.exeApp.id)}
        />
      ))}
    </div>
  )
}
