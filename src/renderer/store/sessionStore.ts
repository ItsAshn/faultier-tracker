import { create } from 'zustand'
import type { RangeSummary, DateRangePreset, TickPayload } from '@shared/types'
import { api } from '../api/bridge'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'

interface SessionStore {
  summary: RangeSummary | null
  loading: boolean
  preset: DateRangePreset
  customFrom: number | null
  customTo: number | null
  activeAppId: number | null
  activeExeName: string | null

  setPreset: (preset: DateRangePreset) => void
  setCustomRange: (from: number, to: number) => void
  loadRange: () => Promise<void>
  onTick: (payload: TickPayload) => void
}

function getPresetRange(preset: DateRangePreset): { from: number; to: number } {
  const now = new Date()
  switch (preset) {
    case 'today':
      return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime() }
    case 'week':
      return { from: startOfWeek(now, { weekStartsOn: 1 }).getTime(), to: endOfWeek(now, { weekStartsOn: 1 }).getTime() }
    case 'month':
      return { from: startOfMonth(now).getTime(), to: endOfMonth(now).getTime() }
    case 'all':
      return { from: 0, to: endOfDay(now).getTime() }
    default:
      return { from: startOfDay(now).getTime(), to: endOfDay(now).getTime() }
  }
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  summary: null,
  loading: false,
  preset: 'today',
  customFrom: null,
  customTo: null,
  activeAppId: null,
  activeExeName: null,

  setPreset(preset) {
    set({ preset })
    get().loadRange()
  },

  setCustomRange(from, to) {
    set({ preset: 'custom', customFrom: from, customTo: to })
    get().loadRange()
  },

  async loadRange() {
    const { preset, customFrom, customTo } = get()
    let from: number, to: number, groupBy: 'hour' | 'day'

    if (preset === 'custom' && customFrom && customTo) {
      from = customFrom
      to = customTo
      const diff = to - from
      groupBy = diff <= 86_400_000 ? 'hour' : 'day'
    } else {
      const range = getPresetRange(preset)
      from = range.from
      to = range.to
      groupBy = preset === 'today' ? 'hour' : 'day'
    }

    // Only show loading spinner on the first load; subsequent refreshes are silent
    if (!get().summary) set({ loading: true })
    try {
      const summary = await api.getSessionRange(from, to, groupBy)
      set({ summary, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  onTick(payload) {
    set({
      activeAppId: payload.active_app?.app_id ?? null,
      activeExeName: payload.active_app?.exe_name ?? null
    })
    get().loadRange()
  }
}))
