import type { TrackAnalysisApplicationService } from '../../application/analysis-service'
import type { TrackAnalysis } from '../../../shared/types'

export function registerAnalysisHandlers(service: TrackAnalysisApplicationService) {
  return {
    analyze: (_event: unknown, id: string) => service.analyze(id),
    update: (_event: unknown, id: string, changes: Partial<TrackAnalysis>) => service.update(id, changes),
  }
}
