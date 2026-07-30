import type { LyricsApplicationService } from '../../application/lyrics-service'
import type { LyricsLine } from '../../../shared/types'

export function registerLyricsHandlers(service: LyricsApplicationService) {
  return {
    get: (_event: unknown, id: string) => service.get(id),
    update: (_event: unknown, id: string, lines: LyricsLine[]) => service.update(id, lines),
  }
}
