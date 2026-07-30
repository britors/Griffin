import { describe, expect, it } from 'vitest'
import { AudioTrack } from '../../../shared/domain/audio-track'
import type { Track, TrackAnalysis } from '../../../shared/types'
import type { AudioAnalyzer, AudioFileGateway, TrackRepository } from '../ports'
import { TrackAnalysisApplicationService } from '../analysis-service'

class InMemoryTrackRepository implements TrackRepository {
  tracks: AudioTrack[] = []
  async init() {}
  async list() { return [...this.tracks] }
  async findById(id: string) { return this.tracks.find((track) => track.id === id) ?? null }
  async findByPath(path: string) { return this.tracks.find((track) => track.path === path) ?? null }
  async save(track: AudioTrack) { this.tracks = [track, ...this.tracks.filter((item) => item.id !== track.id)]; return track }
  async remove(id: string) { this.tracks = this.tracks.filter((track) => track.id !== id) }
}

class FixedAnalyzer implements AudioAnalyzer {
  calls = 0
  async analyze(): Promise<TrackAnalysis> { this.calls += 1; return { bpm: 120, key: 'C maior', tuningHz: 440, confidence: 0.8 } }
}

class FixedAudioFiles implements AudioFileGateway {
  isSupported() { return true }
  async describe() { return { name: 'song.wav' } }
  async read() { return new Uint8Array([1, 2, 3]) }
}

describe('TrackAnalysisApplicationService', () => {
  it('analyzes once, persists the result and supports manual corrections', async () => {
    const repository = new InMemoryTrackRepository()
    const analyzer = new FixedAnalyzer()
    const track = AudioTrack.import({ id: 'track-1', name: 'song.wav', path: '/music/song.wav', importedAt: 'now' })
    await repository.save(track)
    const service = new TrackAnalysisApplicationService(repository, new FixedAudioFiles(), analyzer)

    const analyzed = await service.analyze(track.id)
    await service.analyze(track.id)
    const corrected = await service.update(track.id, { bpm: 128, key: 'D maior' })

    expect(analyzed.analysis?.bpm).toBe(120)
    expect(corrected.analysis).toMatchObject({ bpm: 128, key: 'D maior', tuningHz: 440 })
    expect(analyzer.calls).toBe(1)
  })
})
