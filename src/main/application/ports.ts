import type { AudioTrack } from '../../shared/domain/audio-track'
import type { SeparationProgress, SeparationStatus, StemName, Track, TrackAnalysis } from '../../shared/types'
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
}

export interface StemSeparator {
  init(): Promise<void>
  status(): Promise<SeparationStatus>
  separate(track: AudioTrack, report: (progress: SeparationProgress) => void): Promise<Record<StemName, string>>
  cancel(trackId: string): void
}

export interface SettingsRepository {
  get(): Promise<Record<string, unknown>>
  set(key: string, value: unknown): Promise<void>
}

export interface AudioAnalyzer {
  analyze(bytes: Uint8Array): Promise<TrackAnalysis>
}

export type TrackSnapshot = Track
