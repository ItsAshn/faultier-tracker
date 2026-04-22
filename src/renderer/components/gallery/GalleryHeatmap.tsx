import { useState, useEffect, useCallback } from 'react';
import type { DayTotal, BucketApp } from '@shared/types';
import { api } from '../../api/bridge';
import { X, Calendar } from 'lucide-react';

interface GalleryHeatmapProps {
  onClose: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    backdropFilter: 'blur(4px)',
    zIndex: 500,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  modal: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-5)',
    maxWidth: '900px',
    width: '90vw',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: 'var(--shadow-lg)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 'var(--space-5)',
    paddingBottom: 'var(--space-3)',
    borderBottom: '1px solid var(--color-border)',
  },
  title: {
    fontSize: 'var(--text-xl)',
    fontWeight: 600,
    color: 'var(--color-text)',
    margin: 0,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
  },
  content: {
    display: 'flex',
    gap: '20px',
    flex: 1,
  },
  heatmapSection: {
    flex: 1,
  },
  heatmapContainer: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-5)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
    margin: 0,
  },
  scrollContainer: {
    overflowX: 'auto',
    overflowY: 'visible',
    paddingBottom: 'var(--space-1)',
  },
  innerContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  monthsRow: {
    display: 'flex',
    gap: '2px',
    paddingLeft: 0,
  },
  monthSpacer: {
    width: '18px',
  },
  monthCell: {
    width: '13px',
    fontSize: '10px',
    color: 'var(--color-text-dim)',
    overflow: 'visible',
    whiteSpace: 'nowrap',
    textAlign: 'left',
  },
  flexContainer: {
    display: 'flex',
    gap: '2px',
  },
  daysColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    width: '18px',
    flexShrink: 0,
  },
  dayLabel: {
    height: '11px',
    fontSize: '9px',
    color: 'var(--color-text-dim)',
    lineHeight: '11px',
    textAlign: 'right',
    paddingRight: '4px',
  },
  weekColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  cell: {
    width: '11px',
    height: '11px',
    borderRadius: '2px',
    cursor: 'pointer',
    transition: 'opacity 80ms ease, transform 80ms ease',
  },
  cellL0: {
    background: 'var(--color-surface-3)',
    border: '1px solid var(--color-border)',
  },
  cellL1: {
    background: 'rgba(245, 158, 11, 0.25)',
  },
  cellL2: {
    background: 'rgba(245, 158, 11, 0.50)',
  },
  cellL3: {
    background: 'rgba(245, 158, 11, 0.75)',
  },
  cellL4: {
    background: 'var(--color-accent)',
  },
  cellFuture: {
    opacity: 0.15,
    cursor: 'default',
  },
  cellToday: {
    outline: '1.5px solid var(--color-accent)',
    outlineOffset: '1px',
  },
  cellSelected: {
    outline: '2px solid #fff',
    outlineOffset: '1px',
  },
  cellHover: {
    transform: 'scale(1.3)',
    opacity: 1,
  },
  tooltip: {
    position: 'fixed',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border-light)',
    borderRadius: 'var(--radius-sm)',
    padding: '4px 8px',
    fontSize: '11px',
    pointerEvents: 'none',
    zIndex: 600,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    whiteSpace: 'nowrap',
    boxShadow: 'var(--shadow-sm)',
  },
  tooltipDate: {
    color: 'var(--color-text-muted)',
    fontSize: '10px',
  },
  tooltipTime: {
    color: 'var(--color-text)',
    fontWeight: 600,
  },
  legend: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    justifyContent: 'flex-end',
    marginTop: 'var(--space-3)',
  },
  legendLabel: {
    fontSize: '10px',
    color: 'var(--color-text-dim)',
  },
  dayPanel: {
    width: '250px',
    borderLeft: '1px solid var(--color-border)',
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
  },
  dayPanelTitle: {
    fontWeight: 600,
    marginBottom: '12px',
    fontSize: 'var(--text-base)',
    color: 'var(--color-text)',
  },
  dayPanelEmpty: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
  },
  appsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    overflow: 'auto',
    flex: 1,
  },
  appRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 'var(--text-sm)',
  },
  appName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--color-text)',
  },
  appTime: {
    color: 'var(--color-text-muted)',
    marginLeft: '8px',
    fontVariantNumeric: 'tabular-nums',
  },
  moreApps: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-xs)',
    marginTop: '4px',
  },
  hint: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-8)',
    color: 'var(--color-text-muted)',
    gap: 'var(--space-3)',
  },
};

function getISODateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildGrid(): string[][] {
  const today = new Date();
  const startSunday = new Date(today);
  startSunday.setDate(today.getDate() - today.getDay() - 51 * 7);
  startSunday.setHours(0, 0, 0, 0);

  const weeks: string[][] = [];
  for (let w = 0; w < 53; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(startSunday);
      dt.setDate(startSunday.getDate() + w * 7 + d);
      week.push(getISODateStr(dt));
    }
    weeks.push(week);
  }
  return weeks;
}

function intensityLevel(ms: number, maxMs: number): number {
  if (ms === 0 || maxMs === 0) return 0;
  const ratio = ms / maxMs;
  if (ratio < 0.15) return 1;
  if (ratio < 0.35) return 2;
  if (ratio < 0.65) return 3;
  return 4;
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return '<1m';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function GalleryHeatmap({ onClose }: GalleryHeatmapProps): JSX.Element {
  const [totalsMap, setTotalsMap] = useState<Map<string, number>>(new Map());
  const [tooltip, setTooltip] = useState<{ date: string; ms: number; x: number; y: number } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayApps, setDayApps] = useState<BucketApp[]>([]);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  useEffect(() => {
    const oneYearAgo = Date.now() - 53 * 7 * 86_400_000;
    api.getDailyTotals(oneYearAgo, Date.now()).then((rows: DayTotal[]) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.date, r.active_ms);
      setTotalsMap(m);
    }).catch(() => {});
  }, []);

  const handleDayClick = useCallback((dateStr: string) => {
    if (dateStr > getISODateStr(new Date())) return;
    setSelectedDay(dateStr);
    setDayLoading(true);
    const from = new Date(dateStr + 'T00:00:00').getTime();
    const to = from + 86_400_000 - 1;
    api.getBucketApps(from, to).then((apps) => { setDayApps(apps); setDayLoading(false); }).catch(() => { setDayApps([]); setDayLoading(false); });
  }, []);

  const weeks = buildGrid();
  const todayStr = getISODateStr(new Date());
  const maxMs = Math.max(...Array.from(totalsMap.values()), 0);

  const monthLabelCols: { col: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    for (const dateStr of week) {
      const d = new Date(dateStr + 'T00:00:00');
      if (d.getDate() === 1 && d.getMonth() !== lastMonth) {
        monthLabelCols.push({ col: wi, label: MONTH_LABELS[d.getMonth()] });
        lastMonth = d.getMonth();
        break;
      }
    }
  });

  const getCellStyles = (level: number, isFuture: boolean, isToday: boolean, isSelected: boolean, isHovered: boolean) => {
    let baseStyles = { ...styles.cell };
    
    switch (level) {
      case 0:
        baseStyles = { ...baseStyles, ...styles.cellL0 };
        break;
      case 1:
        baseStyles = { ...baseStyles, ...styles.cellL1 };
        break;
      case 2:
        baseStyles = { ...baseStyles, ...styles.cellL2 };
        break;
      case 3:
        baseStyles = { ...baseStyles, ...styles.cellL3 };
        break;
      case 4:
        baseStyles = { ...baseStyles, ...styles.cellL4 };
        break;
    }

    if (isFuture) {
      baseStyles = { ...baseStyles, ...styles.cellFuture };
    }
    if (isToday) {
      baseStyles = { ...baseStyles, ...styles.cellToday };
    }
    if (isSelected) {
      baseStyles = { ...baseStyles, ...styles.cellSelected };
    }
    if (isHovered) {
      baseStyles = { ...baseStyles, ...styles.cellHover };
    }

    return baseStyles;
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Activity History</h2>
          <button style={styles.closeButton} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {maxMs === 0 ? (
          <div style={styles.emptyState}>
            <Calendar size={48} style={{ opacity: 0.5 }} />
            <p style={{ fontSize: 'var(--text-base)', margin: 0 }}>No activity recorded yet</p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-dim)', margin: 0 }}>
              Apps will appear here once you start using your computer
            </p>
          </div>
        ) : (
          <div style={styles.content}>
            {/* Heatmap */}
            <div style={styles.heatmapSection}>
              <div style={styles.heatmapContainer}>
                <div style={styles.scrollContainer}>
                  <div style={styles.innerContainer}>
                    <div style={styles.monthsRow}>
                      <div style={styles.monthSpacer} />
                      {weeks.map((_, wi) => {
                        const label = monthLabelCols.find((m) => m.col === wi);
                        return (
                          <div key={wi} style={styles.monthCell}>
                            {label ? label.label : ''}
                          </div>
                        );
                      })}
                    </div>

                    <div style={styles.flexContainer}>
                      <div style={styles.daysColumn}>
                        {DAY_LABELS.map((d, i) => (
                          <div key={i} style={styles.dayLabel}>
                            {i % 2 === 1 ? d : ''}
                          </div>
                        ))}
                      </div>

                      {weeks.map((week, wi) => (
                        <div key={wi} style={styles.weekColumn}>
                          {week.map((dateStr) => {
                            const ms = totalsMap.get(dateStr) ?? 0;
                            const level = intensityLevel(ms, maxMs);
                            const isFuture = dateStr > todayStr;
                            const isToday = dateStr === todayStr;
                            const isSelected = selectedDay === dateStr;
                            const isHovered = hoveredCell === dateStr;

                            return (
                              <div
                                key={dateStr}
                                style={getCellStyles(level, isFuture, isToday, isSelected, isHovered)}
                                onClick={() => handleDayClick(dateStr)}
                                onMouseEnter={(e) => {
                                  if (!isFuture) {
                                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                                    setTooltip({ date: dateStr, ms, x: rect.left, y: rect.top });
                                    setHoveredCell(dateStr);
                                  }
                                }}
                                onMouseLeave={() => {
                                  setTooltip(null);
                                  setHoveredCell(null);
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {tooltip && (
                  <div
                    style={{
                      ...styles.tooltip,
                      left: tooltip.x,
                      top: tooltip.y - 40,
                    }}
                  >
                    <span style={styles.tooltipDate}>{tooltip.date}</span>
                    <span style={styles.tooltipTime}>
                      {tooltip.ms > 0 ? fmtMs(tooltip.ms) : 'No activity'}
                    </span>
                  </div>
                )}

                <div style={styles.legend}>
                  <span style={styles.legendLabel}>Less</span>
                  {[0, 1, 2, 3, 4].map((l) => (
                    <div key={l} style={getCellStyles(l, false, false, false, false)} />
                  ))}
                  <span style={styles.legendLabel}>More</span>
                </div>
              </div>
            </div>

            {/* Day Detail Panel */}
            <div style={styles.dayPanel}>
              {selectedDay ? (
                <>
                  <div style={styles.dayPanelTitle}>{formatDayLabel(selectedDay)}</div>
                  {dayLoading ? (
                    <div style={{ ...styles.dayPanelEmpty, fontStyle: 'italic' }}>Loading…</div>
                  ) : dayApps.length === 0 ? (
                    <div style={styles.dayPanelEmpty}>No activity recorded</div>
                  ) : (
                    <div style={styles.appsList}>
                      {dayApps.slice(0, 10).map((app) => (
                        <div key={app.app_id} style={styles.appRow}>
                          <span style={styles.appName}>{app.display_name}</span>
                          <span style={styles.appTime}>{fmtMs(app.active_ms)}</span>
                        </div>
                      ))}
                      {dayApps.length > 10 && (
                        <div style={styles.moreApps}>
                          +{dayApps.length - 10} more apps
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={styles.hint}>Click a day to see activity breakdown</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
