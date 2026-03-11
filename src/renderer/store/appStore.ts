import { create } from 'zustand'
import type { AppRecord, AppGroup } from '@shared/types'
import { api } from '../api/bridge'

interface AppStore {
  apps: AppRecord[]
  groups: AppGroup[]
  settings: Record<string, unknown>
  loading: boolean
  error: string | null
  clearError: () => void

  loadAll: () => Promise<void>
  updateApp: (patch: Partial<AppRecord> & { id: number }) => Promise<void>
  setAppTracked: (id: number, tracked: boolean) => Promise<void>
  setAppGroup: (id: number, groupId: number | null) => Promise<void>

  createGroup: (name: string) => Promise<AppGroup>
  updateGroup: (patch: Partial<AppGroup> & { id: number }) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  reanalyzeGroups: () => Promise<void>

  setSetting: (key: string, value: unknown) => Promise<void>
  getSettingValue: <T>(key: string, fallback: T) => T

  // Called from tracker push event
  upsertApp: (app: AppRecord) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  apps: [],
  groups: [],
  settings: {},
  loading: false,
  error: null,
  clearError: () => set({ error: null }),

  async loadAll() {
    set({ loading: true, error: null })
    try {
      const [apps, groups, settings] = await Promise.all([
        api.getApps(),
        api.getGroups(),
        api.getAllSettings()
      ])
      set({ apps, groups, settings, loading: false })
    } catch (err) {
      set({ loading: false, error: String(err) })
    }
  },

  async updateApp(patch) {
    try {
      await api.updateApp(patch)
      set((s) => ({
        apps: s.apps.map((a) => (a.id === patch.id ? { ...a, ...patch } : a))
      }))
    } catch (err) {
      set({ error: String(err) })
    }
  },

  async setAppTracked(id, tracked) {
    // Store the previous state for potential rollback
    const previousApps = get().apps
    const previousTracked = previousApps.find((a) => a.id === id)?.is_tracked

    // Optimistically update UI
    set((s) => ({
      apps: s.apps.map((a) => (a.id === id ? { ...a, is_tracked: tracked } : a))
    }))

    try {
      await api.setAppTracked(id, tracked)
    } catch (err) {
      // Revert to previous state on error
      console.error('[AppStore] setAppTracked failed, reverting state:', err)
      set({
        apps: previousApps,
        error: String(err)
      })
      // Re-throw so UI can show error if needed
      throw err
    }
  },

  async setAppGroup(id, groupId) {
    try {
      await api.setAppGroup(id, groupId)
      set((s) => ({
        apps: s.apps.map((a) => (a.id === id ? { ...a, group_id: groupId } : a))
      }))
    } catch (err) {
      set({ error: String(err) })
    }
  },

  async createGroup(name) {
    try {
      const group = await api.createGroup(name)
      set((s) => ({ groups: [...s.groups, group] }))
      return group
    } catch (err) {
      set({ error: String(err) })
      throw err
    }
  },

  async updateGroup(patch) {
    try {
      await api.updateGroup(patch)
      set((s) => ({
        groups: s.groups.map((g) => (g.id === patch.id ? { ...g, ...patch } : g))
      }))
    } catch (err) {
      set({ error: String(err) })
    }
  },

  async deleteGroup(id) {
    try {
      await api.deleteGroup(id)
      set((s) => ({
        groups: s.groups.filter((g) => g.id !== id),
        apps: s.apps.map((a) => (a.group_id === id ? { ...a, group_id: null } : a))
      }))
    } catch (err) {
      set({ error: String(err) })
    }
  },

  async reanalyzeGroups() {
    try {
      await api.reanalyzeGroups()
      await get().loadAll()
    } catch (err) {
      set({ error: String(err) })
    }
  },

  async setSetting(key, value) {
    // Update local state immediately so sliders and toggles feel instant
    set((s) => ({ settings: { ...s.settings, [key]: value } }))
    try {
      await api.setSetting(key, value)
    } catch (err) {
      set({ error: String(err) })
    }
  },

  getSettingValue<T>(key: string, fallback: T): T {
    const val = get().settings[key]
    return val !== undefined ? (val as T) : fallback
  },

  upsertApp(app) {
    set((s) => {
      const idx = s.apps.findIndex((a) => a.id === app.id)
      if (idx === -1) return { apps: [...s.apps, app] }
      const updated = [...s.apps]
      updated[idx] = app
      return { apps: updated }
    })
  }
}))
