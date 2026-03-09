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
    console.log('[Tracker] get-windows loaded successfully')
  } catch (err) {
    console.error('[Tracker] get-windows FAILED to load — active window tracking disabled. Error:', err)
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
  if (!_activeWindow) {
    console.log('[Tracker] getActiveApp: _activeWindow is null, returning null')
    return null
  }
  try {
    const result = await _activeWindow()
    if (!result) {
      console.log('[Tracker] getActiveApp: result is undefined/null')
      return null
    }
    const rawPath = result.owner.path ?? ''
    const exeName = rawPath
      ? rawPath.split(/[\\/]/).pop() ?? result.owner.name
      : result.owner.name
    console.log('[Tracker] getActiveApp: found', exeName, 'pid=', result.owner.processId, 'title=', result.title.substring(0, 50))
    return {
      exeName: exeName.toLowerCase(),
      exePath: rawPath || null,
      windowTitle: result.title,
      pid: result.owner.processId
    }
  } catch (err) {
    console.error('[Tracker] getActiveApp: exception:', err)
    return null
  }
}
