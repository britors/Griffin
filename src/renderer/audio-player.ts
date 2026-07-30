import { api } from './api'
import type { StemName, Track } from '../shared/types'
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'

const stems: StemName[] = ['vocals', 'drums', 'bass', 'other']

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Keeps all stem sources on one AudioContext clock. Sources are recreated on seek/pause. */
export class StemAudioPlayer {
  private readonly context = new AudioContext()
  private readonly gains = new Map<StemName, GainNode>()
  private readonly buffers = new Map<StemName, AudioBuffer>()
  private readonly sources = new Map<StemName, AudioBufferSourceNode>()
  private readonly processors = new Map<StemName, SoundTouchNode>()
  private workletReady = false
  private startedAt = 0
  private offset = 0
  private duration = 0
  private tempo = 1

  constructor() {
    for (const stem of stems) {
      const gain = this.context.createGain()
      gain.connect(this.context.destination)
      this.gains.set(stem, gain)
    }
  }

  get length() { return this.duration }
  get isLoaded() { return this.buffers.size === stems.length }

  async load(track: Track) {
    this.stop()
    this.buffers.clear()
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
  }

  setPitch(pitch: number) {
    for (const processor of this.processors.values()) processor.pitchSemitones.setValueAtTime(pitch, this.context.currentTime)
  }

  dispose() { this.stop(); void this.context.close() }

  private stop() { this.stopSources(); this.offset = 0 }
  private stopSources() {
    for (const source of this.sources.values()) {
      source.onended = null
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    }
    this.sources.clear()
  }

  private async ensureWorklet() {
    if (this.workletReady) return
    await SoundTouchNode.register(this.context, processorUrl)
    for (const stem of stems) {
      const processor = new SoundTouchNode({ context: this.context })
      processor.connect(this.gains.get(stem)!)
      this.processors.set(stem, processor)
    }
    this.workletReady = true
  }
}
