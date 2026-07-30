import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { AudioRecordingDestination } from '../../application/ports'

export class ElectronRecordingDestination implements AudioRecordingDestination {
  async choose(defaultName: string) {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'Gravação WebM', extensions: ['webm'] }] })
    return result.canceled ? null : result.filePath ?? null
  }

  write(path: string, bytes: Uint8Array) { return writeFile(path, bytes) }
}
