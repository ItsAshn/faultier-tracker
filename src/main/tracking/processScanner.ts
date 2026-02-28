// Wraps the ps-list package (ESM-only) via dynamic import.
// Returns the set of exe names currently running as processes.

type PsListFn = () => Promise<Array<{ name: string; pid: number; ppid: number }>>

let _psList: PsListFn | null = null

export async function initPsList(): Promise<void> {
  const mod = await import('ps-list')
  _psList = mod.default as PsListFn
}

export interface RunningProcess {
  exeName: string
  pid: number
}

export async function getRunningProcesses(): Promise<RunningProcess[]> {
  if (!_psList) return []

  try {
    const list = await _psList()
    return list.map((p) => ({
      exeName: p.name.toLowerCase(),
      pid: p.pid
    }))
  } catch {
    return []
  }
}
