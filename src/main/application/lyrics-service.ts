import type { LyricsLine, Track } from '../../shared/types'
import type { TrackRepository } from './ports'

export class LyricsApplicationService {
  constructor(private readonly repository: TrackRepository) {}

  async get(id: string): Promise<LyricsLine[]> {
    const track = await this.repository.findById(id)
    if (!track) throw new Error('Faixa não encontrada.')
    return track.snapshot().lyrics ?? []
  }

  async update(id: string, lyrics: LyricsLine[]): Promise<Track> {
    const track = await this.repository.findById(id)
    if (!track) throw new Error('Faixa não encontrada.')
    track.attachLyrics(normalizeLyrics(lyrics))
    return (await this.repository.save(track)).snapshot()
  }
}

function normalizeLyrics(lines: LyricsLine[]): LyricsLine[] {
  return lines.map((line, index) => ({ id: line.id || `line-${index + 1}`, text: line.text.trim(), start: Math.max(0, Math.min(1, line.start)), end: Math.max(0, Math.min(1, line.end)) })).filter((line) => line.text.length > 0 && line.end > line.start)
}
