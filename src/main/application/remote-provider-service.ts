import { readFile } from 'node:fs/promises'
import type { RemoteCostEstimate, RemoteSeparationStatus } from '../../shared/types'
import type { SecretStore, TrackRepository } from './ports'
import { STEMSPLIT_API_KEY_SECRET } from '../infrastructure/separation/stemsplit-separator'
import { AudioFileDecoder } from '../infrastructure/audio/audio-file-decoder'

const COST_PER_MINUTE_USD = 0.1

export class RemoteProviderApplicationService {
  private readonly decoder = new AudioFileDecoder()

  constructor(private readonly secretStore: SecretStore, private readonly trackRepository: TrackRepository) {}

  async status(): Promise<RemoteSeparationStatus> {
    const key = await this.secretStore.get(STEMSPLIT_API_KEY_SECRET)
    if (!key) return { configured: false, verified: false, message: 'Nenhuma chave de API configurada.' }
    try {
      const { StemSplit } = await import('@stemsplit/sdk')
      const balance = await new StemSplit({ apiKey: key }).account.get()
      return { configured: true, verified: true, balanceFormatted: balance.balanceFormatted, message: `Conectado ao StemSplit — saldo: ${balance.balanceFormatted}.` }
    } catch (error) {
      const { AuthenticationError } = await import('@stemsplit/sdk')
      return { configured: true, verified: false, message: error instanceof AuthenticationError ? 'Chave de API inválida ou revogada.' : 'Não foi possível verificar a chave agora. Tente novamente.' }
    }
  }

  async saveApiKey(key: string) {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('Informe uma chave de API válida.')
    await this.secretStore.set(STEMSPLIT_API_KEY_SECRET, trimmed)
    return this.status()
  }

  async clearApiKey() {
    await this.secretStore.remove(STEMSPLIT_API_KEY_SECRET)
    return this.status()
  }

  async estimateCost(trackId: string): Promise<RemoteCostEstimate> {
    const track = await this.trackRepository.findById(trackId)
    if (!track) throw new Error('Faixa não encontrada na biblioteca.')
    const decoded = await this.decoder.decode(await readFile(track.path))
    const durationSeconds = decoded.channelData[0].length / decoded.sampleRate
    return { durationSeconds, estimatedUsd: (durationSeconds / 60) * COST_PER_MINUTE_USD }
  }
}
