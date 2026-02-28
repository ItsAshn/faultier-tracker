import { autoUpdater } from 'electron-updater'
import { ipcMain, app } from 'electron'
import { getMainWindow } from './window'
import { CHANNELS } from '@shared/channels'

export function initUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    getMainWindow()?.webContents.send(CHANNELS.UPDATE_AVAILABLE, {
      version: info.version,
      releaseNotes: info.releaseNotes ?? null,
    })
  })

  autoUpdater.on('update-not-available', () => {
    getMainWindow()?.webContents.send(CHANNELS.UPDATE_NOT_AVAILABLE)
  })

  autoUpdater.on('download-progress', (p) => {
    getMainWindow()?.webContents.send(CHANNELS.UPDATE_DOWNLOAD_PROGRESS, {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    getMainWindow()?.webContents.send(CHANNELS.UPDATE_DOWNLOADED, {
      version: info.version,
      releaseNotes: info.releaseNotes ?? null,
    })
  })

  autoUpdater.on('error', (err) => {
    // electron-updater error messages can include full HTTP headers — take only the first line
    const clean = err.message.split('\n')[0].trim()
    getMainWindow()?.webContents.send(CHANNELS.UPDATE_ERROR, clean)
  })

  ipcMain.handle(CHANNELS.UPDATE_CHECK, () => autoUpdater.checkForUpdates())
  ipcMain.handle(CHANNELS.UPDATE_DOWNLOAD, () => autoUpdater.downloadUpdate())
  ipcMain.handle(CHANNELS.UPDATE_QUIT_AND_INSTALL, () => autoUpdater.quitAndInstall(false, true))

  // Silent check 10s after launch so the window is fully shown first
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 10_000)
}
