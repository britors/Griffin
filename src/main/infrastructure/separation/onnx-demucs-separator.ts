import { access, readFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { AudioTrack } from '../../../shared/domain/audio-track'
import { ALL_STEMS, CORE_STEMS, type ExecutionProviderPreference, type SeparationModelProfile, type SeparationProgress, type SeparationProfile, type SeparationStatus, type StemName } from '../../../shared/types'
import type { StemSeparator } from '../../application/ports'
import { AudioFileDecoder } from '../audio/audio-file-decoder'
import { resampleTo44100, toStereo } from '../audio/audio-resampler'
import { encodeStereoWav } from '../audio/wav-encoder'
import { hashAudioFile, FileStemCache } from './stem-cache'
import { singlePath, specialistPath, sixStemPath } from './model-catalog'

const modelStemOrder: StemName[] = ['drums', 'bass', 'other', 'vocals']
const extendedModelStemOrder: StemName[] = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
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
  private modelProfile: SeparationModelProfile = 'four-stem'
  private providerPreference: ExecutionProviderPreference = 'auto'
  private activeProvider: 'cpu' | 'cuda' = 'cpu'
  private providerPromise: Promise<'cpu' | 'cuda'> | null = null
  private lastDurationMs: number | undefined
  private readonly workers = new Map<string, Worker>()

  constructor(private readonly cacheDirectory: string, private readonly modelsDirectoryPath: string, private readonly workerMode = false) {
    this.cache = new FileStemCache(cacheDirectory)
  }

  async init() { await this.cache.init() }
  cancel(trackId: string) { this.cancelled.add(trackId); this.workers.get(trackId)?.postMessage({ type: 'cancel', trackId }) }
  setProcessingThreads(threads: number) { this.processingThreads = Math.max(0, Math.min(64, Math.round(threads))); this.sessions.clear() }
  setProcessingProfile(profile: SeparationProfile) { this.processingProfile = profile; this.sessions.clear() }
  setModelProfile(profile: SeparationModelProfile) { this.modelProfile = profile; this.sessions.clear() }
  setExecutionProvider(preference: ExecutionProviderPreference) { this.providerPreference = preference; this.providerPromise = null; this.sessions.clear() }

  async status(): Promise<SeparationStatus> {
    const mode = await this.availableMode()
    const sixStemAvailable = await this.fileExists(this.sixStemPath())
    const provider = mode ? await this.resolveProvider(this.modelPath(mode === 'six' ? 'htdemucs-6s' : mode === 'single' ? 'htdemucs' : 'vocals')) : 'cpu'
    if (mode === 'six') return { available: true, message: `Modelo htdemucs-6s pronto: seis stems locais (${provider.toUpperCase()}).`, provider, profile: this.processingProfile, modelProfile: this.modelProfile, sixStemAvailable, memoryBytes: totalmem(), lastDurationMs: this.lastDurationMs }
    if (mode === 'ft') return { available: true, message: `Modelo htdemucs_ft pronto: quatro stems (${provider.toUpperCase()}).`, provider, profile: this.processingProfile, modelProfile: this.modelProfile, sixStemAvailable, memoryBytes: totalmem(), lastDurationMs: this.lastDurationMs }
    if (mode === 'single') return { available: true, message: `Modelo htdemucs pronto: quatro stems (${provider.toUpperCase()}).`, provider, profile: this.processingProfile, modelProfile: this.modelProfile, sixStemAvailable, memoryBytes: totalmem(), lastDurationMs: this.lastDurationMs }
    return { available: false, message: this.modelProfile === 'six-stem' ? 'Modelo htdemucs-6s não encontrado; instale-o para ativar guitarra e piano.' : 'Modelos ONNX não encontrados. Instale htdemucs_ft em src/main/models/htdemucs-ft.', provider, profile: this.processingProfile, modelProfile: this.modelProfile, sixStemAvailable, memoryBytes: totalmem(), lastDurationMs: this.lastDurationMs }
  }

  async separate(track: AudioTrack, report: (progress: SeparationProgress) => void, target?: StemName) {
    if (!this.workerMode) return this.separateInWorker(track, report, target)
    return this.separateOnCurrentThread(track, report, target)
  }

  private async separateInWorker(track: AudioTrack, report: (progress: SeparationProgress) => void, target?: StemName) {
    const mode = await this.availableMode(target)
    if (!mode) throw new Error((await this.status()).message)
    this.cancelled.delete(track.id)
    const worker = new Worker(join(__dirname, '..', 'onnx-separation-worker.js'), {
      workerData: {
        cacheDirectory: this.cacheDirectory,
        modelsDirectoryPath: this.modelsDirectoryPath,
        processingThreads: this.processingThreads,
        processingProfile: this.processingProfile,
        modelProfile: this.modelProfile,
        providerPreference: this.providerPreference,
        target,
        track: track.snapshot(),
      },
    })
    this.workers.set(track.id, worker)
    return new Promise<Partial<Record<StemName, string>>>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        this.workers.delete(track.id)
        void worker.terminate()
        callback()
      }
      worker.on('message', (message: { type: string; progress?: SeparationProgress; stems?: Partial<Record<StemName, string>>; durationMs?: number; message?: string }) => {
        if (message.type === 'progress' && message.progress) report(message.progress)
        if (message.type === 'done' && message.stems) {
          this.lastDurationMs = message.durationMs
          finish(() => resolve(message.stems!))
        }
        if (message.type === 'error') finish(() => reject(new Error(message.message ?? 'A separação ONNX falhou.')))
      })
      worker.on('error', (error) => finish(() => reject(error)))
      worker.on('exit', (code) => { if (code !== 0) finish(() => reject(new Error(`O worker de separação encerrou com código ${code}.`))) })
    })
  }

  private async separateOnCurrentThread(track: AudioTrack, report: (progress: SeparationProgress) => void, target?: StemName) {
    const startedAt = Date.now()
    const key = `${await hashAudioFile(track.path)}-${this.modelProfile}-${target ?? 'all'}`
    const mode = await this.availableMode(target)
    const stemNames = target ? [target] : mode === 'six' ? ALL_STEMS : CORE_STEMS
    const cached = await this.cache.get(key, stemNames)
    if (cached) return cached
    this.cancelled.delete(track.id)
    if (!mode) throw new Error((await this.status()).message)
    report({ trackId: track.id, progress: 0.02, stage: `Preparando áudio (${mode === 'ft' ? 'alta qualidade' : 'rápido'})` })

    const decoded = resampleTo44100(await this.decoder.decode(await readFile(track.path)))
    const [left, right] = toStereo(decoded)
    const totalSamples = Math.max(left.length, right.length)
    const stemChannels = stemNames.map(() => [new Float32Array(totalSamples), new Float32Array(totalSamples)])
    const weights = new Float32Array(totalSamples)
    const ort = await this.ort()

    for (let start = 0; start < totalSamples; start += hopSize) {
      if (this.cancelled.has(track.id)) throw new Error('Separação cancelada.')
      const input = new ort.Tensor('float32', this.createInput(left, right, start), [1, 2, chunkSize])
      const chunkOutputs = await this.inferChunk(input, mode, target)
      this.overlapAdd(stemChannels, weights, chunkOutputs, start, totalSamples)
      report({ trackId: track.id, progress: Math.min(0.98, (Math.min(start + chunkSize, totalSamples) / totalSamples) * 0.95), stage: `Separando trecho ${Math.ceil((start + 1) / hopSize)}` })
    }

    const encoded = Object.fromEntries(stemNames.map((stem, index) => {
      const [stemLeft, stemRight] = stemChannels[index]
      for (let sample = 0; sample < totalSamples; sample += 1) {
        const weight = weights[sample] || 1
        stemLeft[sample] /= weight
        stemRight[sample] /= weight
      }
      return [stem, encodeStereoWav(stemLeft, stemRight, sampleRate)]
    })) as Partial<Record<StemName, Uint8Array>>
    await this.cache.write(key, encoded, stemNames)
    this.lastDurationMs = Date.now() - startedAt
    report({ trackId: track.id, progress: 1, stage: 'Stems prontos' })
    return this.cache.paths(key, stemNames)
  }

  private async availableMode(target?: StemName): Promise<'ft' | 'single' | 'six' | null> {
    if (target && (target === 'guitar' || target === 'piano')) return await this.fileExists(this.sixStemPath()) ? 'six' : null
    if (this.modelProfile === 'six-stem' && await this.fileExists(this.sixStemPath())) return 'six'
    const specialists = await Promise.all(CORE_STEMS.map((stem) => this.fileExists(this.specialistPath(stem))))
    const single = await this.fileExists(this.singlePath())
    if (this.processingProfile === 'speed' && single) return 'single'
    if (specialists.every(Boolean)) return 'ft'
    return single ? 'single' : null
  }

  private async inferChunk(input: OnnxTensor, mode: 'ft' | 'single' | 'six', target?: StemName): Promise<Float32Array[]> {
    if (mode === 'six') {
      const output = await this.run(this.session('htdemucs-6s'), input, 0, true)
      const stems = target ? [target] : extendedModelStemOrder
      return stems.map((stem) => output.subarray(extendedModelStemOrder.indexOf(stem) * 2 * chunkSize, (extendedModelStemOrder.indexOf(stem) + 1) * 2 * chunkSize))
    }
    if (mode === 'ft') {
      const outputs: Float32Array[] = []
      // Specialist models are intentionally executed one at a time. Running all
      // four ONNX sessions concurrently can make libonnxruntime allocate more
      // native memory than Electron can safely recover from on desktop systems.
      for (const stem of target ? [target] : CORE_STEMS) outputs.push(await this.run(this.session(stem), input, modelStemOrder.indexOf(stem)))
      return outputs
    }
    const output = await this.run(this.session('htdemucs'), input, 0, true)
    const stems = target ? [target] : CORE_STEMS
    return stems.map((stem) => {
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
      for (let stem = 0; stem < outputs.length; stem += 1) {
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
    const modelPath = this.modelPath(model === 'htdemucs' || model === 'htdemucs-6s' ? model : model as StemName)
    const promise = this.resolveProvider(modelPath).then(async (provider) => {
      const options = { executionProviders: [provider], executionMode: 'sequential' as const, enableCpuMemArena: false, enableMemPattern: false, ...(this.processingThreads > 0 ? { intraOpNumThreads: this.processingThreads, interOpNumThreads: 1 } : {}) }
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

  private modelPath(model: 'htdemucs' | 'htdemucs-6s' | StemName) { return model === 'htdemucs' ? this.singlePath() : model === 'htdemucs-6s' ? this.sixStemPath() : this.specialistPath(model) }

  private specialistPath(stem: StemName) { return specialistPath(this.modelsDirectory(), stem) }
  private singlePath() { return singlePath(this.modelsDirectory()) }
  private sixStemPath() { return sixStemPath(this.modelsDirectory()) }
  private modelsDirectory() { return this.modelsDirectoryPath }
  private async fileExists(path: string) { return access(path).then(() => true).catch(() => false) }
}
