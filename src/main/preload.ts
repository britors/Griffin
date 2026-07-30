import { contextBridge, ipcRenderer } from 'electron'
import type { GriffinAPI, SeparationProgress, Track } from '../shared/types'

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
