import { getDb } from '../db/client'
import { KNOWN_APP_RULES, VERSION_SUFFIX_PATTERNS, LINUX_SUFFIX_PATTERNS } from './groupRules'
import { distance } from 'fastest-levenshtein'

function ensureGroup(name: string, createdAt: number): number {
  const db = getDb()
  const existing = db
    .prepare<[string], { id: number } | undefined>('SELECT id FROM app_groups WHERE name = ?')
    .get(name)
  if (existing) return existing.id

  const result = db
    .prepare<[string, number], { lastInsertRowid: number | bigint }>(
      'INSERT INTO app_groups (name, created_at) VALUES (?, ?)'
    )
    .run(name, createdAt)
  return result.lastInsertRowid as number
}

function normalizedDistance(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 0
  return distance(a, b) / maxLen
}

/**
 * Normalize an exe name for grouping comparison.
 * Strips extensions, version suffixes, and Linux-specific suffixes.
 * Used for fuzzy matching while preserving original exe_name in DB.
 */
function normalizeForGrouping(exeName: string): string {
  let result = exeName.toLowerCase()
  
  // Strip common extensions
  result = result.replace(/\.(exe|appimage|flatpak)$/i, '')
  
  // Strip version suffixes
  for (const pattern of VERSION_SUFFIX_PATTERNS) {
    result = result.replace(pattern, '')
  }
  
  // Strip Linux-specific suffixes
  for (const pattern of LINUX_SUFFIX_PATTERNS) {
    result = result.replace(pattern, '')
  }
  
  return result.trim()
}

/**
 * Resolves the group for a given app exe name.
 * Returns the group_id, or null if no group matches.
 */
export async function resolveGroup(exeName: string, _exePath: string | null): Promise<number | null> {
  const normalizedExe = normalizeForGrouping(exeName)
  const lowerExe = exeName.toLowerCase().replace(/\.exe$/i, '')
  const lowerExeFull = exeName.toLowerCase()
  const now = Date.now()
  const db = getDb()

  // ── Step 1: Known-app dictionary ─────────────────────────────────────────
  for (const rule of KNOWN_APP_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lowerExeFull) || pattern.test(lowerExe)) {
        return ensureGroup(rule.groupName, now)
      }
    }
  }

  // ── Step 2: Steam library path matching ────────────────────────────────
  if (_exePath) {
    const steamMatch = /steamapps[\\/]common[\\/]([^\\/]+)/i.exec(_exePath)
    if (steamMatch) {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const folderNorm = normalize(steamMatch[1])
      const steamApps = db
        .prepare<[], { id: number; display_name: string; group_id: number | null }>(
          "SELECT id, display_name, group_id FROM apps WHERE exe_name LIKE 'steam:%' AND is_steam_import = 1"
        )
        .all()

      let bestSteamMatch: {
        appId: number
        displayName: string
        groupId: number | null
        dist: number
      } | null = null

      for (const steamApp of steamApps) {
        const dist = normalizedDistance(folderNorm, normalize(steamApp.display_name))
        if (dist <= 0.1 && (!bestSteamMatch || dist < bestSteamMatch.dist)) {
          bestSteamMatch = {
            appId: steamApp.id,
            displayName: steamApp.display_name,
            groupId: steamApp.group_id,
            dist
          }
        }
      }

      if (bestSteamMatch) {
        if (bestSteamMatch.groupId !== null) return bestSteamMatch.groupId
        const groupId = ensureGroup(bestSteamMatch.displayName, now)
        db.prepare<[number, number], void>('UPDATE apps SET group_id = ? WHERE id = ?')
          .run(groupId, bestSteamMatch.appId)
        return groupId
      }
    }
  }

  // ── Step 3: Find similar groups by normalized name ───────────────────────
  if (!normalizedExe || normalizedExe.length < 3) return null

  const existingGroups = db
    .prepare<[], { id: number; name: string }>('SELECT id, name FROM app_groups')
    .all()

  let bestMatch: { id: number; dist: number } | null = null

  for (const group of existingGroups) {
    const dist = normalizedDistance(normalizedExe, group.name.toLowerCase())
    if (dist <= 0.25 && (!bestMatch || dist < bestMatch.dist)) {
      bestMatch = { id: group.id, dist }
    }
  }

  if (bestMatch) return bestMatch.id

  // ── Step 4: Check if multiple apps share similar normalized names ─────────
  const allApps = db
    .prepare<[], { id: number; exe_name: string }>('SELECT id, exe_name FROM apps')
    .all()

  const normalizedNames = new Map<string, number>()
  for (const app of allApps) {
    const norm = normalizeForGrouping(app.exe_name)
    normalizedNames.set(norm, (normalizedNames.get(norm) ?? 0) + 1)
  }

  if ((normalizedNames.get(normalizedExe) ?? 0) >= 2) {
    const groupName = normalizedExe
      .split(/[\s\-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    return ensureGroup(groupName, now)
  }

  return null
}

/**
 * Re-runs auto-grouping for all apps.
 */
export async function reanalyzeGroups(): Promise<void> {
  const db = getDb()

  const apps = db
    .prepare<[], { id: number; exe_name: string; exe_path: string | null }>(
      'SELECT id, exe_name, exe_path FROM apps'
    )
    .all()

  const updateGroup = db.prepare<[number | null, number], void>(
    'UPDATE apps SET group_id = ? WHERE id = ?'
  )

  for (const app of apps) {
    const groupId = await resolveGroup(app.exe_name, app.exe_path)
    updateGroup.run(groupId, app.id)
  }
}