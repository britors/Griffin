import { api } from './api'
import type { StemName, Track } from '../shared/types'
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'

const stems: StemName[] = ['vocals', 'drums', 'bass', 'other']
let activePlayer: StemAudioPlayer | null = null

export function getActiveStemAudioPlayer() { return activePlayer }

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Keeps all stem sources on one AudioContext clock. Sources are recreated on seek/pause. */
export class StemAudioPlayer {
  private readonly context = new AudioContext()
  private readonly recordingDestination = this.context.createMediaStreamDestination()
  private readonly gains = new Map<StemName, GainNode>()
  private readonly panners = new Map<StemName, StereoPannerNode>()
  private readonly equalizers = new Map<StemName, BiquadFilterNode[]>()
  private readonly buffers = new Map<StemName, AudioBuffer>()
  private takeBuffer: AudioBuffer | null = null
  private takeSource: AudioBufferSourceNode | null = null
  private readonly sources = new Map<StemName, AudioBufferSourceNode>()
  private readonly processors = new Map<StemName, SoundTouchNode>()
  private workletReady = false
  private startedAt = 0
  private offset = 0
  private duration = 0
  private tempo = 1

  constructor() {
    activePlayer = this
    for (const stem of stems) {
      const gain = this.context.createGain()
      const panner = this.context.createStereoPanner()
      gain.connect(panner).connect(this.context.destination)
      panner.connect(this.recordingDestination)
      this.gains.set(stem, gain)
      this.panners.set(stem, panner)
      this.equalizers.set(stem, [])
    }
  }

  get length() { return this.duration }
  get isLoaded() { return this.buffers.size === stems.length }
  get recordingStream() { return this.recordingDestination.stream }

  connectMicrophone(stream: MediaStream) {
    const source = this.context.createMediaStreamSource(stream)
    source.connect(this.recordingDestination)
    return () => { source.disconnect(); stream.getTracks().forEach((track) => track.stop()) }
  }

  async load(track: Track, takePath?: string | null) {
    this.stop()
    this.buffers.clear()
    this.takeBuffer = null
    this.duration = 0
    if (!track.stems) return
    await this.ensureWorklet()
    const decoded = await Promise.all(stems.map(async (stem) => {
      const bytes = await api.library.read(track.stems![stem])
      return [stem, await this.context.decodeAudioData(asArrayBuffer(bytes))] as const
    }))
    for (const [stem, buffer] of decoded) {
      this.buffers.set(stem, buffer)
      this.duration = Math.max(this.duration, buffer.duration)
    }
    if (takePath) {
      const bytes = await api.library.read(takePath)
      this.takeBuffer = await this.context.decodeAudioData(asArrayBuffer(bytes))
    }
  }

  async play(offset = this.offset, tempo = 1, pitch = 0, onEnded?: () => void) {
    if (!this.isLoaded || this.duration === 0) return
    if (this.context.state === 'suspended') await this.context.resume()
    this.stopSources()
    this.offset = Math.max(0, Math.min(offset, this.duration - 0.01))
    this.tempo = tempo
    const startAt = this.context.currentTime + 0.04
    this.startedAt = startAt
    let ended = false
    for (const stem of stems) {
      const source = this.context.createBufferSource()
      source.buffer = this.buffers.get(stem)!
      source.playbackRate.value = tempo
      const processor = this.processors.get(stem)!
      processor.playbackRate.value = tempo
      processor.pitchSemitones.value = pitch
      source.connect(processor)
      source.onended = () => {
        if (!ended && this.sources.get(stem) === source) {
          ended = true
          onEnded?.()
        }
      }
      source.start(startAt, this.offset)
      this.sources.set(stem, source)
    }
    if (this.takeBuffer && this.offset < this.takeBuffer.duration) {
      const takeSource = this.context.createBufferSource()
      takeSource.buffer = this.takeBuffer
      takeSource.playbackRate.value = tempo
      takeSource.connect(this.context.destination)
      takeSource.connect(this.recordingDestination)
      takeSource.start(startAt, Math.min(this.offset, this.takeBuffer.duration - 0.01))
      this.takeSource = takeSource
    }
  }

  pause() {
    this.offset = this.currentTime()
    this.stopSources()
    return this.offset
  }

  seek(offset: number, playing: boolean, tempo: number, pitch: number, onEnded?: () => void) {
    this.offset = Math.max(0, Math.min(offset, this.duration))
    if (playing) void this.play(this.offset, tempo, pitch, onEnded)
  }

  currentTime() {
    if (this.sources.size === 0) return this.offset
    return Math.min(this.duration, this.offset + Math.max(0, this.context.currentTime - this.startedAt) * this.tempo)
  }

  setMix(stem: StemName, volume: number, muted: boolean, solo: StemName | null) {
    const audible = !muted && (solo === null || solo === stem)
    this.gains.get(stem)!.gain.value = audible ? volume : 0
  }

  setPan(stem: StemName, pan: number) {
    this.panners.get(stem)!.pan.value = Math.max(-1, Math.min(1, pan))
  }

  setEqualizer(stem: StemName, gains: number[]) {
    this.equalizers.get(stem)?.forEach((filter, index) => { filter.gain.value = gains[index] ?? 0 })
  }

  setTempo(tempo: number) {
    if (this.sources.size > 0) {
      this.offset = this.currentTime()
      this.startedAt = this.context.currentTime
    }
    this.tempo = tempo
    for (const stem of stems) {
      this.sources.get(stem)?.playbackRate.setValueAtTime(tempo, this.context.currentTime)
      const processor = this.processors.get(stem)
      if (processor) processor.playbackRate.setValueAtTime(tempo, this.context.currentTime)
    }
    this.takeSource?.playbackRate.setValueAtTime(tempo, this.context.currentTime)
  }

  setPitch(pitch: number) {
    for (const processor of this.processors.values()) processor.pitchSemitones.setValueAtTime(pitch, this.context.currentTime)
  }

  dispose() { this.stop(); if (activePlayer === this) activePlayer = null; void this.context.close() }

  private stop() { this.stopSources(); this.offset = 0 }
  private stopSources() {
    for (const source of this.sources.values()) {
      source.onended = null
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    }
    this.sources.clear()
    if (this.takeSource) {
      try { this.takeSource.stop() } catch { /* already stopped */ }
      this.takeSource.disconnect()
      this.takeSource = null
    }
  }

  private async ensureWorklet() {
    if (this.workletReady) return
    await SoundTouchNode.register(this.context, processorUrl)
    for (const stem of stems) {
      const processor = new SoundTouchNode({ context: this.context })
      const filters = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000].map((frequency) => {
        const filter = this.context.createBiquadFilter()
        filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1
        return filter
      })
      filters.reduce<AudioNode>((output, filter) => output.connect(filter), processor).connect(this.gains.get(stem)!)
      this.equalizers.set(stem, filters)
      this.processors.set(stem, processor)
    }
    this.workletReady = true
  }
}
