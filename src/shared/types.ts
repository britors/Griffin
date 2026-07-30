export type StemName = 'vocals' | 'drums' | 'bass' | 'other'
export type OutputRoute = 'stereo' | 'left' | 'right'

export const EQUALIZER_FREQUENCIES = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000] as const
export type EqualizerBands = number[]
export type AudioExportMode = 'mix' | 'individual'
export type AudioExportFormat = 'wav' | 'mp3' | 'flac'
export type SeparationProfile = 'quality' | 'balanced' | 'speed'
export type ExecutionProviderPreference = 'auto' | 'cpu' | 'cuda'

export interface Track {
  id: string
  name: string
  path: string
  importedAt: string
  duration?: number
  stems?: Record<StemName, string>
  analysis?: TrackAnalysis
  lyrics?: LyricsLine[]
}

export interface LyricsLine {
  id: string
  text: string
  start: number
  end: number
}

export interface TrackAnalysis {
  bpm: number
  key: string
  tuningHz: number
  confidence: number
  sections?: TrackSection[]
  chords?: ChordEvent[]
}

export interface TrackSection {
  id: string
  name: string
  start: number
  end: number
  confidence: number
}

export interface ChordEvent {
  id: string
  name: string
  start: number
  end: number
  confidence: number
}

export interface AudioExportOptions {
  stems: StemName[]
  volumes: Record<StemName, number>
  pans: Record<StemName, number>
  routes: Record<StemName, OutputRoute>
  equalizer: Record<StemName, EqualizerBands>
  muted: Record<StemName, boolean>
  solo: StemName | null
  mode?: AudioExportMode
  pitch: number
  tempo: number
  loop?: { start: number; end: number }
  format: AudioExportFormat
  sampleRate: 44100 | 48000
  bitDepth: 16 | 24
  requestId?: string
}

export interface AudioExportResult {
  path: string
  paths: string[]
  duration: number
  format: 'wav'
  sampleRate: 44100 | 48000
  bitDepth: 16 | 24
}

export interface AudioExportProgress {
  requestId: string
  progress: number
  stage: string
}

export interface PerformanceSaveResult {
  path: string
  name: string
}

export type ChordExportFormat = 'midi' | 'pdf'

export interface ChordExportResult {
  path: string
  format: ChordExportFormat
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  trackIds: string[]
  snapshots?: ProjectSnapshot[]
  playerState?: PlayerSnapshot
}

export interface PlayerSnapshot {
  selectedTrackId: string | null
  takePath?: string | null
  takeName?: string | null
  position: number
  pitch: number
  tempo: number
  loopEnabled: boolean
  loopStart: number
  loopEnd: number
  volumes: Record<StemName, number>
  pans: Record<StemName, number>
  routes: Record<StemName, OutputRoute>
  equalizer: Record<StemName, EqualizerBands>
  muted: Record<StemName, boolean>
  solo: StemName | null
}

export interface ProjectSnapshot {
  id: string
  name: string
  createdAt: string
  trackIds: string[]
  player: PlayerSnapshot
}

export interface SeparationProgress {
  trackId: string
  progress: number
  stage: string
}

export interface SeparationStatus {
  available: boolean
  message: string
  provider?: 'cpu' | 'cuda'
  profile?: SeparationProfile
  memoryBytes?: number
  lastDurationMs?: number
}

export interface LocalResourcesSummary {
  cachePath: string
  cacheBytes: number
  modelPath: string
  modelBytes: number
}

export interface RemoteAudioAsset {
  id: string
  url: string
  tempPath: string
  fileName: string
  format: 'wav' | 'mp3' | 'flac'
  sizeBytes: number
  duration?: number
  sourceHash: string
  mediaHash: string
  cacheKey: string
}

export interface GriffinAPI {
  window: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
  }
  library: {
    list: () => Promise<Track[]>
    import: (filePath?: string) => Promise<Track | null>
    importMany: (filePaths?: string[]) => Promise<Track[]>
    read: (filePath: string) => Promise<Uint8Array>
    remove: (trackId: string) => Promise<void>
    chooseFile: () => Promise<Track | null>
    chooseFiles: () => Promise<Track[]>
  }
  projects: {
    list: () => Promise<Project[]>
    create: (name: string) => Promise<Project>
    rename: (projectId: string, name: string) => Promise<Project>
    remove: (projectId: string) => Promise<void>
    addTrack: (projectId: string, trackId: string) => Promise<Project>
    removeTrack: (projectId: string, trackId: string) => Promise<Project>
    moveTrack: (projectId: string, trackId: string, direction: 'up' | 'down') => Promise<Project>
    createSnapshot: (projectId: string, name: string, player: PlayerSnapshot) => Promise<Project>
    restoreSnapshot: (projectId: string, snapshotId: string) => Promise<ProjectSnapshot>
  removeSnapshot: (projectId: string, snapshotId: string) => Promise<Project>
    updatePlayerState: (projectId: string, player: PlayerSnapshot) => Promise<Project>
  }
  separation: {
    status: () => Promise<SeparationStatus>
    start: (track: Track) => Promise<Track>
    cancel: (trackId: string) => Promise<void>
    onProgress: (callback: (progress: SeparationProgress) => void) => () => void
  }
  settings: {
    get: () => Promise<Record<string, unknown>>
    set: (key: string, value: unknown) => Promise<void>
  }
  resources: {
    summary: () => Promise<LocalResourcesSummary>
    clearCache: () => Promise<LocalResourcesSummary>
  }
  analysis: {
    analyze: (trackId: string) => Promise<Track>
    update: (trackId: string, changes: Partial<TrackAnalysis>) => Promise<Track>
  }
  lyrics: {
    get: (trackId: string) => Promise<LyricsLine[]>
    update: (trackId: string, lines: LyricsLine[]) => Promise<Track>
  }
  exportAudio: (trackId: string, options: AudioExportOptions) => Promise<AudioExportResult>
  cancelExport: (requestId: string) => Promise<void>
  onExportProgress: (callback: (progress: AudioExportProgress) => void) => () => void
  performance: {
    save: (name: string, bytes: Uint8Array) => Promise<PerformanceSaveResult>
  }
  chords: {
    export: (trackId: string, format: ChordExportFormat) => Promise<ChordExportResult>
  }
}

export const STEM_LABELS: Record<StemName, string> = {
  vocals: 'Vocal',
  drums: 'Bateria',
  bass: 'Baixo',
  other: 'Outros',
}
