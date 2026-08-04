import { api } from './api'
import { ALL_STEMS, EQUALIZER_FREQUENCIES, type OutputRoute, type PlaybackChannel, type StemName, type Track } from '../shared/types'
import { SoundTouchNode } from '@soundtouchjs/audio-worklet'
import processorUrl from '@soundtouchjs/audio-worklet/processor?url'
import { playbackTransform, trackPlaybackSources } from './playback-sources'

const stems: StemName[] = ALL_STEMS
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
  private readonly inputs = new Map<StemName, AudioNode>()
  private readonly originalEqualizer: BiquadFilterNode[]
  private readonly originalInput: AudioNode
  private originalProcessor: SoundTouchNode | null = null
  private microphoneAnalyser: AnalyserNode | null = null
  private readonly buffers = new Map<StemName, AudioBuffer>()
  private originalBuffer: AudioBuffer | null = null
  private originalSource: AudioBufferSourceNode | null = null
  private takeBuffer: AudioBuffer | null = null
  private takeSource: AudioBufferSourceNode | null = null
  private readonly sources = new Map<StemName, AudioBufferSourceNode>()
  private readonly processors = new Map<StemName, SoundTouchNode>()
  private workletReady = false
  private startedAt = 0
  private offset = 0
  private duration = 0
  private tempo = 1
  private loadGeneration = 0

  constructor() {
    activePlayer = this
    for (const stem of stems) {
      const gain = this.context.createGain()
      const panner = this.context.createStereoPanner()
      gain.connect(panner).connect(this.context.destination)
      panner.connect(this.recordingDestination)
      this.gains.set(stem, gain)
      this.panners.set(stem, panner)
      const filters = EQUALIZER_FREQUENCIES.map((frequency) => {
        const filter = this.context.createBiquadFilter()
        filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1
        return filter
      })
      for (let index = 0; index < filters.length - 1; index += 1) filters[index].connect(filters[index + 1])
      filters.at(-1)?.connect(gain)
      this.equalizers.set(stem, filters)
      this.inputs.set(stem, filters[0] ?? gain)
    }
    this.originalEqualizer = EQUALIZER_FREQUENCIES.map((frequency) => {
      const filter = this.context.createBiquadFilter()
      filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1
      return filter
    })
    for (let index = 0; index < this.originalEqualizer.length - 1; index += 1) this.originalEqualizer[index].connect(this.originalEqualizer[index + 1])
    const originalOutput = this.originalEqualizer.at(-1)
    originalOutput?.connect(this.context.destination)
    originalOutput?.connect(this.recordingDestination)
    this.originalInput = this.originalEqualizer[0]
  }

  get length() { return this.duration }
  get isLoaded() { return this.originalBuffer !== null || this.buffers.size > 0 }
  get recordingStream() { return this.recordingDestination.stream }

  connectMicrophone(stream: MediaStream) {
    const source = this.context.createMediaStreamSource(stream)
    const analyser = this.context.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser).connect(this.recordingDestination)
    this.microphoneAnalyser = analyser
    return () => { source.disconnect(); analyser.disconnect(); if (this.microphoneAnalyser === analyser) this.microphoneAnalyser = null; stream.getTracks().forEach((track) => track.stop()) }
  }

  getMicrophoneLevel() {
    if (!this.microphoneAnalyser) return 0
    const samples = new Uint8Array(this.microphoneAnalyser.fftSize)
    this.microphoneAnalyser.getByteTimeDomainData(samples)
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length)
    return Math.min(1, rms * 2.2)
  }

  async load(track: Track, takePath?: string | null) {
    const generation = ++this.loadGeneration
    this.stop()
    this.buffers.clear()
    this.originalBuffer = null
    this.takeBuffer = null
    this.duration = 0
    // Decode one stem at a time. Promise.all temporarily retained the source
    // bytes and every decoded AudioBuffer at the same time.
    for (const source of trackPlaybackSources(track)) {
      const bytes = await api.library.read(source.path)
      const buffer = await this.context.decodeAudioData(asArrayBuffer(bytes))
      if (generation !== this.loadGeneration) return
      if (source.kind === 'original') this.originalBuffer = buffer
      else this.buffers.set(source.stem, buffer)
      this.duration = Math.max(this.duration, buffer.duration)
    }
    if (takePath) {
      const bytes = await api.library.read(takePath)
      const buffer = await this.context.decodeAudioData(asArrayBuffer(bytes))
      if (generation !== this.loadGeneration) return
      this.takeBuffer = buffer
    }
  }

  unload() {
    this.loadGeneration += 1
    this.stop()
    this.buffers.clear()
    this.originalBuffer = null
    this.takeBuffer = null
    this.duration = 0
  }

  async play(offset = this.offset, tempo = 1, pitch = 0, onEnded?: () => void) {
    if (!this.isLoaded || this.duration === 0) return
    if (this.context.state === 'suspended') await this.context.resume()
    const transform = playbackTransform(tempo, pitch)
    const { requiresTimeStretch } = transform
    if (requiresTimeStretch) await this.ensureWorklet()
    this.stopSources()
    this.offset = Math.max(0, Math.min(offset, this.duration - 0.01))
    this.tempo = tempo
    const startAt = this.context.currentTime + 0.04
    this.startedAt = startAt
    let ended = false
    for (const stem of this.buffers.keys()) {
      const source = this.context.createBufferSource()
      source.buffer = this.buffers.get(stem)!
      source.playbackRate.value = transform.tempo
      const processor = requiresTimeStretch ? this.processors.get(stem) : undefined
      if (processor) {
        processor.playbackRate.value = transform.tempo
        processor.pitchSemitones.value = transform.pitch
        source.connect(processor)
      } else {
        source.connect(this.inputs.get(stem) ?? this.gains.get(stem)!)
      }
      source.onended = () => {
        if (!ended && this.sources.get(stem) === source) {
          ended = true
          onEnded?.()
        }
      }
      source.start(startAt, this.offset)
      this.sources.set(stem, source)
    }
    if (this.originalBuffer) {
      const source = this.context.createBufferSource()
      source.buffer = this.originalBuffer
      source.playbackRate.value = transform.tempo
      if (requiresTimeStretch && this.originalProcessor) {
        this.originalProcessor.playbackRate.value = transform.tempo
        this.originalProcessor.pitchSemitones.value = transform.pitch
        source.connect(this.originalProcessor)
      } else {
        source.connect(this.originalInput)
      }
      source.onended = () => {
        if (!ended && this.originalSource === source) {
          ended = true
          onEnded?.()
        }
      }
      source.start(startAt, this.offset)
      this.originalSource = source
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
    if (this.sources.size === 0 && !this.originalSource) return this.offset
    return Math.min(this.duration, this.offset + Math.max(0, this.context.currentTime - this.startedAt) * this.tempo)
  }

  setMix(stem: StemName, volume: number, muted: boolean, solo: StemName | null) {
    if (!this.gains.has(stem)) return
    const audible = !muted && (solo === null || solo === stem)
    this.gains.get(stem)!.gain.value = audible ? volume : 0
  }

  setPan(stem: StemName, pan: number) {
    const panner = this.panners.get(stem)
    if (panner) panner.pan.value = Math.max(-1, Math.min(1, pan))
  }

  setOutputRoute(stem: StemName, route: OutputRoute, pan: number) {
    this.setPan(stem, route === 'left' ? -1 : route === 'right' ? 1 : pan)
  }

  setEqualizer(channel: PlaybackChannel, gains: number[]) {
    const filters = channel === 'original' ? this.originalEqualizer : this.equalizers.get(channel)
    filters?.forEach((filter, index) => { filter.gain.value = gains[index] ?? 0 })
  }

  setTempo(tempo: number) {
    if (this.sources.size > 0 || this.originalSource) {
      this.offset = this.currentTime()
      this.startedAt = this.context.currentTime
    }
    this.originalProcessor?.playbackRate.setValueAtTime(tempo, this.context.currentTime)
    this.tempo = tempo
    for (const stem of stems) {
      this.sources.get(stem)?.playbackRate.setValueAtTime(tempo, this.context.currentTime)
      const processor = this.processors.get(stem)
      if (processor) processor.playbackRate.setValueAtTime(tempo, this.context.currentTime)
    }
    this.originalSource?.playbackRate.setValueAtTime(tempo, this.context.currentTime)
    this.takeSource?.playbackRate.setValueAtTime(tempo, this.context.currentTime)
  }

  setPitch(pitch: number) {
    for (const processor of this.processors.values()) processor.pitchSemitones.setValueAtTime(pitch, this.context.currentTime)
    this.originalProcessor?.pitchSemitones.setValueAtTime(pitch, this.context.currentTime)
  }

  dispose() { this.unload(); if (activePlayer === this) activePlayer = null; void this.context.close() }

  private stop() { this.stopSources(); this.offset = 0 }
  private stopSources() {
    for (const source of this.sources.values()) {
      source.onended = null
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    }
    this.sources.clear()
    if (this.originalSource) {
      this.originalSource.onended = null
      try { this.originalSource.stop() } catch { /* already stopped */ }
      this.originalSource.disconnect()
      this.originalSource = null
    }
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
      processor.connect(this.inputs.get(stem) ?? this.gains.get(stem)!)
      this.processors.set(stem, processor)
    }
    this.originalProcessor = new SoundTouchNode({ context: this.context })
    this.originalProcessor.connect(this.originalInput)
    this.workletReady = true
  }
}
