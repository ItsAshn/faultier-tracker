import { useEffect, useState } from 'react'
import { Zap, X, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import '../styles/dashboard.css'
import { useSessionStore } from '../store/sessionStore'
import { useAppStore } from '../store/appStore'
import { api } from '../api/bridge'
import HeroAppCard from '../components/dashboard/HeroAppCard'
import Heatmap from '../components/dashboard/Heatmap'
import AppGrid, { type GridPeriod } from '../components/dashboard/AppGrid'
import type { RangeSummary } from '@shared/types'

function getWeekRange(): { from: number; to: number } {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sun
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysFromMonday)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { from: monday.getTime(), to: sunday.getTime() }
}

function getPeriodRange(period: GridPeriod): { from: number; to: number } {
  const now = new Date()
  if (period === 'week') return getWeekRange()
  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    return { from, to: now.getTime() }
  }
  return { from: 0, to: now.getTime() }
}

export default function Dashboard(): JSX.Element {
  const lastTickAt = useSessionStore((s) => s.lastTickAt)
  const setCustomRange = useSessionStore((s) => s.setCustomRange)
  const setPreset = useSessionStore((s) => s.setPreset)
  const apps = useAppStore((s) => s.apps)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const navigate = useNavigate()

  const [bannerDismissed, setBannerDismissed] = useState(false)
  const showOnboarding = lastTickAt === null && !bannerDismissed
  const steamPromptDismissed = settings['steam_prompt_dismissed'] === 'true' || settings['steam_prompt_dismissed'] === true
  const showSteamPrompt = apps.length > 10 && !steamPromptDismissed && lastTickAt !== null

  // Hero: always this week
  const [heroSummary, setHeroSummary] = useState<RangeSummary | null>(null)
  const [heroLoading, setHeroLoading] = useState(true)

  // App grid: user-selectable period
  const [gridPeriod, setGridPeriod] = useState<GridPeriod>('week')
  const [gridSummary, setGridSummary] = useState<RangeSummary | null>(null)
  const [gridLoading, setGridLoading] = useState(true)

  useEffect(() => {
    setHeroLoading(true)
    const { from, to } = getWeekRange()
    api.getSessionRange(from, to, 'day').then((s) => {
      setHeroSummary(s)
      setHeroLoading(false)
    })
  }, [])

  useEffect(() => {
    setGridLoading(true)
    const { from, to } = getPeriodRange(gridPeriod)
    api.getSessionRange(from, to, 'day').then((s) => {
      setGridSummary(s)
      setGridLoading(false)
    })
  }, [gridPeriod])

  function handleHeatmapDayClick(dateStr: string): void {
    const from = new Date(dateStr + 'T00:00:00').getTime()
    const to = from + 86_400_000 - 1
    setCustomRange(from, to)
    setPreset('custom')
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

      <HeroAppCard summary={heroSummary} loading={heroLoading} />
      <Heatmap onDayClick={handleHeatmapDayClick} />
      <AppGrid
        summaries={gridSummary?.apps ?? []}
        allApps={apps}
        period={gridPeriod}
        onPeriodChange={setGridPeriod}
        loading={gridLoading}
      />
    </main>
  )
}
