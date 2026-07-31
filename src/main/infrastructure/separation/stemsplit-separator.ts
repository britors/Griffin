import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { OutputType, Quality, StemKey, StemSplit as StemSplitClient } from '@stemsplit/sdk'
import type { AudioTrack } from '../../../shared/domain/audio-track'
import { ALL_STEMS, CORE_STEMS, type SeparationModelProfile, type SeparationProfile, type SeparationProgress, type SeparationStatus, type StemName } from '../../../shared/types'
import type { SecretStore, StemSeparator } from '../../application/ports'
import { AudioFileDecoder } from '../audio/audio-file-decoder'
import { hashAudioFile, FileStemCache } from './stem-cache'

export const STEMSPLIT_API_KEY_SECRET = 'stemsplit.apiKey'
const API_KEY_SECRET = STEMSPLIT_API_KEY_SECRET
const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_DURATION_SECONDS = 60 * 60
const POLL_INTERVAL_MS = 2_500

const qualityByProfile: Record<SeparationProfile, Quality> = { speed: 'FAST', balanced: 'BALANCED', quality: 'BEST' }

// @stemsplit/sdk ships ESM-only ("exports": { "import": ... }, no "require"). The
// Keep the SDK lazy so opening the app does not allocate cloud-provider resources.
type StemSplitModule = typeof import('@stemsplit/sdk')

/** Sends the track to the StemSplit cloud API and caches the returned stems locally. */
export class StemSplitSeparator implements StemSeparator {
  private readonly cache: FileStemCache
  private readonly decoder = new AudioFileDecoder()
  private readonly cancelled = new Set<string>()
  private processingProfile: SeparationProfile = 'quality'
  private modelProfile: SeparationModelProfile = 'four-stem'
  private sdkPromise: Promise<StemSplitModule> | null = null

  constructor(cacheDirectory: string, private readonly secretStore: SecretStore) {
    this.cache = new FileStemCache(join(cacheDirectory, 'remote'))
  }

  async init() { await this.cache.init() }
  cancel(trackId: string) { this.cancelled.add(trackId) }
  setProcessingProfile(profile: SeparationProfile) { this.processingProfile = profile }
  setModelProfile(profile: SeparationModelProfile) { this.modelProfile = profile }

  private sdk() {
    this.sdkPromise ??= import('@stemsplit/sdk')
    return this.sdkPromise
  }

  async status(): Promise<SeparationStatus> {
    const key = await this.secretStore.get(API_KEY_SECRET)
    return key
      ? { available: true, message: 'Provedor remoto StemSplit configurado.' }
      : { available: false, message: 'Nenhuma chave de API do StemSplit configurada.' }
  }

  async separate(track: AudioTrack, report: (progress: SeparationProgress) => void, target?: StemName) {
    const apiKey = await this.secretStore.get(API_KEY_SECRET)
    if (!apiKey) throw new Error('Configure uma chave de API do StemSplit em Preferências antes de separar na nuvem.')

    const stemNames = target ? [target] : this.modelProfile === 'six-stem' ? ALL_STEMS : CORE_STEMS
    const key = `${await hashAudioFile(track.path)}-${this.modelProfile}-${target ?? 'all'}`
    const cached = await this.cache.get(key, stemNames)
    if (cached) return cached

    await this.assertWithinLimits(track.path)
    this.cancelled.delete(track.id)
    report({ trackId: track.id, progress: 0.02, stage: 'Enviando áudio para o StemSplit' })

    const sdk = await this.sdk()
    const client = new sdk.StemSplit({ apiKey })
    const outputType = this.resolveOutputType(target)
    try {
      const job = await client.jobs.create({ audio: track.path, outputType, quality: qualityByProfile[this.processingProfile], outputFormat: 'WAV' })
      const done = await this.pollUntilDone(sdk, client, job.id, track.id, report)
      if (this.cancelled.has(track.id)) throw new Error('Separação cancelada.')
      const outputs = done.outputs
      if (!outputs) throw new Error('O StemSplit não retornou os arquivos separados.')
      const stems = await this.downloadStems(outputs, stemNames)
      await this.cache.write(key, stems, stemNames)
      report({ trackId: track.id, progress: 1, stage: 'Stems prontos' })
      return this.cache.paths(key, stemNames)
    } catch (error) {
      throw this.toFriendlyError(sdk, error)
    }
  }

  private resolveOutputType(target?: StemName): OutputType {
    if (target === 'guitar' || target === 'piano') return 'SIX_STEMS'
    if (!target) return this.modelProfile === 'six-stem' ? 'SIX_STEMS' : 'FOUR_STEMS'
    return 'FOUR_STEMS'
  }

  private async pollUntilDone(sdk: StemSplitModule, client: StemSplitClient, jobId: string, trackId: string, report: (progress: SeparationProgress) => void) {
    while (true) {
      if (this.cancelled.has(trackId)) throw new Error('Separação cancelada.')
      const job = await client.jobs.get(jobId)
      const raw = job.raw
      if (raw.status === 'COMPLETED') return raw
      if (raw.status === 'FAILED') throw new sdk.JobFailedError(jobId, 'errorMessage' in raw ? raw.errorMessage : null)
      if (raw.status === 'EXPIRED') throw new sdk.JobExpiredError(jobId)
      report({ trackId, progress: Math.min(0.95, 0.05 + (raw.progress / 100) * 0.9), stage: raw.status === 'PROCESSING' ? 'Separando na nuvem' : 'Aguardando na fila do StemSplit' })
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }

  private async downloadStems(outputs: Partial<Record<StemKey, { url: string }>>, stemNames: StemName[]) {
    const entries = await Promise.all(stemNames.map(async (stem) => {
      const output = outputs[stem]
      if (!output) throw new Error(`O StemSplit não retornou o stem "${stem}".`)
      const response = await fetch(output.url)
      if (!response.ok) throw new Error(`Falha ao baixar o stem "${stem}" do StemSplit: HTTP ${response.status}.`)
      return [stem, new Uint8Array(await response.arrayBuffer())] as const
    }))
    return Object.fromEntries(entries) as Partial<Record<StemName, Uint8Array>>
  }

  private async assertWithinLimits(path: string) {
    const { size } = await stat(path)
    if (size > MAX_FILE_BYTES) throw new Error('O arquivo excede o limite de 100 MB do StemSplit.')
    const decoded = await this.decoder.decode(await readFile(path))
    const duration = decoded.channelData[0].length / decoded.sampleRate
    if (duration > MAX_DURATION_SECONDS) throw new Error('A faixa excede o limite de 60 minutos do StemSplit.')
  }

  private toFriendlyError(sdk: StemSplitModule, error: unknown) {
    if (error instanceof sdk.AuthenticationError) return new Error('Chave de API do StemSplit inválida ou revogada. Verifique em Preferências.')
    if (error instanceof sdk.InsufficientCreditsError) return new Error(`Créditos insuficientes no StemSplit (faltam ${error.requiredSeconds ?? '?'}s).${error.purchaseUrl ? ` Compre créditos em ${error.purchaseUrl}.` : ''}`)
    if (error instanceof sdk.RateLimitError) return new Error(`Limite de requisições do StemSplit atingido. Tente novamente em ${error.retryAfter ?? 'alguns'}s.`)
    if (error instanceof sdk.JobFailedError) return new Error(`O StemSplit falhou ao separar a faixa: ${error.errorMessage ?? 'erro desconhecido'}.`)
    if (error instanceof sdk.JobExpiredError) return new Error('O job do StemSplit expirou antes de concluir.')
    if (error instanceof sdk.NetworkError) return new Error('Sem conexão com o StemSplit. Verifique sua internet.')
    if (error instanceof sdk.StemSplitError) return new Error(error.message)
    return error instanceof Error ? error : new Error('Falha desconhecida na separação remota.')
  }
}
