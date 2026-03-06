import { net, BrowserWindow } from 'electron'
import { getDb, getSetting } from '../db/client'
import { saveCustomImage } from '../icons/iconExtractor'
import { searchSteamGridDB } from './artworkProvider'
import { CHANNELS } from '@shared/channels'

export async function autoFetchSteamArtwork(): Promise<void> {
  const apiKey = getSetting('steamgriddb_api_key') as string | null
  if (!apiKey) {
    console.log('[AutoFetch] skipping artwork fetch — no steamgriddb_api_key configured')
    return
  }

  const db = getDb()
  const rows = db
    .prepare<[], { id: number; display_name: string }>(
      "SELECT id, display_name FROM apps WHERE exe_name LIKE 'steam:%' AND custom_image_path IS NULL"
    )
    .all()

  if (!rows.length) {
    console.log('[AutoFetch] no Steam apps without artwork found, nothing to fetch')
    return
  }

  console.log(`[AutoFetch] fetching artwork for ${rows.length} Steam app(s):`, rows.map(r => `"${r.display_name}"`).join(', '))

  let anyFetched = false

  for (const row of rows) {
    try {
      console.log(`[AutoFetch] searching SteamGridDB for "${row.display_name}" (id=${row.id})...`)
      const results = await searchSteamGridDB(row.display_name, apiKey, 'grids')
      console.log(`[AutoFetch] "${row.display_name}": ${results.length} result(s) from SteamGridDB`)
      // Prefer portrait (height > width); fall back to first result
      const pick = results.find((r) => r.height > r.width) ?? results[0]
      if (!pick) {
        console.warn(`[AutoFetch] "${row.display_name}": no suitable image found, skipping`)
        continue
      }

      console.log(`[AutoFetch] "${row.display_name}": downloading ${pick.url}`)
      const res = await net.fetch(pick.url)
      if (!res.ok) {
        console.warn(`[AutoFetch] "${row.display_name}": image download failed (HTTP ${res.status})`)
        continue
      }

      const mime = (res.headers.get('content-type') ?? 'image/png').split(';')[0].trim()
      const extMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      }
      const ext = extMap[mime] ?? 'png'
      const buf = Buffer.from(await res.arrayBuffer())
      const base64 = `data:${mime};base64,${buf.toString('base64')}`
      const fsPath = saveCustomImage(row.id, base64, ext)

      db.prepare<[string, number], void>(
        'UPDATE apps SET custom_image_path = ? WHERE id = ?'
      ).run(fsPath, row.id)

      anyFetched = true
      console.log(`[AutoFetch] saved artwork for "${row.display_name}" -> ${fsPath}`)
    } catch (err) {
      console.warn(`[AutoFetch] failed for "${row.display_name}":`, err)
      // Silently skip — don't let one failure block others
    }

    // Polite rate-limit: 300ms between requests
    await new Promise<void>((r) => setTimeout(r, 300))
  }

  if (anyFetched) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.APPS_ARTWORK_UPDATED)
    })
    console.log('[AutoFetch] artwork update complete, notified renderer')
  } else {
    console.log('[AutoFetch] no new artwork was saved')
  }
}
