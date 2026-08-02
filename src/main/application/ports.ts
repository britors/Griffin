import type { AudioTrack } from '../../shared/domain/audio-track'
import type { AudioExportOptions, AudioExportProgress, ChordExportFormat, ChordEvent, ModelDownloadKind, ModelDownloadProgress, ModelDownloadStatus, RemoteAudioAsset, SeparationProgress, SeparationStatus, StemName, Track, TrackAnalysis, YoutubeAudioPreview, YoutubeImportProgress } from '../../shared/types'
import type { Project } from '../../shared/types'

export interface TrackRepository {
  init(): Promise<void>
  list(): Promise<AudioTrack[]>
  findById(id: string): Promise<AudioTrack | null>
  findByPath(path: string): Promise<AudioTrack | null>
  save(track: AudioTrack): Promise<AudioTrack>
  remove(id: string): Promise<void>
}

export interface ProjectRepository {
  init(): Promise<void>
  list(): Promise<Project[]>
  findById(id: string): Promise<Project | null>
  save(project: Project): Promise<Project>
  remove(id: string): Promise<void>
}

export interface AudioFileGateway {
  isSupported(path: string): boolean
  describe(path: string): Promise<{ name: string }>
  read(path: string): Promise<Uint8Array>
}

export interface AudioFilePicker {
  pick(): Promise<string | null>
  pickMany(): Promise<string[]>
}

export interface AudioDecoder {
  decode(bytes: Uint8Array): Promise<{ channelData: Float32Array[]; sampleRate: number }>
}

export interface AudioExportDestination {
  choose(defaultName: string): Promise<string | null>
  chooseDirectory(): Promise<string | null>
  write(path: string, bytes: Uint8Array): Promise<void>
}

export interface AudioRecordingDestination {
  choose(defaultName: string): Promise<string | null>
  write(path: string, bytes: Uint8Array): Promise<void>
}

export interface ChordExportDestination {
  choose(defaultName: string, format: ChordExportFormat): Promise<string | null>
  write(path: string, bytes: Uint8Array): Promise<void>
}

export interface ChordNotationExporter {
  render(chords: ChordEvent[], bpm: number, duration: number, format: ChordExportFormat): Uint8Array
}

export interface AudioExportProcessor {
  render(stems: Record<StemName, string>, options: AudioExportOptions, report: (progress: number, stage: string) => void, isCancelled: () => boolean): Promise<{ bytes: Uint8Array; duration: number }>
}

export interface StemSeparator {
  init(): Promise<void>
  status(): Promise<SeparationStatus>
  separate(track: AudioTrack, report: (progress: SeparationProgress) => void, target?: StemName): Promise<Partial<Record<StemName, string>>>
  cancel(trackId: string): void
}

export interface SettingsRepository {
  get(): Promise<Record<string, unknown>>
  set(key: string, value: unknown): Promise<void>
}

export interface AudioAnalyzer {
  analyze(bytes: Uint8Array): Promise<TrackAnalysis>
}

export interface RemoteAudioDownloader {
  download(url: string, signal?: AbortSignal): Promise<RemoteAudioAsset>
  cleanup(asset: RemoteAudioAsset): Promise<void>
}

export interface YoutubeAudioDownloader {
  inspect(url: string): Promise<YoutubeAudioPreview>
  download(url: string, report?: (progress: Omit<YoutubeImportProgress, 'id' | 'stage'> & { stage: YoutubeImportProgress['stage'] }) => void): Promise<RemoteAudioAsset>
  cleanup(asset: RemoteAudioAsset): Promise<void>
}

export interface SecretStore {
  isAvailable(): boolean
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface ModelDownloader {
  status(): Promise<ModelDownloadStatus>
  download(kind: ModelDownloadKind, report: (progress: ModelDownloadProgress) => void, signal: AbortSignal): Promise<void>
}

export type TrackSnapshot = Track
