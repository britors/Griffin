import type { TrackAnalysis, TrackSection } from '../../../shared/types'
import type { AudioAnalyzer } from '../../application/ports'
import { AudioFileDecoder, type DecodedAudio } from './audio-file-decoder'

const TARGET_RATE = 11025
const MAX_SECONDS = 60
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

export class LocalTrackAnalyzer implements AudioAnalyzer {
  constructor(private readonly decoder = new AudioFileDecoder()) {}

  async analyze(bytes: Uint8Array): Promise<TrackAnalysis> {
    const decoded = await this.decoder.decode(bytes)
    const samples = toMono(decoded)
    return {
      bpm: detectBpm(samples),
      key: detectKey(samples),
      tuningHz: detectTuning(samples),
      confidence: estimateConfidence(samples),
      sections: detectSections(samples),
    }
  }
}

function toMono(decoded: DecodedAudio): Float32Array {
  const inputLength = decoded.channelData[0]?.length ?? 0
  const ratio = decoded.sampleRate / TARGET_RATE
  const outputLength = Math.min(Math.floor(inputLength / ratio), TARGET_RATE * MAX_SECONDS)
  const mono = new Float32Array(outputLength)
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.floor(index * ratio)
    let sum = 0
    for (const channel of decoded.channelData) sum += channel[sourceIndex] ?? 0
    mono[index] = sum / Math.max(1, decoded.channelData.length)
  }
  return mono
}

function detectBpm(samples: Float32Array): number {
  const hop = 256
  const frame = 512
  const envelope: number[] = []
  let previous = 0
  for (let start = 0; start + frame < samples.length; start += hop) {
    let energy = 0
    for (let index = start; index < start + frame; index += 1) energy += samples[index] ** 2
    const rms = Math.sqrt(energy / frame)
    envelope.push(Math.max(0, rms - previous))
    previous = rms
  }
  if (envelope.length < 8) return 120
  const samplesPerBeat = TARGET_RATE / hop
  let bestBpm = 120
  let bestScore = -Infinity
  for (let bpm = 60; bpm <= 180; bpm += 1) {
    const lag = Math.max(1, Math.round((60 / bpm) * samplesPerBeat))
    let score = 0
    for (let index = lag; index < envelope.length; index += 1) score += envelope[index] * envelope[index - lag]
    if (score > bestScore) { bestScore = score; bestBpm = bpm }
  }
  return bestBpm
}

function detectKey(samples: Float32Array): string {
  const frame = 4096
  const limit = Math.min(samples.length, TARGET_RATE * 30)
  const chroma = new Array<number>(12).fill(0)
  for (let start = 0; start + frame < limit; start += frame) {
    for (let midi = 36; midi <= 84; midi += 1) {
      const frequency = 440 * 2 ** ((midi - 69) / 12)
      chroma[midi % 12] += goertzel(samples, start, frame, frequency)
    }
  }
  const total = chroma.reduce((sum, value) => sum + value, 0)
  if (total === 0) return 'C maior'
  let best = { score: -Infinity, name: 'C maior' }
  for (let tonic = 0; tonic < 12; tonic += 1) {
    for (const [mode, profile] of [['maior', MAJOR_PROFILE], ['menor', MINOR_PROFILE]] as const) {
      let score = 0
      for (let offset = 0; offset < 12; offset += 1) score += chroma[(tonic + offset) % 12] * profile[offset]
      if (score > best.score) best = { score, name: `${NOTE_NAMES[tonic]} ${mode}` }
    }
  }
  return best.name
}

function detectTuning(samples: Float32Array): number {
  const limit = Math.min(samples.length, TARGET_RATE * 20)
  let bestFrequency = 440
  let bestEnergy = 0
  for (let frequency = 430; frequency <= 450; frequency += 1) {
    const energy = goertzel(samples, 0, limit, frequency)
    if (energy > bestEnergy) { bestEnergy = energy; bestFrequency = frequency }
  }
  return bestFrequency
}

function goertzel(samples: Float32Array, start: number, size: number, frequency: number): number {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / TARGET_RATE)
  let previous = 0
  let previousPrevious = 0
  const end = Math.min(samples.length, start + size)
  for (let index = start; index < end; index += 1) {
    const current = samples[index] + coefficient * previous - previousPrevious
    previousPrevious = previous
    previous = current
  }
  return previousPrevious ** 2 + previous ** 2 - coefficient * previous * previousPrevious
}

function estimateConfidence(samples: Float32Array): number {
  let energy = 0
  for (const sample of samples) energy += sample ** 2
  return Math.min(1, Math.max(0, Math.sqrt(energy / Math.max(1, samples.length)) * 8))
}

function detectSections(samples: Float32Array): TrackSection[] {
  const windowSize = Math.max(1, Math.floor(samples.length / 12))
  const energies: number[] = []
  for (let start = 0; start < samples.length; start += windowSize) {
    let energy = 0
    const end = Math.min(samples.length, start + windowSize)
    for (let index = start; index < end; index += 1) energy += samples[index] ** 2
    energies.push(Math.sqrt(energy / Math.max(1, end - start)))
  }
  const peak = Math.max(...energies, 0.001)
  const boundaries = [0]
  for (let index = 1; index < energies.length; index += 1) {
    const change = Math.abs(energies[index] - energies[index - 1]) / peak
    const position = index / energies.length
    if (change > 0.18 && position - boundaries[boundaries.length - 1] >= 0.08) boundaries.push(position)
  }
  if (boundaries.length < 3) boundaries.push(0.25, 0.5, 0.75)
  boundaries.push(1)
  const unique = [...new Set(boundaries.map((value) => Math.max(0, Math.min(1, value))))].sort((a, b) => a - b)
  const highestEnergyIndex = energies.indexOf(Math.max(...energies))
  return unique.slice(0, -1).map((start, index) => {
    const end = unique[index + 1]
    const segmentIndex = Math.min(energies.length - 1, Math.floor(start * energies.length))
    const name = index === 0 ? 'Intro' : segmentIndex === highestEnergyIndex ? 'Refrão' : index === unique.length - 2 ? 'Outro' : index % 2 === 0 ? 'Verso' : 'Ponte'
    return { id: `section-${index + 1}`, name, start, end, confidence: 0.55 }
  })
}
