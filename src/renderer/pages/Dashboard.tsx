import { useState, useEffect, useRef } from 'react'
import { Zap, X, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import '../styles/dashboard.css'
import { useSessionStore } from '../store/sessionStore'
import { useAppStore } from '../store/appStore'
import HeroAppCard from '../components/dashboard/HeroAppCard'
import Heatmap from '../components/dashboard/Heatmap'
import TopAppsLeaderboard, { type GridPeriod } from '../components/dashboard/TopAppsLeaderboard'
import type { DateRangePreset } from '@shared/types'

function gridPeriodToPreset(period: GridPeriod): DateRangePreset {
  return period === 'week' ? 'week' : period === 'month' ? 'month' : 'all'
}

export default function Dashboard(): JSX.Element {
  const lastTickAt = useSessionStore((s) => s.lastTickAt)
  const summary = useSessionStore((s) => s.summary)
  const loading = useSessionStore((s) => s.loading)
  const preset = useSessionStore((s) => s.preset)
  const setPreset = useSessionStore((s) => s.setPreset)
  const setCustomRange = useSessionStore((s) => s.setCustomRange)
  const apps = useAppStore((s) => s.apps)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const navigate = useNavigate()

  const hasAutoSwitched = useRef(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const showOnboarding = lastTickAt === null && !bannerDismissed
  const steamPromptDismissed = settings['steam_prompt_dismissed'] === 'true' || settings['steam_prompt_dismissed'] === true
  const showSteamPrompt = apps.length > 10 && !steamPromptDismissed && lastTickAt !== null

  const period: GridPeriod = preset === 'all' ? 'all' : preset === 'month' ? 'month' : 'week'

  useEffect(() => {
    if (!lastTickAt || hasAutoSwitched.current) return
    hasAutoSwitched.current = true
    if (preset === 'today') {
      const timer = setTimeout(() => setPreset('week'), 100)
      return () => clearTimeout(timer)
    }
  }, [lastTickAt])

  function handleHeatmapDayClick(dateStr: string): void {
    const from = new Date(dateStr + 'T00:00:00').getTime()
    const to = from + 86_400_000 - 1
    setCustomRange(from, to)
  }

  function handlePeriodChange(newPeriod: GridPeriod): void {
    setPreset(gridPeriodToPreset(newPeriod))
  }

  return (
    <main className="page-content">
      {showOnboarding && (
        <div className="onboarding-banner">
          <Zap size={16} className="onboarding-banner__icon" />
          <div className="onboarding-banner__text">
            <strong>Faultier Tracker is running.</strong>
            {' '}Apps will appear here automatically as you use your computer — typically within 5 seconds.
          </div>
          <button className="onboarding-banner__close" onClick={() => setBannerDismissed(true)} title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {showSteamPrompt && (
        <div className="onboarding-banner onboarding-banner--steam">
          <ExternalLink size={16} className="onboarding-banner__icon" />
          <div className="onboarding-banner__text">
            <strong>Using Steam?</strong>
            {' '}Import your game library for better artwork and grouping.{' '}
            <button
              className="onboarding-banner__link"
              onClick={() => navigate('/settings')}
            >
              Go to Settings → Data
            </button>
          </div>
          <button
            className="onboarding-banner__close"
            onClick={() => setSetting('steam_prompt_dismissed', true)}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <HeroAppCard summary={summary} loading={loading} period={period} />
      <Heatmap onDayClick={handleHeatmapDayClick} />
      <TopAppsLeaderboard
        summaries={summary?.apps ?? []}
        period={period}
        onPeriodChange={handlePeriodChange}
        loading={loading}
      />
    </main>
  )
}
