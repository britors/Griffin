import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { api } from './api'
import { applyVisualPreferences } from './preferences'
import { addRecentTrack, playerSnapshot, usePlayer } from './store'
import { LibraryPage } from './pages/library'
import { PlayerPage } from './pages/player'
import { PreferencesPage } from './pages/preferences'
import { AudioPlayback } from './components/audio-playback'
import { Splash } from './components/splash'
import { DialogHost } from './components/dialog-host'
import { KeyboardShortcuts } from './components/keyboard-shortcuts'
import { Metronome } from './components/metronome'
import type { PreparationProgress } from '../shared/types'
import './styles.css'

type View = 'library' | 'preferences'
type LibraryFilter = 'all' | 'favorites' | 'recent'

function errorDetail(reason: unknown) {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`
  return typeof reason === 'string' ? reason : String(reason)
}

function logRendererEvent(event: string, detail?: string) {
  void api.diagnostics.log(event, detail).catch(() => undefined)
}

window.addEventListener('error', (event) => {
  logRendererEvent('renderer.window_error', event.error ? errorDetail(event.error) : event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  logRendererEvent('renderer.unhandled_rejection', errorDetail(event.reason))
})

function App() {
  if (new URLSearchParams(window.location.search).has('splash')) return <Splash />

  const [view, setView] = useState<View>('library')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [sidebarOpen, setSidebarOpen] = useState(() => window.localStorage.getItem('griffin.sidebarOpen') !== 'false')
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [preparation, setPreparation] = useState<PreparationProgress | null>(null)
  const { selected, recentTrackIds, setProgress, setFavoriteIds, setRecentTrackIds, setResetPlaybackOnTrackChange, setMetronomeEnabled, setMetronomeSubdivision, setMetronomeVolume, setCountInEnabled, setCountInBars } = usePlayer()
  const activeProjectId = usePlayer((state) => state.activeProjectId)
  const takePath = usePlayer((state) => state.takePath)
  const takeName = usePlayer((state) => state.takeName)
  const position = usePlayer((state) => state.position)
  const pitch = usePlayer((state) => state.pitch)
  const tempo = usePlayer((state) => state.tempo)
  const loopEnabled = usePlayer((state) => state.loopEnabled)
  const loopStart = usePlayer((state) => state.loopStart)
  const loopEnd = usePlayer((state) => state.loopEnd)
  const volumes = usePlayer((state) => state.volumes)
  const pans = usePlayer((state) => state.pans)
  const routes = usePlayer((state) => state.routes)
  const equalizer = usePlayer((state) => state.equalizer)
  const muted = usePlayer((state) => state.muted)
  const solo = usePlayer((state) => state.solo)

  useEffect(() => {
    logRendererEvent('renderer.app_mounted', 'ok')
    logRendererEvent('startup.settings_load_started', 'ok')
    void api.settings.get().then((settings) => {
      applyVisualPreferences(settings)
      setFavoriteIds(Array.isArray(settings.favoriteTrackIds) ? settings.favoriteTrackIds.filter((id): id is string => typeof id === 'string') : [])
      setRecentTrackIds(Array.isArray(settings.recentTrackIds) ? settings.recentTrackIds.filter((id): id is string => typeof id === 'string') : [])
      setResetPlaybackOnTrackChange(settings.resetPlaybackOnTrackChange !== false)
      setMetronomeEnabled(settings.metronomeEnabled === true)
      setMetronomeSubdivision(settings.metronomeSubdivision === 2 ? 2 : settings.metronomeSubdivision === 4 ? 4 : 1)
      setMetronomeVolume(typeof settings.metronomeVolume === 'number' ? Math.min(1, Math.max(0, settings.metronomeVolume)) : 0.5)
      setCountInEnabled(settings.countInEnabled === true)
      setCountInBars(settings.countInBars === 2 ? 2 : 1)
      logRendererEvent('startup.settings_loaded', 'ok')
    }).catch((reason) => logRendererEvent('startup.settings_load_failed', errorDetail(reason)))
  }, [setFavoriteIds, setRecentTrackIds, setResetPlaybackOnTrackChange, setMetronomeEnabled, setMetronomeSubdivision, setMetronomeVolume, setCountInEnabled, setCountInBars])

  useEffect(() => {
    logRendererEvent('startup.version_load_started', 'ok')
    void api.version().then((version) => {
      setAppVersion(version)
      logRendererEvent('startup.version_loaded', `version=${version}`)
    }).catch((reason) => logRendererEvent('startup.version_load_failed', errorDetail(reason)))
    logRendererEvent('startup.update_check_started', 'ok')
    void api.updates.check().then((status) => logRendererEvent('startup.update_check_finished', `stage=${status.stage}`)).catch((reason) => logRendererEvent('startup.update_check_failed', errorDetail(reason)))
    const timer = window.setInterval(() => { void api.updates.check() }, 6 * 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    const unlisten = api.preparation.onProgress(setPreparation)
    setPreparation({ progress: 0, message: 'Verificando preparações…' })
    logRendererEvent('startup.resume_pending_started', 'ok')
    void api.preparation.resumePending().then((resumed) => {
      if (!active) return
      logRendererEvent('startup.resume_pending_finished', `resumed=${resumed}`)
      setPreparation(null)
    }).catch((reason) => {
      logRendererEvent('startup.resume_pending_failed', errorDetail(reason))
      if (active) {
        setPreparation({ progress: 1, message: 'A preparação será retomada quando necessário.' })
        window.setTimeout(() => { if (active) setPreparation(null) }, 3200)
      }
    })
    return () => { active = false; unlisten() }
  }, [])

  useEffect(() => {
    if (!selected) return
    const nextRecent = addRecentTrack(recentTrackIds, selected.id)
    setRecentTrackIds(nextRecent)
    void api.settings.set('recentTrackIds', nextRecent)
  // Read the current list from this effect's closure only when the selected track changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  useEffect(() => {
    if (!activeProjectId) return
    const timer = window.setTimeout(() => { void api.projects.updatePlayerState(activeProjectId, playerSnapshot(usePlayer.getState())) }, 350)
    return () => window.clearTimeout(timer)
  }, [activeProjectId, selected?.id, takePath, takeName, position, pitch, tempo, loopEnabled, loopStart, loopEnd, volumes, pans, routes, equalizer, muted, solo])

  useEffect(() => api.separation.onProgress(setProgress), [setProgress])

  useEffect(() => {
    window.localStorage.setItem('griffin.sidebarOpen', String(sidebarOpen))
  }, [sidebarOpen])

  const showLibrary = (filter: LibraryFilter = 'all') => { setLibraryFilter(filter); setView('library') }
  const showPreferences = () => setView('preferences')

  return <div className="app-shell">
    <DialogHost />
    <KeyboardShortcuts />
    <Metronome />
    <AudioPlayback />
    <aside id="main-sidebar" className={`sidebar${sidebarOpen ? '' : ' collapsed'}`} aria-label="Menu principal">
      <div className="brand">
        <div className="brand-identity"><img className="brand-logo" src="./logo.svg" alt="Griffin Music" /><div className="brand-name"><strong>Griffin</strong><span>Music</span></div></div>
        <button
          className="sidebar-toggle"
          title={sidebarOpen ? 'Ocultar menu' : 'Mostrar menu'}
          aria-label={sidebarOpen ? 'Ocultar menu lateral' : 'Mostrar menu lateral'}
          aria-controls="main-sidebar"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        ><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="m15 18-6-6 6-6" /></svg></button>
      </div>
      <nav>
        <button className={view === 'library' && libraryFilter === 'all' ? 'active' : ''} title="Biblioteca" onClick={() => showLibrary()}><span className="nav-icon">⌂</span><span className="nav-label">Biblioteca</span></button>
        <button className={view === 'library' && libraryFilter === 'favorites' ? 'active' : ''} title="Favoritos" onClick={() => showLibrary('favorites')}><span className="nav-icon">◈</span><span className="nav-label">Favoritos</span></button>
        <button className={view === 'library' && libraryFilter === 'recent' ? 'active' : ''} title="Recentes" onClick={() => showLibrary('recent')}><span className="nav-icon">◌</span><span className="nav-label">Recentes</span></button>
        <button className={view === 'preferences' ? 'active' : ''} title="Preferências" onClick={showPreferences}><span className="nav-icon">⚙</span><span className="nav-label">Preferências</span></button>
      </nav>
      <div className="sidebar-footer"><div><span className="offline-dot" />Processamento local</div><div className="version">{appVersion ? `v${appVersion}` : 'v—'}</div></div>
    </aside>
    <div className="content">
      <header className="app-header" data-tauri-drag-region="deep" onMouseDown={(event) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement
        if (target.closest('button, input, select, textarea, a, [role="button"], .window-controls')) return
        void getCurrentWindow().startDragging()
      }}>
        <div className="header-title"><span>Griffin Music</span><i>/</i><strong>{view === 'preferences' ? 'Preferências' : selected ? selected.name : 'Biblioteca'}</strong></div>
        <div className="header-actions">
          <button className="settings" title="Abrir preferências" aria-label="Abrir preferências" onClick={showPreferences}>⚙</button>
          <div className="window-controls" aria-label="Controles da janela">
            <button className="window-control" title="Minimizar" aria-label="Minimizar" onClick={() => void api.window.minimize()}>−</button>
            <button className="window-control" title="Maximizar" aria-label="Maximizar" onClick={() => void api.window.toggleMaximize()}>□</button>
            <button className="window-control close" title="Fechar" aria-label="Fechar" onClick={() => void api.window.close()}>×</button>
          </div>
        </div>
      </header>
      {preparation && <div className="preparation-banner" role="status" aria-live="polite"><span>{preparation.message}</span><div className="preparation-banner-track"><span style={{ width: `${Math.round(preparation.progress * 100)}%` }} /></div></div>}
      <div className="content-scroll">
        {view === 'preferences' ? <PreferencesPage /> : <><LibraryPage filter={libraryFilter} />{selected && <PlayerPage />}</>}
      </div>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
