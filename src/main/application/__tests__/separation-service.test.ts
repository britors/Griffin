import { describe, expect, it } from 'vitest'
import { AudioTrack } from '../../../shared/domain/audio-track'
import type { SeparationProgress, SeparationStatus, StemName, Track } from '../../../shared/types'
import type { StemSeparator, TrackRepository } from '../ports'
import { SeparationApplicationService } from '../separation-service'

class InMemoryTrackRepository implements TrackRepository {
  constructor(private readonly tracks: AudioTrack[]) {}
  async init() {}
  async list() { return this.tracks }
  async findById(id: string) { return this.tracks.find((track) => track.id === id) ?? null }
  async findByPath(path: string) { return this.tracks.find((track) => track.path === path) ?? null }
  async save(track: AudioTrack) { return track }
  async remove(_id: string) {}
}

class FixedStemSeparator implements StemSeparator {
  target: StemName | undefined
  async init() {}
  async status(): Promise<SeparationStatus> { return { available: true, message: 'ok' } }
  async separate(_track: AudioTrack, _report: (progress: SeparationProgress) => void, target?: StemName) {
    this.target = target
    return { vocals: '/cache/vocals.wav' } satisfies Partial<Record<StemName, string>>
  }
  cancel(_trackId: string) {}
}

describe('SeparationApplicationService', () => {
  it('passes the selected stem and preserves stems already attached to the track', async () => {
    const track = AudioTrack.restore({ id: 'track-1', name: 'song.wav', path: '/music/song.wav', importedAt: 'now', stems: { drums: '/cache/drums.wav' } } satisfies Track)
    const separator = new FixedStemSeparator()
    const service = new SeparationApplicationService(new InMemoryTrackRepository([track]), separator, new FixedStemSeparator())

    const result = await service.start(track.snapshot(), () => undefined, 'vocals')

    expect(separator.target).toBe('vocals')
    expect(result.stems).toEqual({ drums: '/cache/drums.wav', vocals: '/cache/vocals.wav' })
  })
})
