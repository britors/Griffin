import type { AudioExportApplicationService } from '../../application/export-service'
import type { AudioExportOptions } from '../../../shared/types'
import type { WebContents } from 'electron'

export function registerExportHandlers(service: AudioExportApplicationService, getWebContents: () => WebContents | undefined) {
  return {
    audio: (_event: unknown, trackId: string, options: AudioExportOptions) => service.export(trackId, options, (progress, stage) => getWebContents()?.send('export:progress', { requestId: options.requestId ?? trackId, progress, stage })),
    cancel: (_event: unknown, requestId: string) => service.cancel(requestId),
  }
}
