import { SoundTouch } from '@soundtouchjs/core'
import type { AudioExportOptions, StemName } from '../../../shared/types'
import type { AudioDecoder, AudioExportProcessor, AudioFileGateway } from '../../application/ports'
import { resampleTo44100, toStereo } from './audio-resampler'
import { encodeStereoWav } from './wav-encoder'

const sampleRate = 44100

export class WavAudioExportProcessor implements AudioExportProcessor {
  constructor(private readonly files: AudioFileGateway, private readonly decoder: AudioDecoder) {}

  async render(stems: Record<StemName, string>, options: AudioExportOptions) {
    const decoded = await Promise.all(Object.entries(stems).map(async ([stem, path]) => {
      const bytes = await this.files.read(path)
      const audio = resampleTo44100(await this.decoder.decode(bytes))
      return { stem: stem as StemName, audio: applyEqualizer(audio, options.equalizer[stem as StemName] ?? []) }
    }))
    const [left, right] = mix(decoded, options)
    const processed = processOffline(left, right, options.pitch, options.tempo)
    return { bytes: encodeStereoWav(processed.left, processed.right, sampleRate), duration: processed.left.length / sampleRate }
  }
}

type DecodedAudio = { channelData: Float32Array[]; sampleRate: number }

function mix(decoded: Array<{ stem: StemName; audio: DecodedAudio }>, options: AudioExportOptions): [Float32Array, Float32Array] {
  const stereo = decoded.map(({ stem, audio }) => ({ stem, channels: toStereo(audio) }))
  const availableFrames = Math.min(...stereo.map(({ channels }) => Math.min(channels[0].length, channels[1].length)))
  const start = Math.floor(clamp(options.loop?.start ?? 0) * availableFrames)
  const end = Math.max(start + 1, Math.ceil(clamp(options.loop?.end ?? 1) * availableFrames))
  const left = new Float32Array(end - start)
  const right = new Float32Array(end - start)
  for (let outputIndex = 0; outputIndex < left.length; outputIndex += 1) {
    const sourceIndex = start + outputIndex
    for (const { stem, channels } of stereo) {
      const volume = Math.max(0, Math.min(1, options.volumes[stem] ?? 0))
      const pan = Math.max(-1, Math.min(1, options.pans[stem] ?? 0))
      const angle = (pan + 1) * Math.PI / 4
      left[outputIndex] += channels[0][sourceIndex] * volume * Math.cos(angle)
      right[outputIndex] += channels[1][sourceIndex] * volume * Math.sin(angle)
    }
  }
  return [left, right]
}

function processOffline(left: Float32Array, right: Float32Array, pitch: number, tempo: number): { left: Float32Array; right: Float32Array } {
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

function applyEqualizer(audio: DecodedAudio, gains: number[]): DecodedAudio {
  const frequencies = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000]
  const channelData = audio.channelData.map((channel) => frequencies.reduce((samples, frequency, index) => applyPeakingFilter(samples, frequency, gains[index] ?? 0), channel))
  return { ...audio, channelData }
}

function applyPeakingFilter(input: Float32Array, frequency: number, gainDb: number): Float32Array {
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
