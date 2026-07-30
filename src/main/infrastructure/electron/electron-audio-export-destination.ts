import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { AudioExportDestination } from '../../application/ports'

export class ElectronAudioExportDestination implements AudioExportDestination {
  async choose(defaultName: string) {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'WAV', extensions: ['wav'] }],
    })
    return result.canceled ? null : result.filePath ?? null
  }

  write(path: string, bytes: Uint8Array) { return writeFile(path, bytes) }
}
