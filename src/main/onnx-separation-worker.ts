import { parentPort, workerData } from 'node:worker_threads'
import { AudioTrack } from '../shared/domain/audio-track'
import type { ExecutionProviderPreference, SeparationModelProfile, SeparationProfile, SeparationProgress, Track, StemName } from '../shared/types'
import { OnnxDemucsSeparator } from './infrastructure/separation/onnx-demucs-separator'

interface WorkerData {
  cacheDirectory: string
  modelsDirectoryPath: string
  processingThreads: number
  processingProfile: SeparationProfile
  modelProfile: SeparationModelProfile
  providerPreference: ExecutionProviderPreference
  target?: StemName
  track: Track
}

const data = workerData as WorkerData
const separator = new OnnxDemucsSeparator(data.cacheDirectory, data.modelsDirectoryPath, true)
separator.setProcessingThreads(data.processingThreads)
separator.setProcessingProfile(data.processingProfile)
separator.setModelProfile(data.modelProfile)
separator.setExecutionProvider(data.providerPreference)

parentPort?.on('message', (message: { type: string; trackId?: string }) => {
  if (message.type === 'cancel' && message.trackId) separator.cancel(message.trackId)
})

void run()

async function run() {
  try {
    await separator.init()
    const track = AudioTrack.restore(data.track)
    const startedAt = Date.now()
    const stems = await separator.separate(track, (progress: SeparationProgress) => parentPort?.postMessage({ type: 'progress', progress }), data.target)
    parentPort?.postMessage({ type: 'done', stems: stems as Partial<Record<StemName, string>>, durationMs: Date.now() - startedAt })
  } catch (error) {
    parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'A separação ONNX falhou.' })
  }
}
