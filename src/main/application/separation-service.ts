import type { SeparationProgress, SeparationStatus, StemName, Track } from '../../shared/types'
import type { StemSeparator, TrackRepository } from './ports'

export class SeparationApplicationService {
  constructor(private readonly repository: TrackRepository, private readonly separator: StemSeparator) {}

  status(): Promise<SeparationStatus> { return this.separator.status() }

  async start(snapshot: Track, report: (progress: SeparationProgress) => void, target?: StemName): Promise<Track> {
    const track = await this.repository.findById(snapshot.id)
    if (!track) throw new Error('Faixa não encontrada na biblioteca.')
    const stems = await this.separator.separate(track, report, target)
    track.attachStems(stems)
    return (await this.repository.save(track)).snapshot()
  }

  cancel(trackId: string) { this.separator.cancel(trackId) }
}
