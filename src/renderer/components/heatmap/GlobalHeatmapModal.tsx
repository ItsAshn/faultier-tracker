import { useState, useEffect, useCallback } from 'react'
import type { DayTotal, BucketApp } from '@shared/types'
import { api } from '../../api/bridge'
import { X, Calendar } from 'lucide-react'

interface Props {
  onClose: () => void
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return '<1m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function getISODateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildGrid(): string[][] {
  const today = new Date()
  const startSunday = new Date(today)
  startSunday.setDate(today.getDate() - today.getDay() - 51 * 7)
  startSunday.setHours(0, 0, 0, 0)

  const weeks: string[][] = []
  for (let w = 0; w < 53; w++) {
    const week: string[] = []
    for (let d = 0; d < 7; d++) {
      const dt = new Date(startSunday)
      dt.setDate(startSunday.getDate() + w * 7 + d)
      week.push(getISODateStr(dt))
    }
    weeks.push(week)
  }
  return weeks
}

function intensityLevel(ms: number, maxMs: number): number {
  if (ms === 0 || maxMs === 0) return 0
  const ratio = ms / maxMs
  if (ratio < 0.15) return 1
  if (ratio < 0.35) return 2
  if (ratio < 0.65) return 3
  return 4
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAY_LABELS = ['S','M','T','W','T','F','S']

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

export default function GlobalHeatmapModal({ onClose }: Props): JSX.Element {
  const [totalsMap, setTotalsMap] = useState<Map<string, number>>(new Map())
  const [tooltip, setTooltip] = useState<{ date: string; ms: number; x: number; y: number } | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [dayApps, setDayApps] = useState<BucketApp[]>([])

  useEffect(() => {
    const oneYearAgo = Date.now() - 53 * 7 * 86_400_000
    api.getDailyTotals(oneYearAgo, Date.now()).then((rows: DayTotal[]) => {
      const m = new Map<string, number>()
      for (const r of rows) m.set(r.date, r.active_ms)
      setTotalsMap(m)
    }).catch(() => {})
  }, [])

  const handleDayClick = useCallback((dateStr: string) => {
    if (dateStr > getISODateStr(new Date())) return
    setSelectedDay(dateStr)
    const from = new Date(dateStr + 'T00:00:00').getTime()
    const to = from + 86_400_000 - 1
    api.getBucketApps(from, to).then(setDayApps).catch(() => setDayApps([]))
  }, [])

  const weeks = buildGrid()
  const todayStr = getISODateStr(new Date())
  const maxMs = Math.max(...Array.from(totalsMap.values()), 0)

  const monthLabelCols: { col: number; label: string }[] = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    for (const dateStr of week) {
      const d = new Date(dateStr + 'T00:00:00')
      if (d.getDate() === 1 && d.getMonth() !== lastMonth) {
        monthLabelCols.push({ col: wi, label: MONTH_LABELS[d.getMonth()] })
        lastMonth = d.getMonth()
        break
      }
    }
  })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div 
        className="modal global-heatmap-modal" 
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 900, width: '90vw', maxHeight: '80vh' }}
      >
        <div className="modal__header">
          <h2 className="modal__title">Activity History</h2>
          <button className="btn--icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {maxMs === 0 ? (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: 'var(--space-8)',
            color: 'var(--color-text-muted)',
            gap: 'var(--space-3)'
          }}>
            <Calendar size={48} style={{ opacity: 0.5 }} />
            <p style={{ fontSize: 'var(--text-base)', margin: 0 }}>No activity recorded yet</p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-dim)', margin: 0 }}>
              Apps will appear here once you start using your computer
            </p>
          </div>
        ) : (
          <div className="global-heatmap-content" style={{ display: 'flex', gap: 20 }}>
            {/* Heatmap */}
            <div style={{ flex: 1 }}>
              <div className="heatmap-container" style={{ margin: 0 }}>
                <div className="heatmap-scroll">
                  <div className="heatmap-inner">
                    <div className="heatmap-months">
                      <div style={{ width: 18 }} />
                      {weeks.map((_, wi) => {
                        const label = monthLabelCols.find((m) => m.col === wi)
                        return (
                          <div key={wi} className="heatmap-month-cell">
                            {label ? label.label : ''}
                          </div>
                        )
                      })}
                    </div>

                    <div style={{ display: 'flex', gap: 2 }}>
                      <div className="heatmap-days">
                        {DAY_LABELS.map((d, i) => (
                          <div key={i} className="heatmap-day-label">{i % 2 === 1 ? d : ''}</div>
                        ))}
                      </div>

                      {weeks.map((week, wi) => (
                        <div key={wi} className="heatmap-week">
                          {week.map((dateStr) => {
                            const ms = totalsMap.get(dateStr) ?? 0
                            const level = intensityLevel(ms, maxMs)
                            const isFuture = dateStr > todayStr
                            return (
                              <div
                                key={dateStr}
                                className={`heatmap-cell heatmap-cell--l${level}${isFuture ? ' heatmap-cell--future' : ''}${dateStr === todayStr ? ' heatmap-cell--today' : ''}${selectedDay === dateStr ? ' heatmap-cell--selected' : ''}`}
                                onClick={() => handleDayClick(dateStr)}
                                onMouseEnter={(e) => {
                                  if (!isFuture) {
                                    const rect = (e.target as HTMLElement).getBoundingClientRect()
                                    setTooltip({ date: dateStr, ms, x: rect.left, y: rect.top })
                                  }
                                }}
                                onMouseLeave={() => setTooltip(null)}
                                title=""
                              />
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {tooltip && (
                  <div
                    className="heatmap-tooltip"
                    style={{ left: tooltip.x, top: tooltip.y - 40 }}
                  >
                    <span className="heatmap-tooltip__date">{tooltip.date}</span>
                    <span className="heatmap-tooltip__time">
                      {tooltip.ms > 0 ? fmtMs(tooltip.ms) : 'No activity'}
                    </span>
                  </div>
                )}

                <div className="heatmap-legend">
                  <span className="heatmap-legend__label">Less</span>
                  {[0, 1, 2, 3, 4].map((l) => (
                    <div key={l} className={`heatmap-cell heatmap-cell--l${l}`} style={{ cursor: 'default' }} />
                  ))}
                  <span className="heatmap-legend__label">More</span>
                </div>
              </div>
            </div>

            {/* Day Detail Panel */}
            <div style={{ width: 250, borderLeft: '1px solid var(--color-border)', paddingLeft: 20 }}>
              {selectedDay ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 'var(--text-base)' }}>
                    {formatDayLabel(selectedDay)}
                  </div>
                  {dayApps.length === 0 ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                      No activity recorded
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {dayApps.slice(0, 10).map((app) => (
                        <div 
                          key={app.app_id} 
                          style={{ 
                            display: 'flex', 
                            justifyContent: 'space-between', 
                            alignItems: 'center',
                            fontSize: 'var(--text-sm)'
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {app.display_name}
                          </span>
                          <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                            {fmtMs(app.active_ms)}
                          </span>
                        </div>
                      ))}
                      {dayApps.length > 10 && (
                        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: 4 }}>
                          +{dayApps.length - 10} more apps
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  Click a day to see activity breakdown
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
