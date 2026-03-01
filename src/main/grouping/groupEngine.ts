import { getDb } from '../db/client'
import { KNOWN_APP_RULES, VERSION_SUFFIX_PATTERNS } from './groupRules'
import { distance } from 'fastest-levenshtein'

// In-memory cache: exeName (lowercased) → group_id
const manualRuleCache = new Map<string, number>()
let cacheBuilt = false

export function invalidateGroupCache(): void {
  manualRuleCache.clear()
  cacheBuilt = false
}

function buildRuleCache(): void {
  if (cacheBuilt) return
  const db = getDb()
  const rules = db
    .prepare<
      [],
      { group_id: number; pattern: string; match_type: string }
    >('SELECT group_id, pattern, match_type FROM group_rules WHERE is_manual = 1')
    .all()

  for (const rule of rules) {
    manualRuleCache.set(rule.pattern.toLowerCase(), rule.group_id)
  }
  cacheBuilt = true
}

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

function stripVersionSuffixes(name: string): string {
  let result = name
  for (const pattern of VERSION_SUFFIX_PATTERNS) {
    result = result.replace(pattern, '')
  }
  return result.trim()
}

/**
 * Resolves the group for a given app exe name.
 * Returns the group_id, or null if no group matches.
 */
export async function resolveGroup(exeName: string, _exePath: string | null): Promise<number | null> {
  buildRuleCache()

  const lowerExe = exeName.toLowerCase().replace(/\.exe$/i, '')
  const lowerExeFull = exeName.toLowerCase()
  const now = Date.now()
  const db = getDb()

  // ── Step 1: Manual rules ─────────────────────────────────────────────────
  const manualMatch =
    manualRuleCache.get(lowerExeFull) ?? manualRuleCache.get(lowerExe)
  if (manualMatch !== undefined) return manualMatch

  // ── Step 2: Known-app dictionary ─────────────────────────────────────────
  for (const rule of KNOWN_APP_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lowerExeFull) || pattern.test(lowerExe)) {
        return ensureGroup(rule.groupName, now)
      }
    }
  }

  // ── Step 2.5: Steam library path matching ────────────────────────────────
  // If the exe lives inside steamapps/common/<GameFolder>/, match that folder
  // name against Steam-imported apps (exe_name LIKE 'steam:%') so that games
  // with codename executables (e.g. "pioneergame.exe" → "Arc Raiders") are
  // automatically grouped with their Steam library entry.
  //
  // Both strings are normalized (non-alphanumeric stripped) before comparing so
  // that "ArcRaiders" and "Arc Raiders" become identical (distance 0).  The
  // tight threshold of 0.1 avoids false positives: e.g. "Portal 2" (7 chars
  // after strip) vs "Portal" (6 chars) = 1/7 ≈ 0.14, which correctly won't match.
  if (_exePath) {
    const steamMatch = /steamapps[\\/]common[\\/]([^\\/]+)/i.exec(_exePath)
    if (steamMatch) {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      const folderNorm = normalize(steamMatch[1])
      const steamApps = db
        .prepare<[], { id: number; display_name: string; group_id: number | null }>(
          "SELECT id, display_name, group_id FROM apps WHERE exe_name LIKE 'steam:%'"
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

  // ── Step 3: Version-string stripping ─────────────────────────────────────
  const candidate = stripVersionSuffixes(lowerExe).toLowerCase()
  if (!candidate || candidate.length < 3) return null

  const existingGroups = db
    .prepare<[], { id: number; name: string }>('SELECT id, name FROM app_groups')
    .all()

  // ── Step 4: Levenshtein similarity ───────────────────────────────────────
  let bestMatch: { id: number; dist: number } | null = null

  for (const group of existingGroups) {
    const dist = normalizedDistance(candidate, group.name.toLowerCase())
    if (dist <= 0.25 && (!bestMatch || dist < bestMatch.dist)) {
      bestMatch = { id: group.id, dist }
    }
  }

  if (bestMatch) return bestMatch.id

  // ── Step 5: Check if multiple apps share the same candidate base name ─────
  const siblingsCount = db
    .prepare<[string], { count: number }>(
      `SELECT COUNT(*) as count FROM apps
       WHERE lower(replace(exe_name, '.exe', '')) LIKE ?`
    )
    .get(`${candidate}%`)

  if ((siblingsCount?.count ?? 0) >= 2) {
    // Auto-create a group for this family
    const groupName = candidate
      .split(/[\s\-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    return ensureGroup(groupName, now)
  }

  return null
}

/**
 * Re-runs auto-grouping for all apps that don't have a manual group assignment.
 */
export async function reanalyzeGroups(): Promise<void> {
  invalidateGroupCache()
  const db = getDb()

  // Find apps whose group was set by auto-grouping (not manual)
  const apps = db
    .prepare<[], { id: number; exe_name: string; exe_path: string | null; group_id: number | null }>(
      `SELECT id, exe_name, exe_path, group_id FROM apps`
    )
    .all()

  const updateGroup = db.prepare<[number | null, number], void>(
    'UPDATE apps SET group_id = ? WHERE id = ?'
  )

  const updateAll = db.transaction(async () => {
    for (const app of apps) {
      // Only re-analyze if not a manual rule
      const hasManualRule = db
        .prepare<[number], { count: number }>(
          `SELECT COUNT(*) as count FROM group_rules gr
           JOIN app_groups ag ON ag.id = gr.group_id
           WHERE gr.is_manual = 1 AND ag.id = ?`
        )
        .get(app.group_id ?? -1)

      if (!hasManualRule || hasManualRule.count === 0) {
        const groupId = await resolveGroup(app.exe_name, app.exe_path)
        updateGroup.run(groupId, app.id)
      }
    }
  })

  await updateAll()
}
