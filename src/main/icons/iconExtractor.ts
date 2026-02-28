import { app } from 'electron'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const ICON_CACHE_DIR = path.join(app.getPath('userData'), 'icon-cache')
const USER_IMAGE_DIR = path.join(app.getPath('userData'), 'user-images')

function ensureDirs(): void {
  fs.mkdirSync(ICON_CACHE_DIR, { recursive: true })
  fs.mkdirSync(USER_IMAGE_DIR, { recursive: true })
}

/**
 * Converts a stored path (either a legacy "file://…" URL or a plain FS path)
 * to a proper filesystem path, or null if the file doesn't exist.
 */
function toFsPath(stored: string | null): string | null {
  if (!stored) return null
  if (stored.startsWith('file:')) {
    try {
      return fileURLToPath(stored)
    } catch {
      // Strip protocol manually for malformed URLs
      return stored.replace(/^file:\/\/\/?/, '')
    }
  }
  return stored
}

/**
 * Reads a stored icon path (file:// URL or plain FS path) and returns a
 * base64 data URL suitable for use as an <img src>.  Returns null if the
 * file cannot be read.
 */
export function readFileAsDataUrl(stored: string | null): string | null {
  const fsPath = toFsPath(stored)
  if (!fsPath) return null
  try {
    if (!fs.existsSync(fsPath)) return null
    const data = fs.readFileSync(fsPath)
    // Detect mime type from file extension
    const ext = path.extname(fsPath).toLowerCase().replace('.', '')
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'
    }
    const mime = mimeMap[ext] ?? 'image/png'
    return `data:${mime};base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * Extracts and caches the icon for an app exe.
 * Returns the plain filesystem path of the cached PNG, or null on failure.
 * (Callers must convert to a data URL via readFileAsDataUrl before sending
 * to the renderer.)
 */
export async function extractAndCacheIcon(appId: number, exePath: string): Promise<string | null> {
  ensureDirs()

  const cachePath = path.join(ICON_CACHE_DIR, `${appId}.png`)
  if (fs.existsSync(cachePath)) {
    return cachePath
  }

  try {
    const nativeImage = await app.getFileIcon(exePath, { size: 'jumbo' })
    if (nativeImage.isEmpty()) return null

    const png = nativeImage.toPNG()
    fs.writeFileSync(cachePath, png)
    return cachePath
  } catch {
    return null
  }
}

/**
 * Saves a user-supplied base64 image for an app.
 * Returns the plain filesystem path of the saved file.
 */
export function saveCustomImage(appId: number, base64Data: string, ext = 'png'): string {
  ensureDirs()

  const filePath = path.join(USER_IMAGE_DIR, `${appId}.${ext}`)
  const data = base64Data.replace(/^data:[^;]+;base64,/, '')
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'))
  return filePath
}

/**
 * Removes the custom image for an app.
 */
export function clearCustomImage(appId: number): void {
  ensureDirs()
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
    const p = path.join(USER_IMAGE_DIR, `${appId}.${ext}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}

/**
 * Resolves the best icon filesystem path for an app.
 * Returns null if nothing is cached yet.
 */
export function resolveIconPath(customImagePath: string | null, iconCachePath: string | null): string | null {
  const custom = toFsPath(customImagePath)
  if (custom && fs.existsSync(custom)) return custom

  const cached = toFsPath(iconCachePath)
  if (cached && fs.existsSync(cached)) return cached

  return null
}
