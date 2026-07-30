import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { YoutubeAudioDownloader } from './ports'
import type { Track, YoutubeAudioPreview } from '../../shared/types'
import type { LibraryApplicationService } from './library-service'

export class YoutubeImportApplicationService {
  private readonly previews = new Map<string, YoutubeAudioPreview>()

  constructor(private readonly downloader: YoutubeAudioDownloader, private readonly library: LibraryApplicationService, private readonly importDirectory: string) {}

  async preview(url: string) {
    const preview = await this.downloader.inspect(url)
    this.previews.set(preview.id, preview)
    return preview
  }

  async import(previewId: string): Promise<Track> {
    const preview = this.previews.get(previewId)
    if (!preview) throw new Error('A prévia do YouTube expirou. Consulte o link novamente.')
    const asset = await this.downloader.download(preview.url)
    try {
      await mkdir(this.importDirectory, { recursive: true })
      const permanentPath = join(this.importDirectory, `${safeFileName(preview.title)}-${asset.mediaHash.slice(0, 12)}.wav`)
      await copyFile(asset.tempPath, permanentPath)
      const track = await this.library.import(permanentPath)
      if (!track) throw new Error('O áudio do YouTube não pôde ser importado.')
      return track
    } finally {
      this.previews.delete(previewId)
      await this.downloader.cleanup(asset)
    }
  }

  cancel(previewId: string) { this.previews.delete(previewId); return Promise.resolve() }
}

function safeFileName(title: string) {
  const normalized = title.normalize('NFKD').replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-')
  return (normalized || 'audio-do-youtube').slice(0, 100)
}
