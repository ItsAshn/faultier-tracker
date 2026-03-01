import { useEffect, useState } from 'react'
import { Activity, Clock, Trophy, Zap, X, BarChart2, CalendarDays, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import '../styles/dashboard.css'
import { useSessionStore } from '../store/sessionStore'
import { useAppStore } from '../store/appStore'
import { api } from '../api/bridge'
import DateRangePicker from '../components/dashboard/DateRangePicker'
import SummaryCard from '../components/dashboard/SummaryCard'
import TimeBarChart from '../components/dashboard/TimeBarChart'
import Heatmap from '../components/dashboard/Heatmap'
import { GroupTimeRow, UngroupedTimeRow } from '../components/dashboard/AppTimeRow'

function fmtMs(ms: number): string {
  if (ms < 60_000) return '0m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function Dashboard(): JSX.Element {
  const summary = useSessionStore((s) => s.summary)
  const loadRange = useSessionStore((s) => s.loadRange)
  const setPreset = useSessionStore((s) => s.setPreset)
  const setCustomRange = useSessionStore((s) => s.setCustomRange)
  const lastTickAt = useSessionStore((s) => s.lastTickAt)
  const apps = useAppStore((s) => s.apps)
  const groups = useAppStore((s) => s.groups)
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const navigate = useNavigate()

  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const showOnboarding = lastTickAt === null && !bannerDismissed

  // Steam prompt: show when >10 apps tracked and not dismissed
  const steamPromptDismissed = settings['steam_prompt_dismissed'] === 'true' || settings['steam_prompt_dismissed'] === true
  const showSteamPrompt = apps.length > 10 && !steamPromptDismissed && lastTickAt !== null

  // Reload data every 30 seconds to update running totals
  useEffect(() => {
    const timer = setInterval(() => loadRange(), 30_000)
    return () => clearInterval(timer)
  }, [])

  const topAppId = summary?.top_app?.app_id ?? null
  const [topAppIcon, setTopAppIcon] = useState<string | null>(null)

  useEffect(() => {
    if (topAppId === null) { setTopAppIcon(null); return }
    api.getIconForApp(topAppId).then(setTopAppIcon)
  }, [topAppId])

  const appSummaries = summary?.apps ?? []
  const chartData = summary?.chart_points ?? []

  // Group summaries by group_id
  const grouped = new Map<number, { summaries: typeof appSummaries }>()
  const ungrouped: typeof appSummaries = []

  for (const s of appSummaries) {
    if (s.group_id !== null) {
      if (!grouped.has(s.group_id)) grouped.set(s.group_id, { summaries: [] })
      grouped.get(s.group_id)!.summaries.push(s)
    } else {
      ungrouped.push(s)
    }
  }

  function handleHeatmapDayClick(dateStr: string): void {
    const from = new Date(dateStr + 'T00:00:00').getTime()
    const to = from + 86_400_000 - 1
    setCustomRange(from, to)
    setPreset('custom')
    setShowHeatmap(false)
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

      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <button
            className={`btn btn--ghost btn--icon-text${showHeatmap ? ' btn--active' : ''}`}
            onClick={() => setShowHeatmap((v) => !v)}
            title="Toggle heatmap"
          >
            {showHeatmap ? <BarChart2 size={14} /> : <CalendarDays size={14} />}
            {showHeatmap ? 'Chart' : 'Heatmap'}
          </button>
          <DateRangePicker />
        </div>
      </div>

      <div className="summary-cards">
        <SummaryCard
          label="Active Time"
          value={fmtMs(summary?.total_active_ms ?? 0)}
          sub="Focused on screen"
          icon={<Activity size={16} />}
        />
        <SummaryCard
          label="Running Time"
          value={fmtMs(summary?.total_running_ms ?? 0)}
          sub="Apps open"
          icon={<Clock size={16} />}
        />
        <SummaryCard
          label="Top App"
          value={summary?.top_app ? fmtMs(summary.top_app.active_ms) : '—'}
          sub={summary?.top_app?.display_name}
          icon={
            topAppIcon
              ? <img src={topAppIcon} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'var(--radius-sm)' }} />
              : <Trophy size={16} />
          }
        />
      </div>

      {showHeatmap
        ? <Heatmap onDayClick={handleHeatmapDayClick} />
        : <TimeBarChart data={chartData} appSummaries={appSummaries} />
      }

      <div className="time-table">
        <div className="time-table__head">
          <span>Application</span>
          <span>Active</span>
          <span>Running</span>
          <span>Track</span>
        </div>
        <div className="time-table__body">
          {appSummaries.length === 0 ? (
            <div className="time-table__empty">
              <Clock size={32} />
              <span>{lastTickAt === null ? 'Waiting for first data — use your apps and they\'ll appear here' : 'No activity recorded for this period'}</span>
            </div>
          ) : (
            <>
              {Array.from(grouped.entries()).map(([groupId, { summaries }]) => {
                const group = groups.find((g) => g.id === groupId)
                if (!group) return null
                return (
                  <GroupTimeRow
                    key={groupId}
                    group={group}
                    summaries={summaries}
                    apps={apps}
                  />
                )
              })}
              {ungrouped.map((s) => {
                const app = apps.find((a) => a.id === s.app_id)
                if (!app) return null
                return <UngroupedTimeRow key={s.app_id} summary={s} app={app} />
              })}
            </>
          )}
        </div>
      </div>
    </main>
  )
}
