// Wraps get-windows (formerly active-win) via dynamic import (ESM-only package).

type ActiveWindowResult = {
  title: string
  id: number
  owner: {
    name: string
    processId: number
    path: string
  }
}

type ActiveWindowFn = () => Promise<ActiveWindowResult | undefined>

let _activeWindow: ActiveWindowFn | null = null

export async function initActiveWin(): Promise<void> {
  try {
    const mod = await import('get-windows')
    _activeWindow = (mod.activeWindow ?? (mod as any).default) as ActiveWindowFn
    console.log('[Tracker] get-windows loaded')
  } catch {
    console.warn('[Tracker] get-windows not available — active window tracking disabled')
    _activeWindow = null
  }
}

export interface ActiveAppInfo {
  exeName: string
  exePath: string | null
  windowTitle: string
  pid: number
}

export async function getActiveApp(): Promise<ActiveAppInfo | null> {
  if (!_activeWindow) return null
  try {
    const result = await _activeWindow()
    if (!result) return null
    const rawPath = result.owner.path ?? ''
    const exeName = rawPath
      ? rawPath.split(/[\\/]/).pop() ?? result.owner.name
      : result.owner.name
    return {
      exeName: exeName.toLowerCase(),
      exePath: rawPath || null,
      windowTitle: result.title,
      pid: result.owner.processId
    }
  } catch {
    return null
  }
}
