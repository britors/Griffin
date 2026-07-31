import { contextBridge, ipcRenderer } from 'electron'
import type { AudioExportOptions, AudioExportProgress, ChordExportFormat, GriffinAPI, LyricsLine, ModelDownloadKind, ModelDownloadProgress, PlayerSnapshot, SeparationProgress, SeparationProvider, StemName, Track, TrackAnalysis, YoutubeImportProgress } from '../shared/types'

const api: GriffinAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    import: (filePath?: string) => ipcRenderer.invoke('library:import', filePath),
    importMany: (filePaths?: string[]) => ipcRenderer.invoke('library:import-many', filePaths),
    read: (filePath: string) => ipcRenderer.invoke('library:read', filePath),
    remove: (trackId: string) => ipcRenderer.invoke('library:remove', trackId),
    chooseFile: () => ipcRenderer.invoke('library:choose-file'),
    chooseFiles: () => ipcRenderer.invoke('library:choose-files'),
    previewUrl: (url: string) => ipcRenderer.invoke('library:preview-url', url),
    importUrl: (assetId: string) => ipcRenderer.invoke('library:import-url', assetId),
    cancelRemoteImport: (assetId: string) => ipcRenderer.invoke('library:cancel-remote-import', assetId),
    youtubePreview: (url: string) => ipcRenderer.invoke('library:youtube-preview', url),
    youtubeImport: (previewId: string) => ipcRenderer.invoke('library:youtube-import', previewId),
    youtubeCancel: (previewId: string) => ipcRenderer.invoke('library:youtube-cancel', previewId),
    onYoutubeProgress: (callback: (progress: YoutubeImportProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: YoutubeImportProgress) => callback(progress)
      ipcRenderer.on('library:youtube-progress', listener)
      return () => ipcRenderer.removeListener('library:youtube-progress', listener)
    },
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (name: string) => ipcRenderer.invoke('projects:create', name),
    rename: (projectId: string, name: string) => ipcRenderer.invoke('projects:rename', projectId, name),
    remove: (projectId: string) => ipcRenderer.invoke('projects:remove', projectId),
    addTrack: (projectId: string, trackId: string) => ipcRenderer.invoke('projects:add-track', projectId, trackId),
    removeTrack: (projectId: string, trackId: string) => ipcRenderer.invoke('projects:remove-track', projectId, trackId),
    moveTrack: (projectId: string, trackId: string, direction: 'up' | 'down') => ipcRenderer.invoke('projects:move-track', projectId, trackId, direction),
    createSnapshot: (projectId: string, name: string, player: PlayerSnapshot) => ipcRenderer.invoke('projects:create-snapshot', projectId, name, player),
    restoreSnapshot: (projectId: string, snapshotId: string) => ipcRenderer.invoke('projects:restore-snapshot', projectId, snapshotId),
    removeSnapshot: (projectId: string, snapshotId: string) => ipcRenderer.invoke('projects:remove-snapshot', projectId, snapshotId),
    updatePlayerState: (projectId: string, player: PlayerSnapshot) => ipcRenderer.invoke('projects:update-player-state', projectId, player),
  },
  analysis: {
    analyze: (trackId: string) => ipcRenderer.invoke('analysis:analyze', trackId),
    update: (trackId: string, changes: Partial<TrackAnalysis>) => ipcRenderer.invoke('analysis:update', trackId, changes),
  },
  lyrics: {
    get: (trackId: string) => ipcRenderer.invoke('lyrics:get', trackId),
    update: (trackId: string, lines: LyricsLine[]) => ipcRenderer.invoke('lyrics:update', trackId, lines),
  },
  exportAudio: (trackId: string, options: AudioExportOptions) => ipcRenderer.invoke('export:audio', trackId, options),
  cancelExport: (requestId: string) => ipcRenderer.invoke('export:cancel', requestId),
  onExportProgress: (callback: (progress: AudioExportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: AudioExportProgress) => callback(progress)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  performance: { save: (name: string, bytes: Uint8Array) => ipcRenderer.invoke('performance:save', name, bytes) },
  chords: { export: (trackId: string, format: ChordExportFormat) => ipcRenderer.invoke('chords:export', trackId, format) },
  separation: {
    status: () => ipcRenderer.invoke('separation:status'),
    start: (track: Track, target?: StemName, provider?: SeparationProvider) => ipcRenderer.invoke('separation:start', track, target, provider),
    cancel: (trackId: string) => ipcRenderer.invoke('separation:cancel', trackId),
    onProgress: (callback: (progress: SeparationProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: SeparationProgress) => callback(progress)
      ipcRenderer.on('separation:progress', listener)
      return () => ipcRenderer.removeListener('separation:progress', listener)
    },
  },
  remoteProvider: {
    status: () => ipcRenderer.invoke('remote-provider:status'),
    saveApiKey: (key: string) => ipcRenderer.invoke('remote-provider:save-key', key),
    clearApiKey: () => ipcRenderer.invoke('remote-provider:clear-key'),
    estimateCost: (trackId: string) => ipcRenderer.invoke('remote-provider:estimate-cost', trackId),
  },
  models: {
    status: () => ipcRenderer.invoke('models:status'),
    download: (kind: ModelDownloadKind) => ipcRenderer.invoke('models:download', kind),
    cancel: (kind: ModelDownloadKind) => ipcRenderer.invoke('models:cancel', kind),
    onProgress: (callback: (progress: ModelDownloadProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: ModelDownloadProgress) => callback(progress)
      ipcRenderer.on('models:progress', listener)
      return () => ipcRenderer.removeListener('models:progress', listener)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },
  resources: {
    summary: () => ipcRenderer.invoke('resources:summary'),
    clearCache: () => ipcRenderer.invoke('resources:clear-cache'),
  },
}

contextBridge.exposeInMainWorld('griffin', api)
