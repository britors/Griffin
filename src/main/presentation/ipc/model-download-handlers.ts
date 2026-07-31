import { ipcMain, type WebContents } from 'electron'
import type { ModelDownloadApplicationService } from '../../application/model-download-service'
import type { ModelDownloadKind } from '../../../shared/types'

export function registerModelDownloadHandlers(service: ModelDownloadApplicationService, getWebContents: () => WebContents | undefined) {
  ipcMain.handle('models:status', () => service.status())
  ipcMain.handle('models:download', (_event, kind: ModelDownloadKind) => service.download(kind, (progress) => getWebContents()?.send('models:progress', progress)))
  ipcMain.handle('models:cancel', (_event, kind: ModelDownloadKind) => service.cancel(kind))
}
