import { access, readFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import type { AudioTrack } from '../../../shared/domain/audio-track'
import type { ExecutionProviderPreference, SeparationProgress, SeparationProfile, SeparationStatus, StemName } from '../../../shared/types'
import type { StemSeparator } from '../../application/ports'
import { AudioFileDecoder } from '../audio/audio-file-decoder'
import { resampleTo44100, toStereo } from '../audio/audio-resampler'
import { encodeStereoWav } from '../audio/wav-encoder'
import { hashAudioFile, FileStemCache } from './stem-cache'

const applicationStems: StemName[] = ['vocals', 'drums', 'bass', 'other']
const modelStemOrder: StemName[] = ['drums', 'bass', 'other', 'vocals']
const sampleRate = 44100
const chunkSize = 343980
const hopSize = chunkSize / 2
type OnnxSession = import('onnxruntime-node').InferenceSession
type OnnxTensor = import('onnxruntime-node').Tensor

/** Runs the local htdemucs or htdemucs_ft ONNX model set. */
export class OnnxDemucsSeparator implements StemSeparator {
  private readonly cache: FileStemCache
  private readonly cancelled = new Set<string>()
  private readonly decoder = new AudioFileDecoder()
  private readonly sessions = new Map<string, Promise<OnnxSession>>()
  private ortPromise: Promise<typeof import('onnxruntime-node')> | null = null
  private processingThreads = 0
  private processingProfile: SeparationProfile = 'quality'
  private providerPreference: ExecutionProviderPreference = 'auto'
  private activeProvider: 'cpu' | 'cuda' = 'cpu'
  private providerPromise: Promise<'cpu' | 'cuda'> | null = null
  private lastDurationMs: number | undefined

  constructor(private readonly cacheDirectory: string, private readonly modelsDirectoryPath: string) {
    this.cache = new FileStemCache(cacheDirectory)
  }

  async init() { await this.cache.init() }
  cancel(trackId: string) { this.cancelled.add(trackId) }
  setProcessingThreads(threads: number) { this.processingThreads = Math.max(0, Math.min(64, Math.round(threads))); this.sessions.clear() }
  setProcessingProfile(profile: SeparationProfile) { this.processingProfile = profile; this.sessions.clear() }
  setExecutionProvider(preference: ExecutionProviderPreference) { this.providerPreference = preference; this.providerPromise = null; this.sessions.clear() }

  async status(): Promise<SeparationStatus> {
    const mode = await this.availableMode()
    const provider = mode ? await this.resolveProvider(mode === 'ft' ? this.specialistPath('vocals') : this.singlePath()) : 'cpu'
    if (mode === 'ft') return { available: true, message: `Modelo htdemucs_ft pronto: máxima qualidade local (${provider.toUpperCase()}).`, provider, profile: this.processingProfile, memoryBytes: totalmem(), lastDurationMs: this.lastDurationMs }
    if (mode === 'single') return { available: true, message: `Modelo htdemucs pronto para uso local (${provider.toUpperCase()}).`, provider, profile: this.processingProfile, memoryBytes: totalmem(), lastDurationMs: this.lastDurationMs }
    return { available: false, message: 'Modelos ONNX não encontrados. Instale htdemucs_ft em src/main/models/htdemucs-ft.', provider, profile: this.processingProfile, memoryBytes: totalmem(), lastDurationMs: this.lastDurationMs }
  }

  async separate(track: AudioTrack, report: (progress: SeparationProgress) => void) {
    const startedAt = Date.now()
    const key = await hashAudioFile(track.path)
    const cached = await this.cache.get(key)
    if (cached) return cached
    this.cancelled.delete(track.id)
    const mode = await this.availableMode()
    if (!mode) throw new Error((await this.status()).message)
    report({ trackId: track.id, progress: 0.02, stage: `Preparando áudio (${mode === 'ft' ? 'alta qualidade' : 'rápido'})` })

    const decoded = resampleTo44100(await this.decoder.decode(await readFile(track.path)))
    const [left, right] = toStereo(decoded)
    const totalSamples = Math.max(left.length, right.length)
    const stemChannels = applicationStems.map(() => [new Float32Array(totalSamples), new Float32Array(totalSamples)])
    const weights = new Float32Array(totalSamples)
    const ort = await this.ort()

    for (let start = 0; start < totalSamples; start += hopSize) {
      if (this.cancelled.has(track.id)) throw new Error('Separação cancelada.')
      const input = new ort.Tensor('float32', this.createInput(left, right, start), [1, 2, chunkSize])
      const chunkOutputs = await this.inferChunk(input, mode)
      this.overlapAdd(stemChannels, weights, chunkOutputs, start, totalSamples)
      report({ trackId: track.id, progress: Math.min(0.98, (Math.min(start + chunkSize, totalSamples) / totalSamples) * 0.95), stage: `Separando trecho ${Math.ceil((start + 1) / hopSize)}` })
    }

    const encoded = Object.fromEntries(applicationStems.map((stem, index) => {
      const [stemLeft, stemRight] = stemChannels[index]
      for (let sample = 0; sample < totalSamples; sample += 1) {
        const weight = weights[sample] || 1
        stemLeft[sample] /= weight
        stemRight[sample] /= weight
      }
      return [stem, encodeStereoWav(stemLeft, stemRight, sampleRate)]
    })) as Record<StemName, Uint8Array>
    await this.cache.write(key, encoded)
    this.lastDurationMs = Date.now() - startedAt
    report({ trackId: track.id, progress: 1, stage: 'Stems prontos' })
    return this.cache.paths(key)
  }

  private async availableMode(): Promise<'ft' | 'single' | null> {
    const specialists = await Promise.all(applicationStems.map((stem) => this.fileExists(this.specialistPath(stem))))
    const single = await this.fileExists(this.singlePath())
    if (this.processingProfile === 'speed' && single) return 'single'
    if (specialists.every(Boolean)) return 'ft'
    return single ? 'single' : null
  }

  private async inferChunk(input: OnnxTensor, mode: 'ft' | 'single'): Promise<Float32Array[]> {
    if (mode === 'ft') return Promise.all(applicationStems.map((stem) => this.run(this.session(stem), input, modelStemOrder.indexOf(stem))))
    const output = await this.run(this.session('htdemucs'), input, 0, true)
    return applicationStems.map((stem) => {
      const targetIndex = modelStemOrder.indexOf(stem)
      return output.subarray(targetIndex * 2 * chunkSize, (targetIndex + 1) * 2 * chunkSize)
    })
  }

  private async run(sessionPromise: Promise<OnnxSession>, input: OnnxTensor, targetIndex: number, fullOutput = false) {
    const result = await (await sessionPromise).run({ mix: input })
    const output = result.stems
    if (!output || !('data' in output)) throw new Error('O modelo não retornou o tensor stems.')
    const data = output.data as Float32Array
    return fullOutput ? data : data.subarray(targetIndex * 2 * chunkSize, (targetIndex + 1) * 2 * chunkSize)
  }

  private overlapAdd(stemChannels: Float32Array[][], weights: Float32Array, outputs: Float32Array[], start: number, totalSamples: number) {
    for (let sample = 0; sample < chunkSize && start + sample < totalSamples; sample += 1) {
      const weight = Math.max(0.5 - 0.5 * Math.cos((2 * Math.PI * sample) / (chunkSize - 1)), 0.01)
      weights[start + sample] += weight
      for (let stem = 0; stem < applicationStems.length; stem += 1) {
        stemChannels[stem][0][start + sample] += outputs[stem][sample] * weight
        stemChannels[stem][1][start + sample] += outputs[stem][chunkSize + sample] * weight
      }
    }
  }

  private createInput(left: Float32Array, right: Float32Array, start: number) {
    const input = new Float32Array(2 * chunkSize)
    input.set(left.subarray(start, Math.min(start + chunkSize, left.length)), 0)
    input.set(right.subarray(start, Math.min(start + chunkSize, right.length)), chunkSize)
    return input
  }

  private session(model: string): Promise<OnnxSession> {
    const existing = this.sessions.get(model)
    if (existing) return existing
    const modelPath = model === 'htdemucs' ? this.singlePath() : this.specialistPath(model as StemName)
    const promise = this.resolveProvider(modelPath).then(async (provider) => {
      const options = { executionProviders: [provider], ...(this.processingThreads > 0 ? { intraOpNumThreads: this.processingThreads, interOpNumThreads: 1 } : {}) }
      return (await this.ort()).InferenceSession.create(modelPath, options)
    })
    this.sessions.set(model, promise)
    return promise
  }

  private ort() {
    this.ortPromise ??= import('onnxruntime-node')
    return this.ortPromise
  }

  private resolveProvider(modelPath: string): Promise<'cpu' | 'cuda'> {
    if (this.providerPreference === 'cpu') return Promise.resolve('cpu')
    if (this.providerPromise) return this.providerPromise
    this.providerPromise = this.ort().then(async ({ InferenceSession }) => {
      if (process.platform !== 'linux' || !(await this.fileExists(modelPath)) || (!process.env.CUDA_PATH && !process.env.CUDA_HOME && process.env.GRIFFIN_CUDA !== '1')) return 'cpu' as const
      try {
        const probe = await InferenceSession.create(modelPath, { executionProviders: ['cuda'] })
        await probe.release()
        return 'cuda' as const
      } catch { return 'cpu' as const }
    }).then((provider) => { this.activeProvider = provider; return provider })
    return this.providerPromise
  }

  private specialistPath(stem: StemName) { return join(this.modelsDirectory(), 'htdemucs-ft', `htdemucs_ft_${stem}_fp16weights.onnx`) }
  private singlePath() { return join(this.modelsDirectory(), 'htdemucs.onnx') }
  private modelsDirectory() { return this.modelsDirectoryPath }
  private async fileExists(path: string) { return access(path).then(() => true).catch(() => false) }
}
