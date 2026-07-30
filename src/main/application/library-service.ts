import { randomUUID } from 'node:crypto'
import type { AudioTrack } from '../../shared/domain/audio-track'
import { AudioTrack as TrackAggregate } from '../../shared/domain/audio-track'
import type { AudioFileGateway, AudioFilePicker, TrackRepository } from './ports'

export class LibraryApplicationService {
  constructor(
    private readonly repository: TrackRepository,
    private readonly audioFiles: AudioFileGateway,
    private readonly picker: AudioFilePicker,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async list() { return (await this.repository.list()).map((track) => track.snapshot()) }

  async import(path?: string) {
    const selectedPath = path ?? await this.picker.pick()
    if (!selectedPath || !this.audioFiles.isSupported(selectedPath)) return null
    const existing = await this.repository.findByPath(selectedPath)
    if (existing) return existing.snapshot()
    const metadata = await this.audioFiles.describe(selectedPath)
    const track = TrackAggregate.import({ id: randomUUID(), name: metadata.name, path: selectedPath, importedAt: this.now() })
    return (await this.repository.save(track)).snapshot()
  }

  async importMany(paths?: string[]) {
    const selectedPaths = paths ?? await this.picker.pickMany()
    const imported = await Promise.all(selectedPaths.map((path) => this.import(path)))
    return imported.filter((track): track is NonNullable<typeof track> => Boolean(track))
  }

  async read(path: string) {
    const track = await this.repository.findByPath(path)
    if (!track && !(await this.repository.list()).some((item) => Object.values(item.stems ?? {}).includes(path))) throw new Error('Arquivo de áudio não pertence à biblioteca.')
    return this.audioFiles.read(path)
  }

  // The library entry is removed, while separation cache files remain reusable and recoverable.
  async remove(id: string) { await this.repository.remove(id) }

  async find(id: string): Promise<AudioTrack | null> { return this.repository.findById(id) }
}
