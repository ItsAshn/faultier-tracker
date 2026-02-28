import { app, BrowserWindow } from 'electron'
import { openDb, closeDb } from './db/client'
import { createWindow } from './window'
import { createTray, destroyTray } from './tray'
import { registerIpcHandlers } from './ipc/handlers'
import { startTracker, stopTracker } from './tracking/tracker'
import { closeAllSessions } from './tracking/sessionManager'
import { initUpdater } from './updater'

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

app.on('second-instance', () => {
  // Focus the existing window when user tries to open a second instance
  const wins = BrowserWindow.getAllWindows()
  if (wins[0]) {
    if (wins[0].isMinimized()) wins[0].restore()
    wins[0].show()
    wins[0].focus()
  }
})

app.whenReady().then(async () => {
  await openDb()

  const win = createWindow()
  createTray(win)
  registerIpcHandlers()
  initUpdater()

  await startTracker()

  // Show window after everything is ready
  win.once('ready-to-show', () => {
    win.show()
  })
})

app.on('before-quit', () => {
  closeAllSessions(Date.now())
  stopTracker()
  destroyTray()
  closeDb()
})

// On macOS, keep the app running when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // On Windows/Linux, we hide to tray rather than quitting (handled by window.ts)
    // so this event fires rarely; just don't quit here.
  }
})

app.on('activate', () => {
  // On macOS, re-create window when dock icon is clicked with no open windows
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createWindow()
    win.show()
  }
})
