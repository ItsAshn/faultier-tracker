import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/channels'
import type {
  AppRecord, AppGroup, RangeSummary, AppRangeSummary, ImportResult, SteamImportResult,
  WindowControlAction, TickPayload, UpdateInfo, UpdateProgressInfo,
  ArtworkSearchResponse, TitleSummary, DayTotal, BucketApp
} from '@shared/types'

// Typed API exposed to the renderer via contextBridge
const api = {
  // Apps
  getApps: (): Promise<AppRecord[]> =>
    ipcRenderer.invoke(CHANNELS.APPS_GET_ALL),

  updateApp: (patch: Partial<AppRecord> & { id: number }): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.APPS_UPDATE, patch),

  setAppTracked: (id: number, tracked: boolean): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.APPS_SET_TRACKED, id, tracked),

  setAppGroup: (id: number, groupId: number | null): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.APPS_SET_GROUP, id, groupId),

  // Groups
  getGroups: (): Promise<AppGroup[]> =>
    ipcRenderer.invoke(CHANNELS.GROUPS_GET_ALL),

  createGroup: (name: string): Promise<AppGroup> =>
    ipcRenderer.invoke(CHANNELS.GROUPS_CREATE, name),

  updateGroup: (patch: Partial<AppGroup> & { id: number }): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.GROUPS_UPDATE, patch),

  deleteGroup: (id: number): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.GROUPS_DELETE, id),

  reanalyzeGroups: (): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.GROUPS_REANALYZE),

  // Sessions
  getSessionRange: (
    from: number,
    to: number,
    groupBy?: 'hour' | 'day'
  ): Promise<RangeSummary> =>
    ipcRenderer.invoke(CHANNELS.SESSIONS_GET_RANGE, from, to, groupBy),

  getAppSessionRange: (
    id: number,
    from: number,
    to: number,
    groupBy: 'hour' | 'day',
    isGroup: boolean
  ): Promise<AppRangeSummary> =>
    ipcRenderer.invoke(CHANNELS.SESSIONS_GET_APP_RANGE, id, from, to, groupBy, isGroup),

  getSessionTitles: (appId: number, from: number, to: number, isGroup: boolean): Promise<TitleSummary[]> =>
    ipcRenderer.invoke(CHANNELS.SESSIONS_GET_TITLES, appId, from, to, isGroup),

  getDailyTotals: (from: number, to: number): Promise<DayTotal[]> =>
    ipcRenderer.invoke(CHANNELS.SESSIONS_GET_DAILY_TOTALS, from, to),

  getBucketApps: (from: number, to: number): Promise<BucketApp[]> =>
    ipcRenderer.invoke(CHANNELS.SESSIONS_GET_BUCKET_APPS, from, to),

  clearAllSessions: (): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.SESSIONS_CLEAR_ALL),

  // Settings
  getAllSettings: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(CHANNELS.SETTINGS_GET_ALL),

  setSetting: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.SETTINGS_SET, key, value),

  // Icons
  getIconForApp: (appId: number): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.ICONS_GET_FOR_APP, appId),

  getIconForGroup: (groupId: number): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.ICONS_GET_FOR_GROUP, groupId),

  setCustomIcon: (id: number, base64: string, isGroup?: boolean): Promise<string> =>
    ipcRenderer.invoke(CHANNELS.ICONS_SET_CUSTOM, id, base64, isGroup),

  clearCustomIcon: (id: number, isGroup?: boolean): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.ICONS_CLEAR_CUSTOM, id, isGroup),

  fetchIconFromUrl: (id: number, url: string, isGroup?: boolean): Promise<string | null> =>
    ipcRenderer.invoke(CHANNELS.ICONS_FETCH_URL, id, url, isGroup),

  // Artwork search
  searchArtwork: (query: string, type?: string): Promise<ArtworkSearchResponse> =>
    ipcRenderer.invoke(CHANNELS.ARTWORK_SEARCH, query, type),

  // Data transfer
  exportData: (): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke(CHANNELS.DATA_EXPORT),

  exportDataCsv: (): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke(CHANNELS.DATA_EXPORT_CSV),

  importData: (): Promise<ImportResult & { error?: string }> =>
    ipcRenderer.invoke(CHANNELS.DATA_IMPORT),

  importSteamData: (apiKey: string, steamId: string): Promise<SteamImportResult> =>
    ipcRenderer.invoke(CHANNELS.DATA_STEAM_IMPORT, apiKey, steamId),

  // Window
  windowControl: (action: WindowControlAction): void =>
    ipcRenderer.send(CHANNELS.WINDOW_CONTROL, action),

  // Subscribe to push events from main
  onTick: (cb: (payload: TickPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: TickPayload): void => cb(payload)
    ipcRenderer.on(CHANNELS.TRACKING_TICK, handler)
    return () => ipcRenderer.removeListener(CHANNELS.TRACKING_TICK, handler)
  },

  onAppSeen: (cb: (app: AppRecord) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, app: AppRecord): void => cb(app)
    ipcRenderer.on(CHANNELS.TRACKING_APP_SEEN, handler)
    return () => ipcRenderer.removeListener(CHANNELS.TRACKING_APP_SEEN, handler)
  },

  onArtworkUpdated: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(CHANNELS.APPS_ARTWORK_UPDATED, handler)
    return () => ipcRenderer.removeListener(CHANNELS.APPS_ARTWORK_UPDATED, handler)
  },

  // Auto-updater — invoke commands
  checkForUpdates: (): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.UPDATE_CHECK),

  downloadUpdate: (): Promise<void> =>
    ipcRenderer.invoke(CHANNELS.UPDATE_DOWNLOAD),

  quitAndInstall: (): void => {
    ipcRenderer.invoke(CHANNELS.UPDATE_QUIT_AND_INSTALL)
  },

  // Auto-updater — push subscriptions (main → renderer)
  onUpdateAvailable: (cb: (info: UpdateInfo) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: UpdateInfo): void => cb(info)
    ipcRenderer.on(CHANNELS.UPDATE_AVAILABLE, handler)
    return () => ipcRenderer.removeListener(CHANNELS.UPDATE_AVAILABLE, handler)
  },

  onUpdateNotAvailable: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(CHANNELS.UPDATE_NOT_AVAILABLE, handler)
    return () => ipcRenderer.removeListener(CHANNELS.UPDATE_NOT_AVAILABLE, handler)
  },

  onUpdateDownloadProgress: (cb: (info: UpdateProgressInfo) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: UpdateProgressInfo): void => cb(info)
    ipcRenderer.on(CHANNELS.UPDATE_DOWNLOAD_PROGRESS, handler)
    return () => ipcRenderer.removeListener(CHANNELS.UPDATE_DOWNLOAD_PROGRESS, handler)
  },

  onUpdateDownloaded: (cb: (info: UpdateInfo) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, info: UpdateInfo): void => cb(info)
    ipcRenderer.on(CHANNELS.UPDATE_DOWNLOADED, handler)
    return () => ipcRenderer.removeListener(CHANNELS.UPDATE_DOWNLOADED, handler)
  },

  onUpdateError: (cb: (message: string) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, msg: string): void => cb(msg)
    ipcRenderer.on(CHANNELS.UPDATE_ERROR, handler)
    return () => ipcRenderer.removeListener(CHANNELS.UPDATE_ERROR, handler)
  },
}

contextBridge.exposeInMainWorld('api', api)

// TypeScript type augmentation for renderer
export type ApiType = typeof api
