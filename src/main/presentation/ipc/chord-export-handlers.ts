import type { ChordExportApplicationService } from '../../application/chord-export-service'
import type { ChordExportFormat } from '../../../shared/types'

export function registerChordExportHandlers(service: ChordExportApplicationService) {
  return { export: (_event: unknown, trackId: string, format: ChordExportFormat) => service.export(trackId, format) }
}
