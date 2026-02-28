import { Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { closeAllSessions } from './tracking/sessionManager'

let tray: Tray | null = null

function createFallbackIcon(): Electron.NativeImage {
  // 16×16 RGBA solid teal square as fallback
  const SIZE = 16
  const data = Buffer.alloc(SIZE * SIZE * 4)
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4 + 0] = 94   // R
    data[i * 4 + 1] = 172  // G
    data[i * 4 + 2] = 180  // B
    data[i * 4 + 3] = 255  // A
  }
  return nativeImage.createFromBuffer(data, { width: SIZE, height: SIZE })
}

export function createTray(win: BrowserWindow): Tray {
  let icon: Electron.NativeImage

  const iconPath = path.join(__dirname, '../../resources/icon.png')
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  } else {
    icon = createFallbackIcon()
  }

  tray = new Tray(icon)
  tray.setToolTip('Faultier Tracker')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => showWindow(win)
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        closeAllSessions(Date.now())
        win.destroy()
        tray?.destroy()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => toggleWindow(win))

  return tray
}

function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function toggleWindow(win: BrowserWindow): void {
  if (win.isVisible()) {
    win.hide()
  } else {
    showWindow(win)
  }
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
