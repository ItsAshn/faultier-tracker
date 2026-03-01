// Typed wrappers around the contextBridge API exposed by the preload.
// Import this module everywhere in the renderer instead of using window.api directly.

import type { ApiType } from '../../preload/index'

declare global {
  interface Window {
    api: ApiType
  }
}

// Mock data for browser preview
const MOCK_APPS = [
  { id: 1, exe_name: 'blender.exe', exe_path: null, display_name: 'Blender', group_id: 1, is_tracked: true, icon_cache_path: null, custom_image_path: null, description: '3D modeling', notes: '', tags: ['creative', '3d'], first_seen: 0, last_seen: 0 },
  { id: 2, exe_name: 'code.exe', exe_path: null, display_name: 'VS Code', group_id: null, is_tracked: true, icon_cache_path: null, custom_image_path: null, description: 'Code editor', notes: '', tags: ['dev'], first_seen: 0, last_seen: 0 },
  { id: 3, exe_name: 'chrome.exe', exe_path: null, display_name: 'Chrome', group_id: null, is_tracked: true, icon_cache_path: null, custom_image_path: null, description: '', notes: '', tags: [], first_seen: 0, last_seen: 0 },
  { id: 4, exe_name: 'discord.exe', exe_path: null, display_name: 'Discord', group_id: null, is_tracked: true, icon_cache_path: null, custom_image_path: null, description: '', notes: '', tags: [], first_seen: 0, last_seen: 0 },
  { id: 5, exe_name: 'spotify.exe', exe_path: null, display_name: 'Spotify', group_id: null, is_tracked: false, icon_cache_path: null, custom_image_path: null, description: '', notes: '', tags: [], first_seen: 0, last_seen: 0 },
  { id: 6, exe_name: 'obs64.exe', exe_path: null, display_name: 'OBS Studio', group_id: null, is_tracked: true, icon_cache_path: null, custom_image_path: null, description: '', notes: '', tags: [], first_seen: 0, last_seen: 0 },
] as any[]

const MOCK_GROUPS = [
  { id: 1, name: 'Blender', description: '3D suite', icon_cache_path: null, custom_image_path: null, tags: [], is_manual: false, created_at: 0 },
] as any[]

const MOCK_RANGE = {
  from: Date.now() - 86_400_000,
  to: Date.now(),
  apps: [
    { app_id: 1, exe_name: 'blender.exe', display_name: 'Blender', group_id: 1, active_ms: 7_320_000, running_ms: 9_000_000 },
    { app_id: 2, exe_name: 'code.exe', display_name: 'VS Code', group_id: null, active_ms: 3_600_000, running_ms: 5_400_000 },
    { app_id: 3, exe_name: 'chrome.exe', display_name: 'Chrome', group_id: null, active_ms: 1_800_000, running_ms: 2_700_000 },
    { app_id: 6, exe_name: 'obs64.exe', display_name: 'OBS Studio', group_id: null, active_ms: 600_000, running_ms: 1_200_000 },
  ],
  chart_points: (() => {
    const now = new Date()
    const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    return [
      { date: `${d} 09:00`, active_ms: 1_800_000, running_ms: 2_700_000 },
      { date: `${d} 10:00`, active_ms: 3_600_000, running_ms: 4_500_000 },
      { date: `${d} 11:00`, active_ms: 2_700_000, running_ms: 3_600_000 },
      { date: `${d} 12:00`, active_ms: 600_000, running_ms: 900_000 },
      { date: `${d} 13:00`, active_ms: 900_000, running_ms: 1_500_000 },
      { date: `${d} 14:00`, active_ms: 2_520_000, running_ms: 3_600_000 },
      { date: `${d} 15:00`, active_ms: 1_200_000, running_ms: 1_500_000 },
    ]
  })(),
  total_active_ms: 13_320_000,
  total_running_ms: 18_300_000,
  top_app: { app_id: 1, exe_name: 'blender.exe', display_name: 'Blender', group_id: 1, active_ms: 7_320_000, running_ms: 9_000_000 },
} as any

// Browser stub — used when running outside Electron (e.g. preview / dev browser)
const stub: ApiType = {
  getApps: () => Promise.resolve(MOCK_APPS),
  updateApp: () => Promise.resolve(),
  setAppTracked: () => Promise.resolve(),
  setAppGroup: () => Promise.resolve(),
  getGroups: () => Promise.resolve(MOCK_GROUPS),
  createGroup: () => Promise.resolve(null as any),
  updateGroup: () => Promise.resolve(),
  deleteGroup: () => Promise.resolve(),
  reanalyzeGroups: () => Promise.resolve(),
  getSessionRange: () => Promise.resolve(MOCK_RANGE),
  getAppSessionRange: () => Promise.resolve({ active_ms: 0, running_ms: 0, chart_points: [], member_summaries: [] }),
  getSessionTitles: () => Promise.resolve([] as any[]),
  getDailyTotals: () => Promise.resolve([] as any[]),
  getBucketApps: () => Promise.resolve([] as any[]),
  clearAllSessions: () => Promise.resolve(),
  getAllSettings: () => Promise.resolve({} as any),
  setSetting: () => Promise.resolve(),
  getIconForApp: () => Promise.resolve(null),
  getIconForGroup: () => Promise.resolve(null),
  setCustomIcon: () => Promise.resolve(''),
  clearCustomIcon: () => Promise.resolve(),
  fetchIconFromUrl: () => Promise.resolve(null),
  exportData: () => Promise.resolve({ success: false }),
  exportDataCsv: () => Promise.resolve({ success: false }),
  importData: () => Promise.resolve({ appsAdded: 0, appsUpdated: 0, sessionsAdded: 0, duplicates: 0, errors: [] } as any),
  importSteamData: () => Promise.resolve({ gamesImported: 0, sessionsAdded: 0, duplicates: 0, errors: [] }),
  searchArtwork: () => Promise.resolve({ results: [] }),
  windowControl: () => {},
  onTick: () => () => {},
  onAppSeen: () => () => {},
  onArtworkUpdated: () => () => {},
  checkForUpdates: () => Promise.resolve(),
  downloadUpdate: () => Promise.resolve(),
  quitAndInstall: () => {},
  onUpdateAvailable: () => () => {},
  onUpdateNotAvailable: () => () => {},
  onUpdateDownloadProgress: () => () => {},
  onUpdateDownloaded: () => () => {},
  onUpdateError: () => () => {},
}

export const api: ApiType = window.api ?? stub
