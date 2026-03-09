// Wraps the ps-list package (ESM-only) via dynamic import.
// Returns the set of exe names currently running as processes.

type PsListFn = () => Promise<Array<{ name: string; pid: number; ppid: number }>>

let _psList: PsListFn | null = null

export async function initPsList(): Promise<void> {
  try {
    const mod = await import('ps-list')
    _psList = mod.default as PsListFn
    console.log('[Tracker] ps-list loaded successfully')
  } catch (err) {
    console.error('[Tracker] ps-list FAILED to load — process tracking disabled. Error:', err)
    _psList = null
  }
}

export interface RunningProcess {
  exeName: string
  pid: number
}

export async function getRunningProcesses(): Promise<RunningProcess[]> {
  if (!_psList) {
    console.log('[Tracker] getRunningProcesses: _psList is null, returning empty array')
    return []
  }

  try {
    const list = await _psList()
    console.log('[Tracker] getRunningProcesses: found', list.length, 'processes')
    if (list.length > 0 && list.length <= 10) {
      console.log('[Tracker] getRunningProcesses: processes =', list.map(p => p.name).join(', '))
    } else if (list.length > 10) {
      console.log('[Tracker] getRunningProcesses: first 10 =', list.slice(0, 10).map(p => p.name).join(', '), '...')
    }
    return list.map((p) => ({
      exeName: p.name.toLowerCase(),
      pid: p.pid
    }))
  } catch (err) {
    console.error('[Tracker] getRunningProcesses: exception:', err)
    return []
  }
}
