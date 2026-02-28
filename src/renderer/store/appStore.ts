import { create } from 'zustand'
import type { AppRecord, AppGroup } from '@shared/types'
import { api } from '../api/bridge'

interface AppStore {
  apps: AppRecord[]
  groups: AppGroup[]
  settings: Record<string, unknown>
  loading: boolean

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

  async loadAll() {
    set({ loading: true })
    const [apps, groups, settings] = await Promise.all([
      api.getApps(),
      api.getGroups(),
      api.getAllSettings()
    ])
    set({ apps, groups, settings, loading: false })
  },

  async updateApp(patch) {
    await api.updateApp(patch)
    set((s) => ({
      apps: s.apps.map((a) => (a.id === patch.id ? { ...a, ...patch } : a))
    }))
  },

  async setAppTracked(id, tracked) {
    await api.setAppTracked(id, tracked)
    set((s) => ({
      apps: s.apps.map((a) => (a.id === id ? { ...a, is_tracked: tracked } : a))
    }))
  },

  async setAppGroup(id, groupId) {
    await api.setAppGroup(id, groupId)
    set((s) => ({
      apps: s.apps.map((a) => (a.id === id ? { ...a, group_id: groupId } : a))
    }))
  },

  async createGroup(name) {
    const group = await api.createGroup(name)
    set((s) => ({ groups: [...s.groups, group] }))
    return group
  },

  async updateGroup(patch) {
    await api.updateGroup(patch)
    set((s) => ({
      groups: s.groups.map((g) => (g.id === patch.id ? { ...g, ...patch } : g))
    }))
  },

  async deleteGroup(id) {
    await api.deleteGroup(id)
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      apps: s.apps.map((a) => (a.group_id === id ? { ...a, group_id: null } : a))
    }))
  },

  async reanalyzeGroups() {
    await api.reanalyzeGroups()
    // Reload everything since group assignments may have changed
    await get().loadAll()
  },

  async setSetting(key, value) {
    await api.setSetting(key, value)
    set((s) => ({ settings: { ...s.settings, [key]: value } }))
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
