import { Channel, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { BundleType, getBundleType } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import type { AudioExportOptions, AudioExportProgress, ChordExportFormat, CudaRuntimeProgress, CudaRuntimeStatus, GriffinAPI, LyricsLine, ModelDownloadKind, ModelDownloadProgress, PlayerSnapshot, Project, ProjectFolder, ProjectOpenResult, SeparationProgress, SeparationProvider, StemName, Track, TrackAnalysis, YoutubeImportProgress, YtDlpProgress, YtDlpStatus } from '../shared/types'
import type { AppUpdateStatus } from '../shared/types'

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

interface UpdateMetadata { version: string; body?: string }
interface UpdateDownloadEvent {
  event: 'Started' | 'Progress' | 'Finished'
  data?: { contentLength?: number; chunkLength?: number }
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const updateListeners = new Set<(status: AppUpdateStatus) => void>()
let pendingUpdate: UpdateMetadata | null = null
let downloadOperation = 0
let lastUpdateCheckAt = 0
let checkInFlight: Promise<AppUpdateStatus> | null = null
let downloadInFlight: Promise<AppUpdateStatus> | null = null
let installInFlight: Promise<void> | null = null
let updateStatus: AppUpdateStatus = {
  supported: true,
  stage: 'not-available',
  message: 'Clique em Verificar para procurar atualizações.',
}

function publishUpdateStatus(status: AppUpdateStatus) {
  updateStatus = status
  updateListeners.forEach((listener) => listener(status))
  return status
}

function updateErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' ? error : 'Não foi possível atualizar o aplicativo.'
}

function updateMetadata(update: UpdateMetadata): AppUpdateStatus {
  return {
    supported: true,
    stage: 'available',
    version: update.version,
    message: update.body?.trim() || `A versão ${update.version} está disponível.`,
  }
}

async function updaterTarget(): Promise<string | null> {
  try {
    const bundleType = await getBundleType()
    if (bundleType === BundleType.Deb) return 'linux-deb-x86_64'
    if (bundleType === BundleType.Rpm) return 'linux-rpm-x86_64'
    if (bundleType === BundleType.Nsis) return 'windows-nsis-x86_64'
  } catch {
    return null
  }
  return null
}

async function checkForUpdates(force = false): Promise<AppUpdateStatus> {
  if (checkInFlight || downloadInFlight || installInFlight) return updateStatus
  if (!force && lastUpdateCheckAt > 0 && Date.now() - lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return updateStatus
  const operation = checkForUpdatesInternal()
  checkInFlight = operation
  try {
    return await operation
  } finally {
    if (checkInFlight === operation) checkInFlight = null
  }
}

async function checkForUpdatesInternal() {
  const target = await updaterTarget()
  if (!target) {
    pendingUpdate = null
    return publishUpdateStatus({ supported: false, stage: 'disabled', message: 'Atualizações automáticas só estão disponíveis em uma instalação empacotada suportada.' })
  }
  lastUpdateCheckAt = Date.now()
  publishUpdateStatus({ supported: true, stage: 'checking', message: 'Verificando atualizações…' })
  try {
    pendingUpdate = await invoke<UpdateMetadata | null>('updater_check', { target, timeout: 15_000 })
    if (!pendingUpdate) {
      return publishUpdateStatus({ supported: true, stage: 'not-available', message: 'Você já está usando a versão mais recente.' })
    }
    return publishUpdateStatus(updateMetadata(pendingUpdate))
  } catch (error) {
    pendingUpdate = null
    return publishUpdateStatus({ supported: true, stage: 'error', message: `Falha ao verificar atualizações: ${updateErrorMessage(error)}` })
  }
}

async function downloadUpdate() {
  if (downloadInFlight) return downloadInFlight
  if (checkInFlight || installInFlight) return updateStatus
  const operation = downloadUpdateInternal()
  downloadInFlight = operation
  try {
    return await operation
  } finally {
    if (downloadInFlight === operation) downloadInFlight = null
  }
}

async function downloadUpdateInternal() {
  if (!pendingUpdate) return publishUpdateStatus({ supported: true, stage: 'error', message: 'Nenhuma atualização disponível para baixar.' })
  const update = pendingUpdate
  const operation = ++downloadOperation
  let downloadedBytes = 0
  let contentLength: number | undefined
  const onEvent = new Channel<UpdateDownloadEvent>()
  onEvent.onmessage = (event) => {
    if (event.event === 'Started') contentLength = event.data?.contentLength
    else if (event.event === 'Progress') downloadedBytes += event.data?.chunkLength ?? 0
    const progress = contentLength && contentLength > 0 ? Math.min(100, downloadedBytes / contentLength * 100) : undefined
    if (operation === downloadOperation) {
      publishUpdateStatus({ ...updateMetadata(update), stage: 'downloading', progress, message: progress === undefined ? 'Baixando atualização…' : `Baixando atualização… ${Math.round(progress)}%` })
    }
  }
  publishUpdateStatus({ ...updateMetadata(update), stage: 'downloading', progress: 0, message: `Baixando a versão ${update.version}…` })
  try {
    await invoke('updater_download', { onEvent })
    if (operation !== downloadOperation) return updateStatus
    return publishUpdateStatus({ ...updateMetadata(update), stage: 'downloaded', progress: 100, message: `Atualização ${update.version} pronta para instalar.` })
  } catch (error) {
    if (operation !== downloadOperation) return updateStatus
    return publishUpdateStatus({ ...updateMetadata(update), stage: 'error', message: `Falha ao baixar atualização: ${updateErrorMessage(error)}` })
  }
}

async function cancelUpdate() {
  if (updateStatus.stage !== 'downloading' || !pendingUpdate || !downloadInFlight) return updateStatus
  downloadOperation += 1
  pendingUpdate = null
  try {
    await invoke('updater_cancel_download')
  } catch {
    // The download may already have completed; the operation token still blocks stale UI updates.
  }
  return publishUpdateStatus({ supported: true, stage: 'not-available', message: 'Download cancelado. Verifique novamente para tentar outra vez.' })
}

async function installUpdate() {
  if (installInFlight) return installInFlight
  if (checkInFlight || downloadInFlight) throw new Error('Outra operação de atualização está em andamento.')
  const operation = installUpdateInternal()
  installInFlight = operation
  try {
    return await operation
  } finally {
    if (installInFlight === operation) installInFlight = null
  }
}

async function installUpdateInternal() {
  if (!pendingUpdate || updateStatus.stage !== 'downloaded') {
    throw new Error('Baixe uma atualização antes de instalar.')
  }
  try {
    publishUpdateStatus({ ...updateMetadata(pendingUpdate), stage: 'downloaded', progress: 100, message: 'Instalando atualização e reiniciando…' })
    await invoke('updater_install')
    await relaunch()
  } catch (error) {
    publishUpdateStatus({ ...updateMetadata(pendingUpdate), stage: 'error', message: `Falha ao instalar atualização: ${updateErrorMessage(error)}` })
    throw error
  }
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
    listFolders: () => invoke<ProjectFolder[]>('projects_folders_list'),
    create: (name: string) => invoke('projects_create', { name }),
    rename: (projectId: string, name: string) => invoke('projects_rename', { projectId, name }),
    remove: (projectId: string) => invoke('projects_remove', { projectId }),
    createFolder: (name: string, parentId?: string | null) => invoke<ProjectFolder>('projects_folder_create', { name, parentId }),
    renameFolder: (folderId: string, name: string) => invoke<ProjectFolder>('projects_folder_rename', { folderId, name }),
    removeFolder: (folderId: string) => invoke('projects_folder_remove', { folderId }),
    move: (projectId: string, folderId: string | null) => invoke('projects_move', { projectId, folderId }),
    addTrack: (projectId: string, trackId: string) => invoke('projects_add_track', { projectId, trackId }),
    removeTrack: (projectId: string, trackId: string) => invoke('projects_remove_track', { projectId, trackId }),
    moveTrack: (projectId: string, trackId: string, direction: 'up' | 'down') => invoke('projects_move_track', { projectId, trackId, direction }),
    createSnapshot: (projectId: string, name: string, player: PlayerSnapshot) => invoke('projects_create_snapshot', { projectId, name, player }),
    restoreSnapshot: (projectId: string, snapshotId: string) => invoke('projects_restore_snapshot', { projectId, snapshotId }),
    removeSnapshot: (projectId: string, snapshotId: string) => invoke('projects_remove_snapshot', { projectId, snapshotId }),
    updatePlayerState: (projectId: string, player: PlayerSnapshot) => invoke('projects_update_player_state', { projectId, player }),
    saveAs: (projectId: string) => invoke<Project | null>('projects_save_as', { projectId }),
    save: (projectId: string) => invoke('projects_save', { projectId }),
    open: () => invoke<ProjectOpenResult | null>('projects_open'),
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
    status: async () => updateStatus,
    check: checkForUpdates,
    download: downloadUpdate,
    cancel: cancelUpdate,
    install: installUpdate,
    onStatus: (callback) => { updateListeners.add(callback); return () => updateListeners.delete(callback) },
  },
  version: () => invoke<string>('app_version'),
  settings: {
    get: () => invoke('settings_get'),
    set: (key, value) => invoke('settings_set', { key, value }),
  },
  resources: {
    summary: () => invoke('resources_summary'),
    clearCache: () => invoke('resources_clear_cache'),
  },
}
