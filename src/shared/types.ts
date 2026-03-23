// Shared TypeScript interfaces used by main process, preload, and renderer.

export interface AppRecord {
  id: number
  exe_name: string
  exe_path: string | null
  display_name: string
  group_id: number | null
  is_tracked: boolean
  is_steam_import: boolean  // NEW: true for Steam-imported games
  /** Set when this exe row has been linked (but not yet merged) to a steam: app row */
  linked_steam_app_id: number | null
  icon_cache_path: string | null
  custom_image_path: string | null
  first_seen: number
  last_seen: number
}

export interface AppGroup {
  id: number
  name: string
  icon_cache_path: string | null
  custom_image_path: string | null
  is_manual: boolean
  created_at: number
}

export interface SessionSummary {
  app_id: number
  exe_name: string
  display_name: string
  group_id: number | null
  active_ms: number
}

export interface ChartDataPoint {
  date: string        // 'YYYY-MM-DD' or 'HH:00'
  active_ms: number
}

export interface RangeSummary {
  from: number
  to: number
  total_active_ms: number
  top_app: SessionSummary | null
  apps: SessionSummary[]
  chart_points: ChartDataPoint[]
}

export interface AppRangeSummary {
  active_ms: number
  session_count: number
  chart_points: ChartDataPoint[]
  member_summaries: SessionSummary[]
}

export interface ImportResult {
  appsAdded: number
  appsUpdated: number
  sessionsAdded: number
  duplicates: number
  errors: string[]
}

export interface SteamImportResult {
  gamesImported: number
  sessionsAdded: number
  duplicates: number
  errors: string[]
}

export interface SteamRefreshResult {
  updated: number
  totalDeltaMs: number
  error?: string
}

export interface ExportPayload {
  version: 2
  exported_at: string
  machine_id: string
  apps: ExportedApp[]
  groups: ExportedGroup[]
  sessions: ExportedSession[]
  settings: Record<string, string>
}

export interface ExportedApp {
  exe_name: string
  exe_path: string | null
  display_name: string
  group_name: string | null
}

export interface ExportedGroup {
  name: string
  is_manual: boolean
}

export interface ExportedSession {
  app_exe: string
  app_path: string | null
  s: number   // started_at ms
  e: number   // ended_at ms
  machine: string
}

export interface TickPayload {
  active_app: {
    exe_name: string
    display_name: string
    app_id: number
  } | null
  timestamp: number
  is_idle: boolean
}

export type WindowControlAction = 'minimize' | 'maximize' | 'close' | 'restart'

export type DateRangePreset = 'today' | 'week' | 'month' | 'all' | 'custom'

export interface UpdateInfo {
  version: string
  releaseNotes?: string | null
}

export interface UpdateProgressInfo {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface ArtworkResult {
  id: number
  url: string
  thumb: string
  width: number
  height: number
  style?: string
  mime?: string
}

export interface ArtworkSearchResponse {
  results: ArtworkResult[]
  error?: string
}

export interface TitleSummary {
  window_title: string
  duration_ms: number
  last_seen: number
}

export interface DayTotal {
  date: string      // 'YYYY-MM-DD'
  active_ms: number
}

export interface BucketApp {
  app_id: number
  display_name: string
  active_ms: number
}

export interface ExeNameMapping {
  [exeName: string]: string
}

/** Payload for the APPS_STEAM_LINK_SUGGESTED push event */
export interface SteamLinkSuggestion {
  /** The raw exe app row (is_steam_import = false) */
  exeApp: AppRecord
  /** Candidate steam: app rows ordered by confidence (best first, max 3) */
  candidates: AppRecord[]
}

/** Result of APPS_MERGE_STEAM */
export interface MergeSteamResult {
  success: boolean
  error?: string
}

export interface InstallTypeInfo {
  canAutoUpdate: boolean
  installType: 'windows' | 'appimage' | 'system-package'
}
