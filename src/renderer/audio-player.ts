import { api } from './api'
import type { StemName, Track } from '../shared/types'

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
  private startedAt = 0
  private offset = 0
  private duration = 0

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
    const decoded = await Promise.all(stems.map(async (stem) => {
      const bytes = await api.library.read(track.stems![stem])
      return [stem, await this.context.decodeAudioData(asArrayBuffer(bytes))] as const
    }))
    for (const [stem, buffer] of decoded) {
      this.buffers.set(stem, buffer)
      this.duration = Math.max(this.duration, buffer.duration)
    }
  }

  async play(offset = this.offset, tempo = 1, onEnded?: () => void) {
    if (!this.isLoaded || this.duration === 0) return
    if (this.context.state === 'suspended') await this.context.resume()
    this.stopSources()
    this.offset = Math.max(0, Math.min(offset, this.duration - 0.01))
    const startAt = this.context.currentTime + 0.04
    this.startedAt = startAt
    for (const stem of stems) {
      const source = this.context.createBufferSource()
      source.buffer = this.buffers.get(stem)!
      source.playbackRate.value = tempo
      source.connect(this.gains.get(stem)!)
      source.onended = () => { if (this.sources.get(stem) === source) onEnded?.() }
      source.start(startAt, this.offset)
      this.sources.set(stem, source)
    }
  }

  pause() {
    this.offset = this.currentTime()
    this.stopSources()
    return this.offset
  }

  seek(offset: number, playing: boolean, tempo: number, onEnded?: () => void) {
    this.offset = Math.max(0, Math.min(offset, this.duration))
    if (playing) void this.play(this.offset, tempo, onEnded)
  }

  currentTime() {
    if (this.sources.size === 0) return this.offset
    return Math.min(this.duration, this.offset + Math.max(0, this.context.currentTime - this.startedAt))
  }

  setMix(stem: StemName, volume: number, muted: boolean, solo: StemName | null) {
    const audible = !muted && (solo === null || solo === stem)
    this.gains.get(stem)!.gain.value = audible ? volume : 0
  }

  setTempo(tempo: number) {
    for (const source of this.sources.values()) source.playbackRate.value = tempo
  }

  dispose() { this.stop(); void this.context.close() }

  private stop() { this.stopSources(); this.offset = 0 }
  private stopSources() {
    for (const source of this.sources.values()) { source.onended = null; try { source.stop() } catch { /* already stopped */ } }
    this.sources.clear()
  }
}
