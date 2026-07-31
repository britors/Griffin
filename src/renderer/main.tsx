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
import { ModelSetupModal } from './components/model-setup-modal'
import { DialogHost } from './components/dialog-host'
import { KeyboardShortcuts } from './components/keyboard-shortcuts'
import { Metronome } from './components/metronome'
import './styles.css'

type View = 'library' | 'preferences'
type LibraryFilter = 'all' | 'favorites' | 'recent'

function App() {
  if (new URLSearchParams(window.location.search).has('splash')) return <Splash />

  const [view, setView] = useState<View>('library')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
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
    })
  }, [setFavoriteIds, setRecentTrackIds, setResetPlaybackOnTrackChange, setMetronomeEnabled, setMetronomeSubdivision, setMetronomeVolume, setCountInEnabled, setCountInBars])

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

  const showLibrary = (filter: LibraryFilter = 'all') => { setLibraryFilter(filter); setView('library') }
  const showPreferences = () => setView('preferences')

  return <div className="app-shell">
    <ModelSetupModal />
    <DialogHost />
    <KeyboardShortcuts />
    <Metronome />
    <AudioPlayback />
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="./logo.svg" alt="Griffin Music" /><div><strong>Griffin</strong><span>Music</span></div></div>
      <nav>
        <button className={view === 'library' && libraryFilter === 'all' ? 'active' : ''} onClick={() => showLibrary()}>⌂ <span>Biblioteca</span></button>
        <button className={view === 'library' && libraryFilter === 'favorites' ? 'active' : ''} onClick={() => showLibrary('favorites')}>◈ <span>Favoritos</span></button>
        <button className={view === 'library' && libraryFilter === 'recent' ? 'active' : ''} onClick={() => showLibrary('recent')}>◌ <span>Recentes</span></button>
        <button className={view === 'preferences' ? 'active' : ''} onClick={showPreferences}>⚙ <span>Preferências</span></button>
      </nav>
      <div className="sidebar-footer"><div><span className="offline-dot" />Processamento local</div><div className="version">v0.1.2</div></div>
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
      <div className="content-scroll">
        {view === 'preferences' ? <PreferencesPage /> : <><LibraryPage filter={libraryFilter} />{selected && <PlayerPage />}</>}
      </div>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
