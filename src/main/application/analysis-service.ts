import { AudioTrack } from '../../shared/domain/audio-track'
import type { Track, TrackAnalysis } from '../../shared/types'
import type { AudioAnalyzer, AudioFileGateway, TrackRepository } from './ports'

export class TrackAnalysisApplicationService {
  constructor(
    private readonly repository: TrackRepository,
    private readonly audioFiles: AudioFileGateway,
    private readonly analyzer: AudioAnalyzer,
  ) {}

  async analyze(id: string): Promise<Track> {
    const current = await this.repository.findById(id)
    if (!current) throw new Error('Faixa não encontrada.')
    if (current.snapshot().analysis) return current.snapshot()
    const analysis = await this.analyzer.analyze(await this.audioFiles.read(current.path))
    current.attachAnalysis(analysis)
    return (await this.repository.save(current)).snapshot()
  }

  async update(id: string, changes: Partial<TrackAnalysis>): Promise<Track> {
    const current = await this.repository.findById(id)
    if (!current) throw new Error('Faixa não encontrada.')
    const existing = current.snapshot().analysis ?? { bpm: 120, key: 'C maior', tuningHz: 440, confidence: 0 }
    current.attachAnalysis({
      bpm: clampNumber(changes.bpm ?? existing.bpm, 30, 300),
      key: changes.key?.trim() || existing.key,
      tuningHz: clampNumber(changes.tuningHz ?? existing.tuningHz, 430, 450),
      confidence: existing.confidence,
    })
    return (await this.repository.save(current)).snapshot()
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}
