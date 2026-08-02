import type { SeparationProgress, SeparationProvider, SeparationStatus, StemName, Track } from '../../shared/types'
import type { StemSeparator, TrackRepository } from './ports'

export class SeparationApplicationService {
  constructor(private readonly repository: TrackRepository, private readonly localSeparator: StemSeparator, private readonly remoteSeparator: StemSeparator) {}

  status(): Promise<SeparationStatus> { return this.localSeparator.status() }

  async start(snapshot: Track, report: (progress: SeparationProgress) => void, target?: StemName, provider: SeparationProvider = 'local'): Promise<Track> {
    const track = await this.repository.findById(snapshot.id)
    if (!track) throw new Error('Faixa não encontrada na biblioteca.')
    const separator = provider === 'remote' ? this.remoteSeparator : this.localSeparator
    const stems = await separator.separate(track, report, target)
    track.attachStems(stems)
    return (await this.repository.save(track)).snapshot()
  }

  cancel(trackId: string) {
    this.localSeparator.cancel(trackId)
    this.remoteSeparator.cancel(trackId)
  }
}
