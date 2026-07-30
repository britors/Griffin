import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { RemoteAudioDownloader } from '../../application/ports'
import type { RemoteAudioAsset } from '../../../shared/types'
import { AudioFileDecoder } from '../audio/audio-file-decoder'

const MAX_BYTES = 200 * 1024 * 1024
const TIMEOUT_MS = 30_000
const MODEL_VERSION = 'htdemucs-ft-v1'
const formats = new Set(['.wav', '.mp3', '.flac'])

export class ElectronRemoteAudioDownloader implements RemoteAudioDownloader {
  private readonly decoder = new AudioFileDecoder()

  async download(rawUrl: string, signal?: AbortSignal): Promise<RemoteAudioAsset> {
    const url = await validateRemoteUrl(rawUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    const directory = await mkdtemp(join(tmpdir(), 'griffin-audio-'))
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
      if (!response.ok) throw new Error(`A fonte respondeu HTTP ${response.status}.`)
      const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? ''
      const extension = detectExtension(url, contentType)
      if (!extension) throw new Error('A URL não aponta para WAV, MP3 ou FLAC suportado.')
      const expected = Number(response.headers.get('content-length') ?? 0)
      if (expected > MAX_BYTES) throw new Error('O arquivo remoto excede o limite de 200 MB.')
      if (!response.body) throw new Error('A fonte não retornou conteúdo de áudio.')
      const chunks: Uint8Array[] = []
      let size = 0
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength
        if (size > MAX_BYTES) throw new Error('O arquivo remoto excede o limite de 200 MB.')
        chunks.push(chunk)
      }
      const bytes = Buffer.concat(chunks)
      const mediaHash = createHash('sha256').update(bytes).digest('hex')
      const sourceHash = createHash('sha256').update(url).digest('hex')
      const fileName = `remote-${sourceHash.slice(0, 16)}${extension}`
      const tempPath = join(directory, fileName)
      await writeFile(tempPath, bytes)
      let duration: number | undefined
      try { const decoded = await this.decoder.decode(bytes); duration = decoded.channelData[0].length / decoded.sampleRate } catch { /* metadata is optional */ }
      return { id: randomUUID(), url, tempPath, fileName, format: extension.slice(1) as RemoteAudioAsset['format'], sizeBytes: size, duration, sourceHash, mediaHash, cacheKey: `${sourceHash}:${mediaHash}:${MODEL_VERSION}` }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('Download remoto cancelado ou expirado.')
      throw error
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  cleanup(asset: RemoteAudioAsset) { return rm(join(asset.tempPath, '..'), { recursive: true, force: true }) }
}

async function validateRemoteUrl(rawUrl: string) {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { throw new Error('URL inválida.') }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use uma URL HTTP/HTTPS pública sem credenciais.')
  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || isPrivateIp(host)) throw new Error('Fontes locais ou privadas não são permitidas.')
  const addresses = await lookup(host, { all: true }).catch(() => [])
  if (addresses.some(({ address }) => isPrivateIp(address))) throw new Error('A fonte resolve para uma rede privada e foi bloqueada.')
  return parsed.toString()
}

function detectExtension(url: string, contentType: string) {
  const extension = extname(new URL(url).pathname).toLowerCase()
  if (formats.has(extension)) return extension
  if (contentType === 'audio/wav' || contentType === 'audio/x-wav') return '.wav'
  if (contentType === 'audio/mpeg') return '.mp3'
  if (contentType === 'audio/flac' || contentType === 'audio/x-flac') return '.flac'
  return null
}

function isPrivateIp(value: string) {
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true
  const octets = value.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254)
}
