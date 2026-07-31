import { SoundTouch } from '@soundtouchjs/core'
import type { AudioExportOptions, StemName } from '../../../shared/types'
import type { AudioDecoder, AudioExportProcessor, AudioFileGateway } from '../../application/ports'
import { resampleTo, toStereo } from './audio-resampler'
import { encodeStereoWav } from './wav-encoder'

export class WavAudioExportProcessor implements AudioExportProcessor {
  constructor(private readonly files: AudioFileGateway, private readonly decoder: AudioDecoder) {}

  async render(stems: Record<StemName, string>, options: AudioExportOptions, report: (progress: number, stage: string) => void, isCancelled: () => boolean) {
    const entries = Object.entries(stems) as Array<[StemName, string]>
    if (entries.length === 0) throw new Error('Nenhum stem disponível para exportar.')
    let left: Float32Array | null = null
    let right: Float32Array | null = null
    let availableFrames = Infinity
    for (const [index, [stem, path]] of entries.entries()) {
      if (isCancelled()) throw new Error('Exportação cancelada.')
      const bytes = await this.files.read(path)
      const audio = resampleTo(await this.decoder.decode(bytes), options.sampleRate)
      report(0.1 + ((index + 1) / entries.length) * 0.25, `Lendo ${stem}`)
      const channels = toStereo(applyEqualizer(audio, options.equalizer[stem] ?? [], options.sampleRate))
      const frames = Math.min(channels[0].length, channels[1].length)
      availableFrames = Math.min(availableFrames, frames)
      if (!left || !right) {
        left = new Float32Array(frames)
        right = new Float32Array(frames)
      }
      mixInto(left, right, channels, stem, options)
    }
    if (isCancelled()) throw new Error('Exportação cancelada.')
    const start = Math.floor(clamp(options.loop?.start ?? 0) * availableFrames)
    const end = Math.max(start + 1, Math.ceil(clamp(options.loop?.end ?? 1) * availableFrames))
    const mixedLeft = left!.subarray(start, Math.min(end, left!.length))
    const mixedRight = right!.subarray(start, Math.min(end, right!.length))
    report(0.45, 'Mixando stems')
    const processed = processOffline(mixedLeft, mixedRight, options.pitch, options.tempo, options.sampleRate, isCancelled)
    report(0.9, 'Codificando WAV')
    return { bytes: encodeStereoWav(processed.left, processed.right, options.sampleRate, options.bitDepth), duration: processed.left.length / options.sampleRate }
  }
}

type DecodedAudio = { channelData: Float32Array[]; sampleRate: number }

function mixInto(left: Float32Array, right: Float32Array, channels: [Float32Array, Float32Array], stem: StemName, options: AudioExportOptions) {
  const volume = Math.max(0, Math.min(1, options.volumes[stem] ?? 0))
  const route = options.routes[stem] ?? 'stereo'
  const pan = route === 'left' ? -1 : route === 'right' ? 1 : Math.max(-1, Math.min(1, options.pans[stem] ?? 0))
  const angle = (pan + 1) * Math.PI / 4
  const frames = Math.min(left.length, channels[0].length, channels[1].length)
  for (let index = 0; index < frames; index += 1) {
    left[index] += channels[0][index] * volume * Math.cos(angle)
    right[index] += channels[1][index] * volume * Math.sin(angle)
  }
}

function processOffline(left: Float32Array, right: Float32Array, pitch: number, tempo: number, sampleRate: number, isCancelled: () => boolean): { left: Float32Array; right: Float32Array } {
  const normalizedTempo = Math.max(0.5, Math.min(1.5, tempo))
  if (pitch === 0 && normalizedTempo === 1) return { left, right }
  const interleaved = new Float32Array(left.length * 2)
  for (let index = 0; index < left.length; index += 1) {
    interleaved[index * 2] = left[index]
    interleaved[index * 2 + 1] = right[index]
  }
  const pitchRate = Math.pow(2, pitch / 12)
  const processor = new SoundTouch({ sampleRate, sampleBufferType: 'fifo' })
  processor.pitchSemitones = pitch
  processor.stretch.tempo = normalizedTempo / pitchRate
  processor.setStretchParameters({ quickSeek: false })
  processor.inputBuffer.putSamples(interleaved)
  processor.inputBuffer.putSamples(new Float32Array(Math.max(processor.stretch.sampleReq, sampleRate / 2) * 2))
  let previousFrames = -1
  while (processor.inputBuffer.frameCount > 0 && processor.inputBuffer.frameCount !== previousFrames) {
    if (isCancelled()) throw new Error('Exportação cancelada.')
    previousFrames = processor.inputBuffer.frameCount
    processor.process()
  }
  const targetFrames = Math.max(1, Math.round(left.length / normalizedTempo))
  const outputFrames = Math.min(targetFrames, processor.outputBuffer.frameCount)
  const output = new Float32Array(outputFrames * 2)
  processor.outputBuffer.extract(output, 0, outputFrames)
  const processedLeft = new Float32Array(outputFrames)
  const processedRight = new Float32Array(outputFrames)
  for (let index = 0; index < outputFrames; index += 1) {
    processedLeft[index] = output[index * 2]
    processedRight[index] = output[index * 2 + 1]
  }
  return { left: processedLeft, right: processedRight }
}

function clamp(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) }

function applyEqualizer(audio: DecodedAudio, gains: number[], sampleRate: number): DecodedAudio {
  const frequencies = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000]
  const channelData = audio.channelData.map((channel) => frequencies.reduce((samples, frequency, index) => applyPeakingFilter(samples, frequency, gains[index] ?? 0, sampleRate), channel))
  return { ...audio, channelData }
}

function applyPeakingFilter(input: Float32Array, frequency: number, gainDb: number, sampleRate: number): Float32Array {
  if (gainDb === 0) return input
  const omega = 2 * Math.PI * frequency / sampleRate
  const alpha = Math.sin(omega) / 2
  const amplitude = Math.pow(10, gainDb / 40)
  const b0 = 1 + alpha * amplitude
  const b1 = -2 * Math.cos(omega)
  const b2 = 1 - alpha * amplitude
  const a0 = 1 + alpha / amplitude
  const a1 = -2 * Math.cos(omega)
  const a2 = 1 - alpha / amplitude
  const output = new Float32Array(input.length)
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0
  for (let index = 0; index < input.length; index += 1) {
    const x0 = input[index]
    const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2
    output[index] = y0
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
  }
  return output
}
