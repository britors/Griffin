import { describe, expect, it } from 'vitest'
import { AudioTrack } from '../../../shared/domain/audio-track'
import type { AudioExportOptions, StemName } from '../../../shared/types'
import type { AudioExportDestination, AudioExportProcessor, TrackRepository } from '../ports'
import { AudioExportApplicationService } from '../export-service'

class InMemoryTrackRepository implements TrackRepository {
  constructor(private readonly track: AudioTrack) {}
  async init() {}
  async list() { return [this.track] }
  async findById(id: string) { return id === this.track.id ? this.track : null }
  async findByPath() { return null }
  async save(track: AudioTrack) { return track }
  async remove() {}
}

class FixedProcessor implements AudioExportProcessor {
  received: Record<StemName, string> | null = null
  async render(stems: Record<StemName, string>) {
    this.received = stems
    return { bytes: new Uint8Array([82, 73, 70, 70]), duration: 2.5 }
  }
}

class FixedDestination implements AudioExportDestination {
  written: { path: string; bytes: Uint8Array } | null = null
  async choose(defaultName: string) { return `/exports/${defaultName}` }
  async write(path: string, bytes: Uint8Array) { this.written = { path, bytes } }
}

const options: AudioExportOptions = {
  stems: ['vocals', 'drums', 'bass', 'other'],
  volumes: { vocals: 0.8, drums: 0.8, bass: 0.8, other: 0.8 },
  pans: { vocals: 0, drums: 0, bass: 0, other: 0 },
  muted: { vocals: false, drums: false, bass: false, other: false },
  solo: null,
  pitch: 0,
  tempo: 1,
  format: 'wav',
}

describe('AudioExportApplicationService', () => {
  it('exports the requested combination and preserves the destination result', async () => {
    const track = AudioTrack.restore({ id: 'track-1', name: 'Song.wav', path: '/music/song.wav', importedAt: 'now', stems: { vocals: '/stems/vocals.wav', drums: '/stems/drums.wav', bass: '/stems/bass.wav', other: '/stems/other.wav' } })
    const processor = new FixedProcessor()
    const destination = new FixedDestination()
    const service = new AudioExportApplicationService(new InMemoryTrackRepository(track), processor, destination)

    const result = await service.export(track.id, { ...options, stems: ['vocals', 'bass'], muted: { ...options.muted, bass: true } })

    expect(processor.received).toEqual({ vocals: '/stems/vocals.wav' })
    expect(destination.written?.path).toBe('/exports/Song - Griffin Mix.wav')
    expect(result).toMatchObject({ duration: 2.5, format: 'wav' })
  })

  it('uses solo as the final audible selection', async () => {
    const track = AudioTrack.restore({ id: 'track-1', name: 'Song.wav', path: '/music/song.wav', importedAt: 'now', stems: { vocals: '/stems/vocals.wav', drums: '/stems/drums.wav', bass: '/stems/bass.wav', other: '/stems/other.wav' } })
    const processor = new FixedProcessor()
    const service = new AudioExportApplicationService(new InMemoryTrackRepository(track), processor, new FixedDestination())

    await service.export(track.id, { ...options, solo: 'drums' })

    expect(processor.received).toEqual({ drums: '/stems/drums.wav' })
  })
})
