import { execSync, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

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
let _platform: 'windows' | 'linux-wayland-hyprland' | 'linux-wayland-generic' | 'linux-x11' | 'macos' | 'unsupported' = 'unsupported'

/**
 * Detect the current platform and window system
 */
function detectPlatform(): void {
  if (process.platform === 'win32') {
    _platform = 'windows'
    console.log('[Tracker] Platform detected: Windows')
  } else if (process.platform === 'darwin') {
    _platform = 'macos'
    console.log('[Tracker] Platform detected: macOS')
  } else if (process.platform === 'linux') {
    // Check for Wayland
    const waylandDisplay = process.env.WAYLAND_DISPLAY
    const xdgSessionType = process.env.XDG_SESSION_TYPE
    
    if (waylandDisplay || xdgSessionType === 'wayland') {
      // Check for specific compositors
      if (isHyprland()) {
        _platform = 'linux-wayland-hyprland'
        console.log('[Tracker] Platform detected: Linux (Wayland - Hyprland)')
      } else {
        _platform = 'linux-wayland-generic'
        console.log('[Tracker] Platform detected: Linux (Wayland - Generic)')
      }
    } else {
      _platform = 'linux-x11'
      console.log('[Tracker] Platform detected: Linux (X11)')
    }
  } else {
    _platform = 'unsupported'
    console.log('[Tracker] Platform detected: Unsupported -', process.platform)
  }
}

/**
 * Check if running on Hyprland
 */
function isHyprland(): boolean {
  const hyprlandSig = process.env.HYPRLAND_INSTANCE_SIGNATURE
  if (hyprlandSig) return true
  
  // Try to check via command
  try {
    execSync('which hyprctl', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Get active window info on Hyprland using hyprctl
 */
async function getHyprlandActiveWindow(): Promise<ActiveWindowResult | undefined> {
  try {
    const { stdout } = await execFileAsync('hyprctl', ['activewindow', '-j'], { timeout: 2000 })
    const data = JSON.parse(stdout)
    
    if (!data || !data.class) return undefined
    
    // Get PID from initialClass or try to find it
    let pid = data.pid || 0
    let path = data.execPath || ''
    
    // If no path provided, try to get it from /proc
    if (!path && pid) {
      try {
        path = execSync(`readlink -f /proc/${pid}/exe`, { encoding: 'utf8', timeout: 1000 }).trim()
      } catch {
        // Ignore
      }
    }
    
    return {
      title: data.title || data.initialTitle || 'Unknown',
      id: data.address ? parseInt(data.address, 16) : 0,
      owner: {
        name: data.class || data.initialClass || 'Unknown',
        processId: pid,
        path: path
      }
    }
  } catch (err) {
    console.error('[Tracker] Hyprland detection failed:', err)
    return undefined
  }
}

/**
 * Get active window info on generic Wayland
 * Tries multiple methods: swaymsg, wlroots-compatible
 */
async function getGenericWaylandActiveWindow(): Promise<ActiveWindowResult | undefined> {
  // Try swaymsg first (Sway compositor)
  try {
    const { stdout } = await execFileAsync('swaymsg', ['-t', 'get_tree'], { timeout: 2000 })
    const tree = JSON.parse(stdout)
    
    // Find focused window in the tree
    const focused = findFocusedWindow(tree)
    if (focused) {
      const pid = focused.pid || focused.app_id ? 0 : 0
      let path = ''
      
      if (pid) {
        try {
          path = execSync(`readlink -f /proc/${pid}/exe`, { encoding: 'utf8', timeout: 1000 }).trim()
        } catch {
          // Ignore
        }
      }
      
      return {
        title: focused.name || focused.app_id || 'Unknown',
        id: focused.id || 0,
        owner: {
          name: focused.app_id || focused.window_properties?.class || 'Unknown',
          processId: pid,
          path: path
        }
      }
    }
  } catch {
    // swaymsg not available or failed
  }
  
  return undefined
}

/**
 * Recursively find focused window in Sway tree
 */
function findFocusedWindow(node: any): any | null {
  if (node.focused && node.pid) {
    return node
  }
  
  if (node.nodes) {
    for (const child of node.nodes) {
      const result = findFocusedWindow(child)
      if (result) return result
    }
  }
  
  if (node.floating_nodes) {
    for (const child of node.floating_nodes) {
      const result = findFocusedWindow(child)
      if (result) return result
    }
  }
  
  return null
}

/**
 * Get active window info on X11 using xdotool
 */
async function getX11ActiveWindow(): Promise<ActiveWindowResult | undefined> {
  try {
    // Get active window ID
    const { stdout: windowId } = await execFileAsync('xdotool', ['getactivewindow'], { timeout: 2000 })
    const id = parseInt(windowId.trim(), 10)
    
    if (!id) return undefined
    
    // Get window title
    const { stdout: title } = await execFileAsync('xdotool', ['getwindowname', id.toString()], { timeout: 2000 })
    
    // Get PID
    const { stdout: pidStr } = await execFileAsync('xdotool', ['getwindowpid', id.toString()], { timeout: 2000 })
    const pid = parseInt(pidStr.trim(), 10)
    
    // Get process info
    let name = 'Unknown'
    let path = ''
    
    if (pid) {
      try {
        path = execSync(`readlink -f /proc/${pid}/exe`, { encoding: 'utf8', timeout: 1000 }).trim()
        name = execSync(`cat /proc/${pid}/comm`, { encoding: 'utf8', timeout: 1000 }).trim()
      } catch {
        // Ignore
      }
    }
    
    return {
      title: title.trim() || name,
      id: id,
      owner: {
        name: name,
        processId: pid || 0,
        path: path
      }
    }
  } catch (err) {
    console.error('[Tracker] X11 detection failed:', err)
    return undefined
  }
}

/**
 * Initialize Windows get-windows with timeout
 */
async function initWindows(): Promise<void> {
  try {
    // Add 5-second timeout to prevent infinite hangs
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('get-windows timeout')), 5000)
    )
    const importPromise = import('get-windows')
    
    const mod = await Promise.race([importPromise, timeoutPromise])
    _activeWindow = (mod.activeWindow ?? (mod as any).default) as ActiveWindowFn
    console.log('[Tracker] get-windows loaded successfully')
  } catch (err) {
    console.error('[Tracker] get-windows FAILED to load — active window tracking disabled. Error:', err)
    _activeWindow = null
  }
}

export async function initActiveWin(): Promise<void> {
  detectPlatform()
  
  switch (_platform) {
    case 'windows':
      await initWindows()
      break
      
    case 'linux-wayland-hyprland':
      _activeWindow = getHyprlandActiveWindow
      console.log('[Tracker] Using Hyprland native detection')
      break
      
    case 'linux-wayland-generic':
      _activeWindow = getGenericWaylandActiveWindow
      console.log('[Tracker] Using generic Wayland detection')
      break
      
    case 'linux-x11':
      _activeWindow = getX11ActiveWindow
      console.log('[Tracker] Using X11 detection')
      break
      
    case 'macos':
      // macOS can use get-windows
      await initWindows()
      break
      
    default:
      console.log('[Tracker] Active window tracking not supported on this platform')
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