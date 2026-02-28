import { net, BrowserWindow } from 'electron'
import { getDb, getSetting } from '../db/client'
import { saveCustomImage } from '../icons/iconExtractor'
import { searchSteamGridDB } from './artworkProvider'
import { CHANNELS } from '@shared/channels'

export async function autoFetchSteamArtwork(): Promise<void> {
  const apiKey = getSetting('steamgriddb_api_key') as string | null
  if (!apiKey) return

  const db = getDb()
  const rows = db
    .prepare<[], { id: number; display_name: string }>(
      "SELECT id, display_name FROM apps WHERE exe_name LIKE 'steam:%' AND custom_image_path IS NULL"
    )
    .all()

  if (!rows.length) return

  console.log(`[AutoFetch] Fetching artwork for ${rows.length} Steam app(s)`)

  let anyFetched = false

  for (const row of rows) {
    try {
      const results = await searchSteamGridDB(row.display_name, apiKey, 'grids')
      // Prefer portrait (height > width); fall back to first result
      const pick = results.find((r) => r.height > r.width) ?? results[0]
      if (!pick) continue

      const res = await net.fetch(pick.url)
      if (!res.ok) continue

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
      console.log(`[AutoFetch] Saved artwork for "${row.display_name}"`)
    } catch (err) {
      console.warn(`[AutoFetch] Failed for "${row.display_name}":`, err)
      // Silently skip — don't let one failure block others
    }

    // Polite rate-limit: 300ms between requests
    await new Promise<void>((r) => setTimeout(r, 300))
  }

  if (anyFetched) {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.APPS_ARTWORK_UPDATED)
    })
    console.log('[AutoFetch] Artwork update complete, notified renderer')
  }
}
