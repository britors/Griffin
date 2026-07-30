import { contextBridge, ipcRenderer } from 'electron'
import type { AudioExportOptions, ChordExportFormat, GriffinAPI, LyricsLine, PlayerSnapshot, SeparationProgress, Track, TrackAnalysis } from '../shared/types'

const api: GriffinAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  },
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    import: (filePath?: string) => ipcRenderer.invoke('library:import', filePath),
    read: (filePath: string) => ipcRenderer.invoke('library:read', filePath),
    remove: (trackId: string) => ipcRenderer.invoke('library:remove', trackId),
    chooseFile: () => ipcRenderer.invoke('library:choose-file'),
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
  performance: { save: (name: string, bytes: Uint8Array) => ipcRenderer.invoke('performance:save', name, bytes) },
  chords: { export: (trackId: string, format: ChordExportFormat) => ipcRenderer.invoke('chords:export', trackId, format) },
  separation: {
    status: () => ipcRenderer.invoke('separation:status'),
    start: (track: Track) => ipcRenderer.invoke('separation:start', track),
    cancel: (trackId: string) => ipcRenderer.invoke('separation:cancel', trackId),
    onProgress: (callback: (progress: SeparationProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: SeparationProgress) => callback(progress)
      ipcRenderer.on('separation:progress', listener)
      return () => ipcRenderer.removeListener('separation:progress', listener)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },
}

contextBridge.exposeInMainWorld('griffin', api)
