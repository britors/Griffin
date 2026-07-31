import { ipcMain } from 'electron'
import type { RemoteProviderApplicationService } from '../../application/remote-provider-service'

export function registerRemoteProviderHandlers(service: RemoteProviderApplicationService) {
  ipcMain.handle('remote-provider:status', () => service.status())
  ipcMain.handle('remote-provider:save-key', (_event, key: string) => service.saveApiKey(key))
  ipcMain.handle('remote-provider:clear-key', () => service.clearApiKey())
  ipcMain.handle('remote-provider:estimate-cost', (_event, trackId: string) => service.estimateCost(trackId))
}
