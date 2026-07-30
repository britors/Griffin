import { dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { ChordExportDestination } from '../../application/ports'
import type { ChordExportFormat } from '../../../shared/types'

export class ElectronChordExportDestination implements ChordExportDestination {
  async choose(defaultName: string, format: ChordExportFormat) {
    const result = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: format === 'midi' ? 'MIDI' : 'PDF', extensions: [format === 'midi' ? 'mid' : 'pdf'] }] })
    return result.canceled ? null : result.filePath ?? null
  }
  write(path: string, bytes: Uint8Array) { return writeFile(path, bytes) }
}
