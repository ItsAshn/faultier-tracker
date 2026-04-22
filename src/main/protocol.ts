import { protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb, isDbOpen } from './db/client'
import { extractAndCacheIcon, toFsPath } from './icons/iconExtractor'

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

function getContentType(fsPath: string): string {
  const ext = path.extname(fsPath).toLowerCase().replace('.', '')
  return MIME_MAP[ext] ?? 'image/png'
}

async function resolveAppIconPath(appId: number): Promise<string | null> {
  if (!isDbOpen()) return null
  const db = getDb()
  const row = db
    .prepare<[number], { exe_path: string | null; icon_cache_path: string | null; custom_image_path: string | null }>(
      'SELECT exe_path, icon_cache_path, custom_image_path FROM apps WHERE id = ?',
    )
    .get(appId)
  if (!row) return null

  const customPath = toFsPath(row.custom_image_path)
  if (customPath && fs.existsSync(customPath)) return customPath

  const cachedPath = toFsPath(row.icon_cache_path)
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath

  if (row.exe_path) {
    const extractedPath = await extractAndCacheIcon(appId, row.exe_path)
    if (!isDbOpen()) return extractedPath
    if (extractedPath) {
      db.prepare<[string, number]>('UPDATE apps SET icon_cache_path = ? WHERE id = ?').run(extractedPath, appId)
      return extractedPath
    }
  }
  return null
}

async function resolveGroupIconPath(groupId: number): Promise<string | null> {
  if (!isDbOpen()) return null
  const db = getDb()
  const group = db
    .prepare<[number], { icon_cache_path: string | null; custom_image_path: string | null }>(
      'SELECT icon_cache_path, custom_image_path FROM app_groups WHERE id = ?',
    )
    .get(groupId)
  if (!group) return null

  const customPath = toFsPath(group.custom_image_path)
  if (customPath && fs.existsSync(customPath)) return customPath

  const cachedPath = toFsPath(group.icon_cache_path)
  if (cachedPath && fs.existsSync(cachedPath)) return cachedPath

  const member = db
    .prepare<[number], { id: number; exe_path: string | null; icon_cache_path: string | null }>(
      'SELECT id, exe_path, icon_cache_path FROM apps WHERE group_id = ? AND exe_path IS NOT NULL LIMIT 1',
    )
    .get(groupId)

  if (member) {
    const memberCachedPath = toFsPath(member.icon_cache_path)
    if (memberCachedPath && fs.existsSync(memberCachedPath)) return memberCachedPath

    if (member.exe_path) {
      const extractedPath = await extractAndCacheIcon(member.id, member.exe_path)
      if (!isDbOpen()) return extractedPath
      if (extractedPath) {
        db.prepare<[string, number]>('UPDATE apps SET icon_cache_path = ? WHERE id = ?').run(extractedPath, member.id)
        db.prepare<[string, number]>('UPDATE app_groups SET icon_cache_path = ? WHERE id = ?').run(extractedPath, groupId)
        return extractedPath
      }
    }
  }
  return null
}

export function registerIconProtocol(): void {
  protocol.handle('kioku', async (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)

      if (parts.length < 3 || parts[0] !== 'icon') {
        return new Response('Not found', { status: 404 })
      }

      const type = parts[1]
      const id = parseInt(parts[2], 10)
      if (isNaN(id) || (type !== 'app' && type !== 'group')) {
        return new Response('Bad request', { status: 400 })
      }

      const iconPath = type === 'group'
        ? await resolveGroupIconPath(id)
        : await resolveAppIconPath(id)

      if (!iconPath) {
        return new Response('No icon', { status: 404 })
      }

      const data = await fs.promises.readFile(iconPath)
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': getContentType(iconPath),
          'Cache-Control': 'public, max-age=300',
        },
      })
    } catch (err) {
      console.error('[Protocol] Error serving icon:', err)
      return new Response('Internal error', { status: 500 })
    }
  })
}