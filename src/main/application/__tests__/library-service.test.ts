import { describe, expect, it } from 'vitest'
import { AudioTrack } from '../../../shared/domain/audio-track'
import type { AudioFileGateway, AudioFilePicker, TrackRepository } from '../ports'
import { LibraryApplicationService } from '../library-service'

class InMemoryTrackRepository implements TrackRepository {
  tracks: AudioTrack[] = []
  async init() {}
  async list() { return [...this.tracks] }
  async findById(id: string) { return this.tracks.find((track) => track.id === id) ?? null }
  async findByPath(path: string) { return this.tracks.find((track) => track.path === path) ?? null }
  async save(track: AudioTrack) { this.tracks = [track, ...this.tracks.filter((item) => item.id !== track.id)]; return track }
  async remove(id: string) { this.tracks = this.tracks.filter((track) => track.id !== id) }
}

class InMemoryAudioFiles implements AudioFileGateway {
  isSupported(path: string) { return path.endsWith('.wav') }
  async describe(path: string) { return { name: path.split('/').pop()! } }
  async read() { return new Uint8Array([1, 2, 3]) }
}

class FixedPicker implements AudioFilePicker {
  constructor(private readonly path: string | null) {}
  async pick() { return this.path }
  async pickMany() { return this.path ? [this.path] : [] }
}

describe('LibraryApplicationService', () => {
  it('imports a supported track and avoids duplicates', async () => {
    const repository = new InMemoryTrackRepository()
    const service = new LibraryApplicationService(repository, new InMemoryAudioFiles(), new FixedPicker(null), () => '2026-01-01T00:00:00.000Z')
    const first = await service.import('/music/song.wav')
    const second = await service.import('/music/song.wav')

    expect(first?.name).toBe('song.wav')
    expect(second?.id).toBe(first?.id)
    expect(await service.list()).toHaveLength(1)
  })

  it('rejects unsupported files without touching the repository', async () => {
    const repository = new InMemoryTrackRepository()
    const service = new LibraryApplicationService(repository, new InMemoryAudioFiles(), new FixedPicker(null))

    expect(await service.import('/music/song.txt')).toBeNull()
    expect(await service.list()).toHaveLength(0)
  })

  it('removes only the requested library entry', async () => {
    const repository = new InMemoryTrackRepository()
    const service = new LibraryApplicationService(repository, new InMemoryAudioFiles(), new FixedPicker(null), () => '2026-01-01T00:00:00.000Z')
    const first = await service.import('/music/first.wav')
    await service.import('/music/second.wav')

    await service.remove(first!.id)

    expect((await service.list()).map((track) => track.name)).toEqual(['second.wav'])
  })

  it('keeps the aggregate responsible for stem assignment', () => {
    const track = AudioTrack.import({ id: 'track-1', name: 'song.wav', path: '/music/song.wav', importedAt: 'now' })
    track.attachStems({ vocals: '/cache/vocals.wav', drums: '/cache/drums.wav', bass: '/cache/bass.wav', other: '/cache/other.wav' })
    expect(track.snapshot().stems?.vocals).toBe('/cache/vocals.wav')
  })
})
