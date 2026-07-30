import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { STEM_LABELS, type AudioExportOptions, type AudioExportResult, type StemName, type Track } from '../../shared/types'
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
    if (options.format !== 'wav') throw new Error(`O formato ${options.format.toUpperCase()} exige um encoder local que ainda não está disponível. Use WAV PCM.`)

    const activeStems = this.resolveStems(snapshot, options)
    const stems = Object.fromEntries(activeStems.map((stem) => [stem, snapshot.stems![stem]])) as Record<StemName, string>
    const requestId = options.requestId ?? `${trackId}-${Date.now()}`
    try {
      if (options.mode === 'individual') return this.exportIndividual(snapshot, activeStems, options, report, requestId)
      const rendered = await this.processor.render(stems, options, report, () => this.cancelled.has(requestId))
      if (this.cancelled.has(requestId)) throw new Error('Exportação cancelada.')
      const path = await this.destination.choose(defaultExportName(snapshot))
      if (!path) throw new Error('Exportação cancelada.')
      await this.destination.write(path, rendered.bytes)
      return { path, paths: [path], duration: rendered.duration, format: 'wav', sampleRate: options.sampleRate, bitDepth: options.bitDepth }
    } finally { this.cancelled.delete(requestId) }
  }

  cancel(requestId: string) { this.cancelled.add(requestId) }

  private resolveStems(track: Track, options: AudioExportOptions): StemName[] {
    const requested = stemNames.filter((stem) => options.stems.includes(stem) && Boolean(track.stems?.[stem]))
    const selected = options.solo ? requested.filter((stem) => stem === options.solo) : requested.filter((stem) => !options.muted[stem])
    if (selected.length === 0) throw new Error('Selecione ao menos um stem audível para exportar.')
    return selected
  }

  private async exportIndividual(track: Track, stems: StemName[], options: AudioExportOptions, report: (progress: number, stage: string) => void, requestId: string): Promise<AudioExportResult> {
    const directory = await this.destination.chooseDirectory()
    if (!directory) throw new Error('Exportação cancelada.')
    const paths: string[] = []
    let duration = 0
    for (const [index, stem] of stems.entries()) {
      if (this.cancelled.has(requestId)) throw new Error('Exportação cancelada.')
      const stemOptions = { ...options, mode: 'mix' as const, stems: [stem], solo: null }
      const rendered = await this.processor.render({ [stem]: track.stems![stem] } as Record<StemName, string>, stemOptions, (progress, stage) => {
        report((index + progress) / stems.length, `${STEM_LABELS[stem]} · ${stage}`)
      }, () => this.cancelled.has(requestId))
      duration = rendered.duration
      const path = await nextAvailablePath(directory, `${baseExportName(track)} - ${STEM_LABELS[stem]}.wav`)
      await this.destination.write(path, rendered.bytes)
      paths.push(path)
    }
    report(1, 'Arquivos individuais concluídos')
    return { path: paths[0], paths, duration, format: 'wav', sampleRate: options.sampleRate, bitDepth: options.bitDepth }
  }
}

function defaultExportName(track: Track) {
  return `${baseExportName(track)} - Griffin Mix.wav`
}

function baseExportName(track: Track) {
  return track.name.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'griffin-mix'
}

async function nextAvailablePath(directory: string, fileName: string) {
  const initial = join(directory, fileName)
  try { await access(initial) } catch { return initial }
  const extension = '.wav'
  const base = fileName.slice(0, -extension.length)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = join(directory, `${base} (${index})${extension}`)
    try { await access(candidate) } catch { return candidate }
  }
  throw new Error('Não foi possível encontrar um nome de arquivo disponível.')
}
