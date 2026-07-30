import { BrowserWindow, ipcMain } from 'electron'

export function registerWindowHandlers(): void {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:toggle-maximize', (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    if (!currentWindow) return false

    if (currentWindow.isMaximized()) currentWindow.unmaximize()
    else currentWindow.maximize()

    return currentWindow.isMaximized()
  })

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}
