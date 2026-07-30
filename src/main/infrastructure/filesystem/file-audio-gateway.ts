import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AudioFileGateway } from '../../application/ports'

const supportedExtensions = ['.wav', '.mp3', '.flac']

export class FileAudioGateway implements AudioFileGateway {
  isSupported(path: string) { return supportedExtensions.some((extension) => path.toLowerCase().endsWith(extension)) }
  async describe(path: string) { await stat(path); return { name: basename(path) } }
  read(path: string) { return readFile(path) }
}
