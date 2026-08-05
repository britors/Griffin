export type StemName = 'vocals' | 'drums' | 'bass' | 'other' | 'guitar' | 'piano'
export type PlaybackChannel = StemName | 'original'
export const CORE_STEMS: StemName[] = ['vocals', 'drums', 'bass', 'other']
export const ALL_STEMS: StemName[] = [...CORE_STEMS, 'guitar', 'piano']
export type SeparationTarget = StemName | 'all'
export type OutputRoute = 'stereo' | 'left' | 'right'

export const EQUALIZER_FREQUENCIES = [32, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000, 20000] as const
export type EqualizerBands = number[]
export type AudioExportMode = 'mix' | 'individual'
export type AudioExportFormat = 'wav' | 'mp3' | 'flac'
export type SeparationProfile = 'quality' | 'balanced' | 'speed'
export type ExecutionProviderPreference = 'auto' | 'cpu' | 'cuda'
export type SeparationModelProfile = 'four-stem' | 'six-stem'

export interface Track {
  id: string
  name: string
  path: string
  importedAt: string
  duration?: number
  stems?: Partial<Record<StemName, string>>
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
  volumes: Partial<Record<StemName, number>>
  pans: Partial<Record<StemName, number>>
  routes: Partial<Record<StemName, OutputRoute>>
  equalizer: Partial<Record<StemName, EqualizerBands>>
  muted: Partial<Record<StemName, boolean>>
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
  folderId?: string | null
  filePath?: string | null
  fileSavedAt?: string | null
  snapshots?: ProjectSnapshot[]
  playerState?: PlayerSnapshot
}

export interface ProjectFolder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  updatedAt: string
}

export interface GriffinProjectFile {
  format: 'griffin-project'
  version: 1 | 2
  savedAt: string
  project: Project
  folders: ProjectFolder[]
  tracks: Track[]
}

export interface ProjectOpenResult {
  project: Project
  folders: ProjectFolder[]
  tracks: Track[]
  missingTracks: string[]
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
  volumes: Partial<Record<StemName, number>>
  pans: Partial<Record<StemName, number>>
  routes: Partial<Record<StemName, OutputRoute>>
  equalizer: Partial<Record<PlaybackChannel, EqualizerBands>>
  muted: Partial<Record<StemName, boolean>>
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
  modelProfile?: SeparationModelProfile
  sixStemAvailable?: boolean
}

export type SeparationProvider = 'local' | 'remote'

export interface RemoteSeparationStatus {
  configured: boolean
  verified: boolean
  balanceFormatted?: string
  message: string
}

export interface RemoteCostEstimate {
  durationSeconds: number
  estimatedUsd: number
}

export type ModelDownloadKind = 'standard' | 'extended'

export interface ModelDownloadProgress {
  kind: ModelDownloadKind
  progress: number
  stage: string
}

export interface ModelDownloadStatus {
  standardInstalled: boolean
  extendedInstalled: boolean
  downloading: ModelDownloadKind | null
  paused: ModelDownloadKind | null
}

export interface CudaRuntimeStatus {
  supported: boolean
  installed: boolean
  downloading: boolean
  paused: boolean
  state?: 'installed' | 'installing' | 'incomplete' | 'error'
  downloadBytes?: number
  version?: string
  message: string
}

export interface CudaRuntimeProgress {
  progress: number
  stage: string
}

export type AppUpdateStage = 'disabled' | 'system' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error'

export interface AppUpdateStatus {
  supported: boolean
  stage: AppUpdateStage
  version?: string
  progress?: number
  message: string
}

export interface LocalResourcesSummary {
  cachePath: string
  cacheBytes: number
  modelPath: string
  modelBytes: number
}

export interface DiagnosticsSaveResult {
  path: string
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

export type RemoteAudioPreview = Omit<RemoteAudioAsset, 'tempPath' | 'mediaHash'>

export interface YoutubeAudioPreview {
  id: string
  url: string
  title: string
  duration?: number
  format: 'wav'
}

export type YoutubeImportStage = 'downloading' | 'converting' | 'importing'

export interface YoutubeImportProgress {
  id: string
  progress: number
  stage: YoutubeImportStage
  message: string
}

export interface YtDlpStatus {
  installed: boolean
  downloading: boolean
  paused: boolean
  asset: string
  version?: string
  path?: string
  message: string
}

export interface YtDlpProgress {
  progress: number
  stage: 'downloading' | 'verifying' | 'ready'
  message: string
}

export interface PreparationProgress {
  progress: number
  message: string
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
    rename: (trackId: string, name: string) => Promise<Track>
    previewUrl: (url: string) => Promise<RemoteAudioPreview>
    importUrl: (assetId: string) => Promise<Track>
    cancelRemoteImport: (assetId: string) => Promise<void>
    youtubePreview: (url: string) => Promise<YoutubeAudioPreview>
    youtubeImport: (previewId: string, fallbackUrl?: string) => Promise<Track>
    youtubeCancel: (previewId: string) => Promise<void>
    onYoutubeProgress: (callback: (progress: YoutubeImportProgress) => void) => () => void
  }
  ytDlp: {
    status: () => Promise<YtDlpStatus>
    download: () => Promise<void>
    cancel: () => Promise<void>
    pause: () => Promise<void>
    onProgress: (callback: (progress: YtDlpProgress) => void) => () => void
  }
  preparation: {
    resumePending: () => Promise<boolean>
    onProgress: (callback: (progress: PreparationProgress) => void) => () => void
  }
  projects: {
    list: () => Promise<Project[]>
    listFolders: () => Promise<ProjectFolder[]>
    create: (name: string) => Promise<Project>
    rename: (projectId: string, name: string) => Promise<Project>
    remove: (projectId: string) => Promise<void>
    createFolder: (name: string, parentId?: string | null) => Promise<ProjectFolder>
    renameFolder: (folderId: string, name: string) => Promise<ProjectFolder>
    removeFolder: (folderId: string) => Promise<void>
    move: (projectId: string, folderId: string | null) => Promise<Project>
    addTrack: (projectId: string, trackId: string) => Promise<Project>
    removeTrack: (projectId: string, trackId: string) => Promise<Project>
    moveTrack: (projectId: string, trackId: string, direction: 'up' | 'down') => Promise<Project>
    createSnapshot: (projectId: string, name: string, player: PlayerSnapshot) => Promise<Project>
    restoreSnapshot: (projectId: string, snapshotId: string) => Promise<ProjectSnapshot>
    removeSnapshot: (projectId: string, snapshotId: string) => Promise<Project>
    updatePlayerState: (projectId: string, player: PlayerSnapshot) => Promise<Project>
    saveAs: (projectId: string) => Promise<Project | null>
    save: (projectId: string) => Promise<Project>
    open: () => Promise<ProjectOpenResult | null>
  }
  separation: {
    status: () => Promise<SeparationStatus>
    start: (track: Track, target?: StemName, provider?: SeparationProvider) => Promise<Track>
    cancel: (trackId: string) => Promise<void>
    pause: (trackId: string) => Promise<void>
    resume: (trackId: string) => Promise<void>
    onProgress: (callback: (progress: SeparationProgress) => void) => () => void
  }
  remoteProvider: {
    status: () => Promise<RemoteSeparationStatus>
    saveApiKey: (key: string) => Promise<RemoteSeparationStatus>
    clearApiKey: () => Promise<RemoteSeparationStatus>
    estimateCost: (trackId: string) => Promise<RemoteCostEstimate>
  }
  models: {
    status: () => Promise<ModelDownloadStatus>
    download: (kind: ModelDownloadKind) => Promise<void>
    cancel: (kind: ModelDownloadKind) => Promise<void>
    pause: (kind: ModelDownloadKind) => Promise<void>
    onProgress: (callback: (progress: ModelDownloadProgress) => void) => () => void
  }
  cudaRuntime: {
    status: () => Promise<CudaRuntimeStatus>
    install: () => Promise<void>
    update: () => Promise<void>
    cancel: () => Promise<void>
    pause: () => Promise<void>
    onProgress: (callback: (progress: CudaRuntimeProgress) => void) => () => void
  }
  updates: {
    status: () => Promise<AppUpdateStatus>
    check: (force?: boolean) => Promise<AppUpdateStatus>
    download: () => Promise<AppUpdateStatus>
    cancel: () => Promise<AppUpdateStatus>
    install: () => Promise<void>
    onStatus: (callback: (status: AppUpdateStatus) => void) => () => void
  }
  version: () => Promise<string>
  settings: {
    get: () => Promise<Record<string, unknown>>
    set: (key: string, value: unknown) => Promise<void>
  }
  resources: {
    summary: () => Promise<LocalResourcesSummary>
    clearCache: () => Promise<LocalResourcesSummary>
  }
  diagnostics: {
    log: (event: string, detail?: string) => Promise<void>
    collect: () => Promise<string>
    previous: () => Promise<string | null>
    clearPrevious: () => Promise<void>
    save: (report: string) => Promise<DiagnosticsSaveResult>
    openLogs: () => Promise<void>
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
  guitar: 'Guitarra',
  piano: 'Piano',
}
