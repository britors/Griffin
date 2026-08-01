import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AudioExportOptions, AudioExportProgress, ChordExportFormat, CudaRuntimeProgress, CudaRuntimeStatus, GriffinAPI, LyricsLine, ModelDownloadKind, ModelDownloadProgress, PlayerSnapshot, SeparationProgress, SeparationProvider, StemName, Track, TrackAnalysis, YoutubeImportProgress, YtDlpProgress, YtDlpStatus } from '../shared/types'

type Unlisten = () => void

function onEvent<T>(name: string, callback: (payload: T) => void): Unlisten {
  let disposed = false
  let unlisten: Unlisten = () => {}
  void listen<T>(name, (event) => callback(event.payload)).then((remove) => {
    if (disposed) remove()
    else unlisten = remove
  })
  return () => { disposed = true; unlisten() }
}

async function readBytes(filePath: string) {
  const response = await invoke<ArrayBuffer | Uint8Array>('library_read', { filePath })
  return response instanceof Uint8Array
    ? new Uint8Array(response.buffer, response.byteOffset, response.byteLength)
    : new Uint8Array(response)
}

export const api: GriffinAPI = {
  window: {
    minimize: () => invoke('window_minimize'),
    toggleMaximize: () => invoke<boolean>('window_toggle_maximize'),
    close: () => invoke('window_close'),
  },
  library: {
    list: () => invoke<Track[]>('library_list'),
    import: (filePath?: string) => invoke<Track | null>('library_import', { filePath }),
    importMany: (filePaths?: string[]) => invoke<Track[]>('library_import_many', { filePaths }),
    read: readBytes,
    remove: (trackId: string) => invoke('library_remove', { trackId }),
    chooseFile: () => invoke<Track | null>('library_choose_file'),
    chooseFiles: () => invoke<Track[]>('library_choose_files'),
    previewUrl: (url: string) => invoke('library_preview_url', { url }),
    importUrl: (assetId: string) => invoke<Track>('library_import_url', { assetId }),
    cancelRemoteImport: (assetId: string) => invoke('library_cancel_remote_import', { assetId }),
    youtubePreview: (url: string) => invoke('youtube_preview', { url }),
    youtubeImport: (previewId: string, fallbackUrl?: string) => invoke<Track>('youtube_import', { previewId, fallbackUrl }),
    youtubeCancel: (previewId: string) => invoke('youtube_cancel', { previewId }),
    onYoutubeProgress: (callback: (progress: YoutubeImportProgress) => void) => onEvent('library:youtube-progress', callback),
  },
  ytDlp: {
    status: () => invoke<YtDlpStatus>('yt_dlp_status'),
    download: () => invoke('yt_dlp_download'),
    cancel: () => invoke('yt_dlp_cancel'),
    onProgress: (callback: (progress: YtDlpProgress) => void) => onEvent('yt-dlp:progress', callback),
  },
  projects: {
    list: () => invoke('projects_list'),
    create: (name: string) => invoke('projects_create', { name }),
    rename: (projectId: string, name: string) => invoke('projects_rename', { projectId, name }),
    remove: (projectId: string) => invoke('projects_remove', { projectId }),
    addTrack: (projectId: string, trackId: string) => invoke('projects_add_track', { projectId, trackId }),
    removeTrack: (projectId: string, trackId: string) => invoke('projects_remove_track', { projectId, trackId }),
    moveTrack: (projectId: string, trackId: string, direction: 'up' | 'down') => invoke('projects_move_track', { projectId, trackId, direction }),
    createSnapshot: (projectId: string, name: string, player: PlayerSnapshot) => invoke('projects_create_snapshot', { projectId, name, player }),
    restoreSnapshot: (projectId: string, snapshotId: string) => invoke('projects_restore_snapshot', { projectId, snapshotId }),
    removeSnapshot: (projectId: string, snapshotId: string) => invoke('projects_remove_snapshot', { projectId, snapshotId }),
    updatePlayerState: (projectId: string, player: PlayerSnapshot) => invoke('projects_update_player_state', { projectId, player }),
  },
  analysis: {
    analyze: (trackId: string) => invoke('analysis_analyze', { trackId }),
    update: (trackId: string, changes: Partial<TrackAnalysis>) => invoke('analysis_update', { trackId, changes }),
  },
  lyrics: {
    get: (trackId: string) => invoke<LyricsLine[]>('lyrics_get', { trackId }),
    update: (trackId: string, lines: LyricsLine[]) => invoke('lyrics_update', { trackId, lines }),
  },
  exportAudio: (trackId: string, options: AudioExportOptions) => invoke('export_audio', { trackId, options: { ...options, loopRange: options.loop, loop: undefined } }),
  cancelExport: (requestId: string) => invoke('export_cancel', { requestId }),
  onExportProgress: (callback: (progress: AudioExportProgress) => void) => onEvent('export:progress', callback),
  performance: { save: (name: string, bytes: Uint8Array) => invoke('performance_save', { name, bytes: Array.from(bytes) }) },
  chords: { export: (trackId: string, format: ChordExportFormat) => invoke('chords_export', { trackId, format }) },
  separation: {
    status: () => invoke('separation_status'),
    start: (track: Track, target?: StemName, provider?: SeparationProvider) => invoke('separation_start', { track, target, provider }),
    cancel: (trackId: string) => invoke('separation_cancel', { trackId }),
    onProgress: (callback: (progress: SeparationProgress) => void) => onEvent('separation:progress', callback),
  },
  remoteProvider: {
    status: () => invoke('remote_provider_status'),
    saveApiKey: (key: string) => invoke('remote_provider_save_api_key', { key }),
    clearApiKey: () => invoke('remote_provider_clear_api_key'),
    estimateCost: (trackId: string) => invoke('remote_provider_estimate_cost', { trackId }),
  },
  models: {
    status: () => invoke('models_status'),
    download: (kind: ModelDownloadKind) => invoke('models_download', { kind }),
    cancel: (kind: ModelDownloadKind) => invoke('models_cancel', { kind }),
    onProgress: (callback: (progress: ModelDownloadProgress) => void) => onEvent('models:progress', callback),
  },
  cudaRuntime: {
    status: () => invoke<CudaRuntimeStatus>('cuda_runtime_status'),
    install: () => invoke('cuda_runtime_install'),
    cancel: () => invoke('cuda_runtime_cancel'),
    onProgress: (callback: (progress: CudaRuntimeProgress) => void) => onEvent('cuda-runtime:progress', callback),
  },
  updates: {
    status: () => invoke('updates_status'),
    check: () => invoke('updates_check'),
    download: () => invoke('updates_download'),
    install: () => invoke('updates_install'),
    onStatus: (callback) => onEvent('updates:status', callback),
  },
  settings: {
    get: () => invoke('settings_get'),
    set: (key, value) => invoke('settings_set', { key, value }),
  },
  resources: {
    summary: () => invoke('resources_summary'),
    clearCache: () => invoke('resources_clear_cache'),
  },
}
