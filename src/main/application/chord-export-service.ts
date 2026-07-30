import type { ChordExportFormat, ChordExportResult } from '../../shared/types'
import type { ChordExportDestination, ChordNotationExporter, TrackRepository } from './ports'

export class ChordExportApplicationService {
  constructor(private readonly repository: TrackRepository, private readonly exporter: ChordNotationExporter, private readonly destination: ChordExportDestination) {}

  async export(trackId: string, format: ChordExportFormat): Promise<ChordExportResult> {
    const track = await this.repository.findById(trackId)
    if (!track) throw new Error('Faixa não encontrada na biblioteca.')
    const snapshot = track.snapshot()
    const chords = snapshot.analysis?.chords ?? []
    if (chords.length === 0) throw new Error('Analise a faixa e confirme os acordes antes de exportar.')
    const bytes = this.exporter.render(chords, snapshot.analysis?.bpm ?? 120, snapshot.duration ?? 60, format)
    const path = await this.destination.choose(defaultName(snapshot.name, format), format)
    if (!path) throw new Error('Exportação cancelada.')
    await this.destination.write(path, bytes)
    return { path, format }
  }
}

function defaultName(name: string, format: ChordExportFormat) {
  const base = name.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'griffin-chords'
  return `${base} - acordes.${format === 'midi' ? 'mid' : 'pdf'}`
}
