import { app, nativeImage } from 'electron'
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
export function toFsPath(stored: string | null): string | null {
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
 */
export async function extractAndCacheIcon(appId: number, exePath: string): Promise<string | null> {
  ensureDirs()

  const cachePath = path.join(ICON_CACHE_DIR, `${appId}.png`)
  if (fs.existsSync(cachePath)) {
    return cachePath
  }

  try {
    const nativeImage = await app.getFileIcon(exePath, { size: 'large' })
    if (nativeImage.isEmpty()) return null

    const png = nativeImage.toPNG()
    fs.writeFileSync(cachePath, png)
    return cachePath
  } catch {
    return null
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

const MAX_DIMENSION = 600

/**
 * Downscales an image buffer if either dimension exceeds MAX_DIMENSION.
 * Returns the (possibly downscaled) buffer encoded in the specified format.
 * If the buffer cannot be decoded or is already small enough, returns the
 * re-encoded buffer (normalised to ext format).
 */
export function downscaleBuffer(buf: Buffer, ext: string): Buffer {
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) return buf

  const { width, height } = img.getSize()
  if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
    if (ext === 'jpg' || ext === 'jpeg') return img.toJPEG(85)
    return img.toPNG()
  }

  const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
  const resized = img.resize({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    quality: 'best',
  })

  if (ext === 'jpg' || ext === 'jpeg') return resized.toJPEG(85)
  return resized.toPNG()
}

/**
 * Saves a user-supplied base64 image for an app, downscaling if necessary.
 * Returns the filesystem path of the saved file.
 */
export function saveCustomImage(appId: number, base64Data: string, ext = 'png'): string {
  ensureDirs()

  const filePath = path.join(USER_IMAGE_DIR, `${appId}.${ext}`)
  const raw = Buffer.from(base64Data.replace(/^data:[^;]+;base64,/, ''), 'base64')
  const processed = downscaleBuffer(raw, ext)
  fs.writeFileSync(filePath, processed)
  return filePath
}

export function clearCustomImage(appId: number): void {
  ensureDirs()
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
    const p = path.join(USER_IMAGE_DIR, `${appId}.${ext}`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}
