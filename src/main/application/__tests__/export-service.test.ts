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
  receivedHistory: Array<Record<StemName, string>> = []
  async render(stems: Record<StemName, string>, _options: AudioExportOptions, _report: (progress: number, stage: string) => void, _isCancelled: () => boolean) {
    this.received = stems
    this.receivedHistory.push(stems)
    return { bytes: new Uint8Array([82, 73, 70, 70]), duration: 2.5 }
  }
}

class FixedDestination implements AudioExportDestination {
  written: { path: string; bytes: Uint8Array } | null = null
  async choose(defaultName: string) { return `/exports/${defaultName}` }
  async chooseDirectory() { return '/exports' }
  async write(path: string, bytes: Uint8Array) { this.written = { path, bytes } }
}

const options: AudioExportOptions = {
  stems: ['vocals', 'drums', 'bass', 'other'],
  volumes: { vocals: 0.8, drums: 0.8, bass: 0.8, other: 0.8 },
  pans: { vocals: 0, drums: 0, bass: 0, other: 0 },
  routes: { vocals: 'stereo', drums: 'stereo', bass: 'stereo', other: 'stereo' },
  equalizer: { vocals: Array(12).fill(0), drums: Array(12).fill(0), bass: Array(12).fill(0), other: Array(12).fill(0) },
  sampleRate: 44100,
  bitDepth: 16,
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

  it('exports extended stems selected from a six-stem separation', async () => {
    const track = AudioTrack.restore({ id: 'track-1', name: 'Song.wav', path: '/music/song.wav', importedAt: 'now', stems: { guitar: '/stems/guitar.wav', piano: '/stems/piano.wav' } })
    const processor = new FixedProcessor()
    const service = new AudioExportApplicationService(new InMemoryTrackRepository(track), processor, new FixedDestination())

    await service.export(track.id, { ...options, stems: ['guitar'] })

    expect(processor.received).toEqual({ guitar: '/stems/guitar.wav' })
  })

  it('exports all six stems individually when the extended separation is complete', async () => {
    const track = AudioTrack.restore({
      id: 'track-1',
      name: 'Song.wav',
      path: '/music/song.wav',
      importedAt: 'now',
      stems: {
        vocals: '/stems/vocals.wav',
        drums: '/stems/drums.wav',
        bass: '/stems/bass.wav',
        other: '/stems/other.wav',
        guitar: '/stems/guitar.wav',
        piano: '/stems/piano.wav',
      },
    })
    const processor = new FixedProcessor()
    const destination = new FixedDestination()
    const service = new AudioExportApplicationService(new InMemoryTrackRepository(track), processor, destination)
    const extendedOptions = {
      ...options,
      mode: 'individual' as const,
      stems: ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'] as StemName[],
      volumes: { ...options.volumes, guitar: 0.8, piano: 0.8 },
      pans: { ...options.pans, guitar: 0, piano: 0 },
      routes: { ...options.routes, guitar: 'stereo' as const, piano: 'stereo' as const },
      equalizer: { ...options.equalizer, guitar: Array(12).fill(0), piano: Array(12).fill(0) },
      muted: { ...options.muted, guitar: false, piano: false },
    }

    const result = await service.export(track.id, extendedOptions)

    expect(processor.receivedHistory).toHaveLength(6)
    expect(result.paths).toHaveLength(6)
    expect(result.paths.map((path) => path.split('/').pop())).toEqual([
      'Song - Vocal.wav',
      'Song - Bateria.wav',
      'Song - Baixo.wav',
      'Song - Outros.wav',
      'Song - Guitarra.wav',
      'Song - Piano.wav',
    ])
  })

  it('reports clearly when a compressed encoder is unavailable', async () => {
    const track = AudioTrack.restore({ id: 'track-1', name: 'Song.wav', path: '/music/song.wav', importedAt: 'now', stems: { vocals: '/stems/vocals.wav', drums: '/stems/drums.wav', bass: '/stems/bass.wav', other: '/stems/other.wav' } })
    const service = new AudioExportApplicationService(new InMemoryTrackRepository(track), new FixedProcessor(), new FixedDestination())

    await expect(service.export(track.id, { ...options, format: 'mp3' })).rejects.toThrow('Use WAV PCM')
  })

  it('exports each selected stem into a separate file', async () => {
    const track = AudioTrack.restore({ id: 'track-1', name: 'Song.wav', path: '/music/song.wav', importedAt: 'now', stems: { vocals: '/stems/vocals.wav', drums: '/stems/drums.wav', bass: '/stems/bass.wav', other: '/stems/other.wav' } })
    const processor = new FixedProcessor()
    const destination = new FixedDestination()
    const service = new AudioExportApplicationService(new InMemoryTrackRepository(track), processor, destination)

    const result = await service.export(track.id, { ...options, mode: 'individual', stems: ['vocals', 'bass'] })

    expect(processor.receivedHistory).toEqual([{ vocals: '/stems/vocals.wav' }, { bass: '/stems/bass.wav' }])
    expect(result.paths).toEqual(['/exports/Song - Vocal.wav', '/exports/Song - Baixo.wav'])
  })
})
