export type StemName = 'vocals' | 'drums' | 'bass' | 'other'

export interface Track {
  id: string
  name: string
  path: string
  importedAt: string
  duration?: number
  stems?: Record<StemName, string>
  analysis?: TrackAnalysis
}

export interface TrackAnalysis {
  bpm: number
  key: string
  tuningHz: number
  confidence: number
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  trackIds: string[]
}

export interface SeparationProgress {
  trackId: string
  progress: number
  stage: string
}

export interface SeparationStatus {
  available: boolean
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
    read: (filePath: string) => Promise<Uint8Array>
    remove: (trackId: string) => Promise<void>
    chooseFile: () => Promise<Track | null>
  }
  projects: {
    list: () => Promise<Project[]>
    create: (name: string) => Promise<Project>
    rename: (projectId: string, name: string) => Promise<Project>
    remove: (projectId: string) => Promise<void>
    addTrack: (projectId: string, trackId: string) => Promise<Project>
    removeTrack: (projectId: string, trackId: string) => Promise<Project>
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
  analysis: {
    analyze: (trackId: string) => Promise<Track>
    update: (trackId: string, changes: Partial<TrackAnalysis>) => Promise<Track>
  }
}

export const STEM_LABELS: Record<StemName, string> = {
  vocals: 'Vocal',
  drums: 'Bateria',
  bass: 'Baixo',
  other: 'Outros',
}
