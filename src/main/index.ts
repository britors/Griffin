import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { LibraryApplicationService } from './application/library-service'
import { SeparationApplicationService } from './application/separation-service'
import { FileAudioGateway } from './infrastructure/filesystem/file-audio-gateway'
import { LocalTrackAnalyzer } from './infrastructure/audio/local-track-analyzer'
import { ElectronAudioPicker } from './infrastructure/electron/electron-audio-picker'
import { JsonSettingsRepository } from './infrastructure/persistence/json-settings-repository'
import { JsonProjectRepository } from './infrastructure/persistence/json-project-repository'
import { JsonTrackRepository } from './infrastructure/persistence/json-track-repository'
import { OnnxDemucsSeparator } from './infrastructure/separation/onnx-demucs-separator'
import { registerLibraryHandlers } from './presentation/ipc/library-handlers'
import { registerSeparationHandlers } from './presentation/ipc/separation-handlers'
import { registerSettingsHandlers } from './presentation/ipc/settings-handlers'
import { registerWindowHandlers } from './presentation/ipc/window-handlers'
import { ProjectApplicationService } from './application/project-service'
import { TrackAnalysisApplicationService } from './application/analysis-service'
import { registerProjectHandlers } from './presentation/ipc/project-handlers'
import { registerAnalysisHandlers } from './presentation/ipc/analysis-handlers'
import { LyricsApplicationService } from './application/lyrics-service'
import { registerLyricsHandlers } from './presentation/ipc/lyrics-handlers'
import { AudioExportApplicationService } from './application/export-service'
import { AudioFileDecoder } from './infrastructure/audio/audio-file-decoder'
import { WavAudioExportProcessor } from './infrastructure/audio/wav-audio-export-processor'
import { ElectronAudioExportDestination } from './infrastructure/electron/electron-audio-export-destination'
import { registerExportHandlers } from './presentation/ipc/export-handlers'
import { PerformanceApplicationService } from './application/performance-service'
import { ElectronRecordingDestination } from './infrastructure/electron/electron-recording-destination'
import { registerPerformanceHandlers } from './presentation/ipc/performance-handlers'
import { ChordExportApplicationService } from './application/chord-export-service'
import { ChordNotationExportService } from './infrastructure/audio/chord-notation-exporter'
import { ElectronChordExportDestination } from './infrastructure/electron/electron-chord-export-destination'
import { registerChordExportHandlers } from './presentation/ipc/chord-export-handlers'
import { LocalResourcesApplicationService } from './application/local-resources-service'
import type { ExecutionProviderPreference, SeparationModelProfile, SeparationProfile } from '../shared/types'
import { RemoteAudioImportApplicationService } from './application/remote-audio-import-service'
import { ElectronRemoteAudioDownloader } from './infrastructure/electron/remote-audio-downloader'
import { YoutubeImportApplicationService } from './application/youtube-import-service'
import { ElectronYoutubeAudioDownloader } from './infrastructure/electron/youtube-audio-downloader'

let window: BrowserWindow | undefined

// Electron 36 may select GTK4 on GNOME while a system integration loads GTK3.
// Keep Linux on one toolkit until the runtime is upgraded past this transition.
if (process.platform === 'linux') app.commandLine.appendSwitch('gtk-version', '3')

async function createWindow() {
  const splash = new BrowserWindow({ width: 720, height: 500, frame: false, resizable: false, transparent: false, backgroundColor: '#0b1526', alwaysOnTop: true, webPreferences: { preload: join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  if (process.env.ELECTRON_RENDERER_URL) await splash.loadURL(`${process.env.ELECTRON_RENDERER_URL}?splash=1`)
  else await splash.loadFile(join(__dirname, '../renderer/index.html'), { query: { splash: '1' } })
  const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources/256x256.png')
  const icon = nativeImage.createFromPath(iconPath)
  window = new BrowserWindow({ width: 1440, height: 900, minWidth: 1180, minHeight: 760, show: false, frame: false, autoHideMenuBar: true, backgroundColor: '#0b1526', icon, webPreferences: { preload: join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } })
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
  let revealed = false
  const revealMainWindow = () => {
    if (revealed) return
    revealed = true
    if (!splash.isDestroyed()) splash.destroy()
    window?.show()
  }
  window.once('ready-to-show', revealMainWindow)
  window.webContents.once('did-finish-load', revealMainWindow)
  setTimeout(revealMainWindow, 5000)
}

app.whenReady().then(async () => {
  app.setPath('userData', join(app.getPath('appData'), 'GriffinMusic'))
  const trackRepository = new JsonTrackRepository(); await trackRepository.init()
  const projectRepository = new JsonProjectRepository(); await projectRepository.init()
  const modelsDirectory = app.isPackaged ? join(process.resourcesPath, 'models') : join(app.getAppPath(), 'src/main/models')
  const settingsRepository = new JsonSettingsRepository()
  const initialSettings = await settingsRepository.get()
  const cacheDirectory = join(app.getPath('userData'), 'stems')
  const separator = new OnnxDemucsSeparator(cacheDirectory, modelsDirectory)
  separator.setProcessingThreads(typeof initialSettings.processingThreads === 'number' ? initialSettings.processingThreads : 0)
  separator.setProcessingProfile(isSeparationProfile(initialSettings.processingProfile) ? initialSettings.processingProfile : 'quality')
  separator.setModelProfile(isModelProfile(initialSettings.modelProfile) ? initialSettings.modelProfile : 'four-stem')
  separator.setExecutionProvider(isExecutionProvider(initialSettings.executionProvider) ? initialSettings.executionProvider : 'auto')
  await separator.init()
  const libraryService = new LibraryApplicationService(trackRepository, new FileAudioGateway(), new ElectronAudioPicker())
  const remoteImport = new RemoteAudioImportApplicationService(new ElectronRemoteAudioDownloader(), libraryService, join(app.getPath('userData'), 'imports'))
  const youtubeImport = new YoutubeImportApplicationService(new ElectronYoutubeAudioDownloader(), libraryService, join(app.getPath('userData'), 'imports'))
  const separationService = new SeparationApplicationService(trackRepository, separator)
  const projectService = new ProjectApplicationService(projectRepository)
  const analysisService = new TrackAnalysisApplicationService(trackRepository, new FileAudioGateway(), new LocalTrackAnalyzer())
  const lyricsService = new LyricsApplicationService(trackRepository)
  const exportService = new AudioExportApplicationService(trackRepository, new WavAudioExportProcessor(new FileAudioGateway(), new AudioFileDecoder()), new ElectronAudioExportDestination())
  const performance = registerPerformanceHandlers(new PerformanceApplicationService(new ElectronRecordingDestination()))
  const chordExport = registerChordExportHandlers(new ChordExportApplicationService(trackRepository, new ChordNotationExportService(), new ElectronChordExportDestination()))
  const resources = new LocalResourcesApplicationService(cacheDirectory, modelsDirectory)
  const libraryHandlers = registerLibraryHandlers(libraryService)
  ipcMain.handle('library:list', libraryHandlers.list)
  ipcMain.handle('library:import', (_event, path?: string) => libraryHandlers.import(path))
  ipcMain.handle('library:import-many', (_event, paths?: string[]) => libraryHandlers.importMany(paths))
  ipcMain.handle('library:read', (_event, path: string) => libraryHandlers.read(path))
  ipcMain.handle('library:remove', async (_event, id: string) => {
    await libraryHandlers.remove(id)
    await Promise.all((await projectService.list()).map((project) => projectService.removeTrack(project.id, id)))
  })
  ipcMain.handle('library:choose-file', libraryHandlers.chooseFile)
  ipcMain.handle('library:choose-files', libraryHandlers.chooseFiles)
  ipcMain.handle('library:preview-url', (_event, url: string) => remoteImport.preview(url))
  ipcMain.handle('library:import-url', (_event, assetId: string) => remoteImport.import(assetId))
  ipcMain.handle('library:cancel-remote-import', (_event, assetId: string) => remoteImport.cancel(assetId))
  ipcMain.handle('library:youtube-preview', (_event, url: string) => youtubeImport.preview(url))
  ipcMain.handle('library:youtube-import', (_event, previewId: string) => youtubeImport.import(previewId))
  ipcMain.handle('library:youtube-cancel', (_event, previewId: string) => youtubeImport.cancel(previewId))
  const analysis = registerAnalysisHandlers(analysisService)
  ipcMain.handle('analysis:analyze', analysis.analyze)
  ipcMain.handle('analysis:update', analysis.update)
  const lyrics = registerLyricsHandlers(lyricsService)
  ipcMain.handle('lyrics:get', lyrics.get)
  ipcMain.handle('lyrics:update', lyrics.update)
  const audioExport = registerExportHandlers(exportService, () => window?.webContents)
  ipcMain.handle('export:audio', audioExport.audio)
  ipcMain.handle('export:cancel', audioExport.cancel)
  ipcMain.handle('performance:save', performance.save)
  ipcMain.handle('chords:export', chordExport.export)
  const settings = registerSettingsHandlers(settingsRepository, (key, value) => {
    if (key === 'processingThreads' && typeof value === 'number') separator.setProcessingThreads(value)
    if (key === 'processingProfile' && isSeparationProfile(value)) separator.setProcessingProfile(value)
    if (key === 'modelProfile' && isModelProfile(value)) separator.setModelProfile(value)
    if (key === 'executionProvider' && isExecutionProvider(value)) separator.setExecutionProvider(value)
  })
  ipcMain.handle('settings:get', settings.get)
  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => settings.set(key, value))
  ipcMain.handle('resources:summary', resources.summary.bind(resources))
  ipcMain.handle('resources:clear-cache', resources.clearCache.bind(resources))
  registerWindowHandlers()
  const projects = registerProjectHandlers(projectService)
  ipcMain.handle('projects:list', projects.list)
  ipcMain.handle('projects:create', (_event, name: string) => projects.create(_event, name))
  ipcMain.handle('projects:rename', (_event, id: string, name: string) => projects.rename(_event, id, name))
  ipcMain.handle('projects:remove', (_event, id: string) => projects.remove(_event, id))
  ipcMain.handle('projects:add-track', (_event, projectId: string, trackId: string) => projects.addTrack(_event, projectId, trackId))
  ipcMain.handle('projects:remove-track', (_event, projectId: string, trackId: string) => projects.removeTrack(_event, projectId, trackId))
  ipcMain.handle('projects:move-track', (_event, projectId: string, trackId: string, direction: 'up' | 'down') => projects.moveTrack(_event, projectId, trackId, direction))
  ipcMain.handle('projects:create-snapshot', (_event, projectId: string, name: string, player) => projects.createSnapshot(_event, projectId, name, player))
  ipcMain.handle('projects:restore-snapshot', (_event, projectId: string, snapshotId: string) => projects.restoreSnapshot(_event, projectId, snapshotId))
  ipcMain.handle('projects:remove-snapshot', (_event, projectId: string, snapshotId: string) => projects.removeSnapshot(_event, projectId, snapshotId))
  ipcMain.handle('projects:update-player-state', (_event, projectId: string, player) => projects.updatePlayerState(_event, projectId, player))
  registerSeparationHandlers(separationService, () => window?.webContents)
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
})

function isSeparationProfile(value: unknown): value is SeparationProfile { return value === 'quality' || value === 'balanced' || value === 'speed' }
function isExecutionProvider(value: unknown): value is ExecutionProviderPreference { return value === 'auto' || value === 'cpu' || value === 'cuda' }
function isModelProfile(value: unknown): value is SeparationModelProfile { return value === 'four-stem' || value === 'six-stem' }

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
