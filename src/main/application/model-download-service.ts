import type { ModelDownloader } from './ports'
import type { ModelDownloadKind, ModelDownloadProgress } from '../../shared/types'

export class ModelDownloadApplicationService {
  private downloading: ModelDownloadKind | null = null
  private controller: AbortController | null = null

  constructor(private readonly downloader: ModelDownloader) {}

  async status() {
    const status = await this.downloader.status()
    return { ...status, downloading: this.downloading }
  }

  async download(kind: ModelDownloadKind, report: (progress: ModelDownloadProgress) => void) {
    if (this.downloading) throw new Error('Já existe um download de modelo em andamento.')
    this.downloading = kind
    this.controller = new AbortController()
    try {
      await this.downloader.download(kind, report, this.controller.signal)
    } finally {
      this.downloading = null
      this.controller = null
    }
  }

  cancel(kind: ModelDownloadKind) {
    if (this.downloading === kind) this.controller?.abort()
    return Promise.resolve()
  }
}
