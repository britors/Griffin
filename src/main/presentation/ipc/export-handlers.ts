import type { AudioExportApplicationService } from '../../application/export-service'
import type { AudioExportOptions } from '../../../shared/types'

export function registerExportHandlers(service: AudioExportApplicationService) {
  return {
    audio: (_event: unknown, trackId: string, options: AudioExportOptions) => service.export(trackId, options),
  }
}
