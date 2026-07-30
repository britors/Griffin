import type { PerformanceSaveResult } from '../../shared/types'
import type { AudioRecordingDestination } from './ports'

export class PerformanceApplicationService {
  constructor(private readonly destination: AudioRecordingDestination) {}

  async save(name: string, bytes: Uint8Array): Promise<PerformanceSaveResult> {
    if (bytes.byteLength === 0) throw new Error('A gravação não contém áudio.')
    const normalizedName = name.trim().replace(/[\\/:*?"<>|]/g, '-') || 'take'
    const path = await this.destination.choose(`${normalizedName}.webm`)
    if (!path) throw new Error('Salvamento cancelado.')
    await this.destination.write(path, bytes)
    return { path, name: normalizedName }
  }
}
