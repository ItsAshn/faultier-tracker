import { create } from 'zustand'
import type { UpdateInfo, UpdateProgressInfo, UpdateStatus } from '@shared/types'
import { api } from '../api/bridge'

interface UpdateStore {
  status: UpdateStatus
  info: UpdateInfo | null
  progress: UpdateProgressInfo | null
  error: string | null

  setAvailable: (info: UpdateInfo) => void
  setNotAvailable: () => void
  setProgress: (progress: UpdateProgressInfo) => void
  setDownloaded: (info: UpdateInfo) => void
  setError: (message: string) => void

  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  quitAndInstall: () => void
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  status: 'idle',
  info: null,
  progress: null,
  error: null,

  setAvailable: (info) => set({ status: 'available', info, error: null }),
  setNotAvailable: () => set({ status: 'not-available' }),
  setProgress: (progress) => set({ status: 'downloading', progress }),
  setDownloaded: (info) => set({ status: 'downloaded', info, progress: null }),
  setError: (message) => set({ status: 'error', error: message }),

  async checkForUpdates() {
    set({ status: 'checking', error: null })
    try {
      await api.checkForUpdates()
    } catch (e) {
      set({ status: 'error', error: String(e) })
    }
  },

  async downloadUpdate() {
    set({ status: 'downloading', progress: null })
    await api.downloadUpdate()
  },

  quitAndInstall() {
    api.quitAndInstall()
  },
}))
