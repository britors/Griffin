import { ipcMain, type WebContents } from 'electron'
import type { SeparationApplicationService } from '../../application/separation-service'
import type { SeparationProvider, StemName, Track } from '../../../shared/types'

export function registerSeparationHandlers(service: SeparationApplicationService, getWebContents: () => WebContents | undefined) {
  ipcMain.handle('separation:status', () => service.status())
  ipcMain.handle('separation:start', (_event, track: Track, target?: StemName, provider?: SeparationProvider) => service.start(track, (progress) => getWebContents()?.send('separation:progress', progress), target, provider))
  ipcMain.handle('separation:cancel', (_event, trackId: string) => service.cancel(trackId))
}
