import { useState, useEffect } from 'react';
import type { DayTotal } from '@shared/types';
import { api } from '../../api/bridge';

interface DetailHeatmapProps {
  appId: number;
  isGroup?: boolean;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-5)',
    marginTop: 'var(--space-4)',
  },
  title: {
    fontSize: 'var(--text-md)',
    fontWeight: 600,
    marginBottom: 'var(--space-4)',
    color: 'var(--color-text)',
  },
  grid: {
    marginBottom: 'var(--space-4)',
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
    zIndex: 10,
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
    paddingTop: 'var(--space-3)',
    borderTop: '1px solid var(--color-border)',
  },
  legendLabel: {
    fontSize: '10px',
    color: 'var(--color-text-dim)',
  },
  loading: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
    textAlign: 'center',
    padding: 'var(--space-4)',
  },
  empty: {
    color: 'var(--color-text-muted)',
    fontSize: 'var(--text-sm)',
    textAlign: 'center',
    padding: 'var(--space-4)',
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

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function DetailHeatmap({ appId, isGroup = false }: DetailHeatmapProps): JSX.Element {
  const [totalsMap, setTotalsMap] = useState<Map<string, number>>(new Map());
  const [tooltip, setTooltip] = useState<{ date: string; ms: number; x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const oneYearAgo = Date.now() - 53 * 7 * 86_400_000;
    const now = Date.now();

    api.getAppSessionRange(appId, oneYearAgo, now, 'day', isGroup)
      .then((result) => {
        const m = new Map<string, number>();
        if (result && result.chart_points) {
          for (const point of result.chart_points) {
            m.set(point.date, point.active_ms);
          }
        }
        setTotalsMap(m);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [appId, isGroup]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>Loading activity...</div>
      </div>
    );
  }

  const weeks = buildGrid();
  const todayStr = getISODateStr(new Date());
  const maxMs = Math.max(...Array.from(totalsMap.values()), 0);

  if (maxMs === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.title}>Activity History</div>
        <div style={styles.empty}>No activity recorded yet</div>
      </div>
    );
  }

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

  const getCellStyles = (level: number, isFuture: boolean, isToday: boolean, isHovered: boolean) => {
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
    if (isHovered) {
      baseStyles = { ...baseStyles, ...styles.cellHover };
    }

    return baseStyles;
  };

  return (
    <div style={styles.container}>
      <div style={styles.title}>Activity History</div>
      <div style={styles.grid}>
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
                const isHovered = hoveredCell === dateStr;

                return (
                  <div
                    key={dateStr}
                    style={getCellStyles(level, isFuture, isToday, isHovered)}
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
          <div key={l} style={getCellStyles(l, false, false, false)} />
        ))}
        <span style={styles.legendLabel}>More</span>
      </div>
    </div>
  );
}
