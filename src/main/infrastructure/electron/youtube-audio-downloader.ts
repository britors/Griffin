import { createHash, randomUUID } from 'node:crypto'
import { execFile as executeFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { YoutubeAudioDownloader } from '../../application/ports'
import type { RemoteAudioAsset, YoutubeAudioPreview } from '../../../shared/types'

const execFile = promisify(executeFile)
const MAX_BYTES = 200 * 1024 * 1024
const TIMEOUT_MS = 120_000
const MODEL_VERSION = 'htdemucs-ft-v1'

export class ElectronYoutubeAudioDownloader implements YoutubeAudioDownloader {
  async inspect(rawUrl: string): Promise<YoutubeAudioPreview> {
    const url = validateYoutubeUrl(rawUrl)
    const { stdout } = await runYtDlp(['--dump-single-json', '--skip-download', '--no-playlist', url], 30_000)
    let metadata: { title?: string; duration?: number }
    try { metadata = JSON.parse(stdout) as typeof metadata } catch { throw new Error('O YouTube não retornou metadados válidos.') }
    return { id: randomUUID(), url, title: metadata.title?.trim() || 'Áudio do YouTube', duration: metadata.duration, format: 'wav' }
  }

  async download(rawUrl: string): Promise<RemoteAudioAsset> {
    const url = validateYoutubeUrl(rawUrl)
    const sourceHash = createHash('sha256').update(url).digest('hex')
    const directory = await mkdtemp(join(tmpdir(), 'griffin-youtube-'))
    const tempPath = join(directory, `${sourceHash.slice(0, 16)}.wav`)
    try {
      await runYtDlp(['--no-playlist', '--no-part', '--no-overwrites', '--extract-audio', '--audio-format', 'wav', '--audio-quality', '0', '--output', tempPath, url], TIMEOUT_MS)
      const file = await stat(tempPath)
      if (file.size > MAX_BYTES) throw new Error('O áudio do YouTube excede o limite de 200 MB.')
      const bytes = await readFile(tempPath)
      const mediaHash = createHash('sha256').update(bytes).digest('hex')
      return { id: randomUUID(), url, tempPath, fileName: `${sourceHash.slice(0, 16)}.wav`, format: 'wav', sizeBytes: file.size, sourceHash, mediaHash, cacheKey: `${sourceHash}:${mediaHash}:${MODEL_VERSION}` }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw normalizeYtDlpError(error)
    }
  }

  cleanup(asset: RemoteAudioAsset) { return rm(join(asset.tempPath, '..'), { recursive: true, force: true }) }
}

async function runYtDlp(args: string[], timeout: number) {
  try { return await execFile('yt-dlp', args, { timeout, maxBuffer: 2 * 1024 * 1024 }) }
  catch (error) { throw normalizeYtDlpError(error) }
}

function validateYoutubeUrl(rawUrl: string) {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { throw new Error('URL do YouTube inválida.') }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (!['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host) || parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Use uma URL HTTPS pública do YouTube, sem credenciais.')
  if (host !== 'youtu.be' && !parsed.searchParams.has('v') && !parsed.pathname.startsWith('/shorts/')) throw new Error('Informe um link direto de vídeo do YouTube, sem playlist.')
  if (parsed.searchParams.has('list')) throw new Error('Playlists do YouTube não são suportadas.')
  return parsed.toString()
}

function normalizeYtDlpError(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return new Error('yt-dlp não está instalado. Instale-o separadamente para habilitar a importação autorizada do YouTube.')
  if (error && typeof error === 'object' && 'killed' in error && error.killed) return new Error('A consulta ao YouTube expirou.')
  return error instanceof Error ? error : new Error('Não foi possível consultar o YouTube.')
}
