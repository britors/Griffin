import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RemoteAudioDownloader } from './ports'
import type { RemoteAudioAsset, RemoteAudioPreview, Track } from '../../shared/types'
import type { LibraryApplicationService } from './library-service'

export class RemoteAudioImportApplicationService {
  private readonly assets = new Map<string, RemoteAudioAsset>()

  constructor(private readonly downloader: RemoteAudioDownloader, private readonly library: LibraryApplicationService, private readonly importDirectory: string) {}

  async preview(url: string): Promise<RemoteAudioPreview> {
    const asset = await this.downloader.download(url)
    this.assets.set(asset.id, asset)
    const { tempPath: _tempPath, mediaHash: _mediaHash, ...preview } = asset
    return preview
  }

  async import(assetId: string): Promise<Track> {
    const asset = this.assets.get(assetId)
    if (!asset) throw new Error('A prévia remota expirou. Solicite uma nova prévia.')
    try {
      await mkdir(this.importDirectory, { recursive: true })
      const permanentPath = join(this.importDirectory, `${asset.mediaHash}.${asset.format}`)
      await copyFile(asset.tempPath, permanentPath)
      const track = await this.library.import(permanentPath)
      if (!track) throw new Error('O áudio remoto não pôde ser importado.')
      return track
    } finally {
      this.assets.delete(assetId)
      await this.downloader.cleanup(asset)
    }
  }

  async cancel(assetId: string) {
    const asset = this.assets.get(assetId)
    if (!asset) return
    this.assets.delete(assetId)
    await this.downloader.cleanup(asset)
  }
}
