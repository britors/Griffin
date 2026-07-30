import { dialog } from 'electron'
import type { AudioFilePicker } from '../../application/ports'

export class ElectronAudioPicker implements AudioFilePicker {
  async pick() {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Áudio', extensions: ['wav', 'mp3', 'flac'] }] })
    return result.canceled ? null : result.filePaths[0] ?? null
  }
}
