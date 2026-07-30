import type { AudioExportOptions, AudioExportResult, StemName, Track } from '../../shared/types'
import type { AudioExportDestination, AudioExportProcessor, TrackRepository } from './ports'

const stemNames: StemName[] = ['vocals', 'drums', 'bass', 'other']

export class AudioExportApplicationService {
  private readonly cancelled = new Set<string>()
  constructor(
    private readonly repository: TrackRepository,
    private readonly processor: AudioExportProcessor,
    private readonly destination: AudioExportDestination,
  ) {}

  async export(trackId: string, options: AudioExportOptions, report: (progress: number, stage: string) => void = () => {}): Promise<AudioExportResult> {
    const track = await this.repository.findById(trackId)
    if (!track) throw new Error('Faixa não encontrada na biblioteca.')
    const snapshot = track.snapshot()
    if (!snapshot.stems) throw new Error('Separe os stems antes de exportar uma mixagem.')
    if (options.format !== 'wav') throw new Error('O formato WAV é o único formato disponível nesta versão.')

    const activeStems = this.resolveStems(snapshot, options)
    const stems = Object.fromEntries(activeStems.map((stem) => [stem, snapshot.stems![stem]])) as Record<StemName, string>
    const requestId = options.requestId ?? `${trackId}-${Date.now()}`
    try {
      const rendered = await this.processor.render(stems, options, report, () => this.cancelled.has(requestId))
      if (this.cancelled.has(requestId)) throw new Error('Exportação cancelada.')
      const path = await this.destination.choose(defaultExportName(snapshot))
      if (!path) throw new Error('Exportação cancelada.')
      await this.destination.write(path, rendered.bytes)
      return { path, duration: rendered.duration, format: 'wav', sampleRate: options.sampleRate, bitDepth: options.bitDepth }
    } finally { this.cancelled.delete(requestId) }
  }

  cancel(requestId: string) { this.cancelled.add(requestId) }

  private resolveStems(track: Track, options: AudioExportOptions): StemName[] {
    const requested = stemNames.filter((stem) => options.stems.includes(stem) && Boolean(track.stems?.[stem]))
    const selected = options.solo ? requested.filter((stem) => stem === options.solo) : requested.filter((stem) => !options.muted[stem])
    if (selected.length === 0) throw new Error('Selecione ao menos um stem audível para exportar.')
    return selected
  }
}

function defaultExportName(track: Track) {
  const name = track.name.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'griffin-mix'
  return `${name} - Griffin Mix.wav`
}
