import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api'
import { applyVisualPreferences } from './preferences'
import { usePlayer } from './store'
import { LibraryPage } from './pages/library'
import { PlayerPage } from './pages/player'
import { PreferencesPage } from './pages/preferences'
import { AudioPlayback } from './components/audio-playback'
import { Splash } from './components/splash'
import { ProjectPicker } from './components/project-picker'
import './styles.css'

type View = 'library' | 'preferences'
type LibraryFilter = 'all' | 'favorites' | 'recent'

function App() {
  if (new URLSearchParams(window.location.search).has('splash')) return <Splash />

  const [view, setView] = useState<View>('library')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const { selected, recentTrackIds, setProgress, setFavoriteIds, setRecentTrackIds } = usePlayer()

  useEffect(() => {
    void api.settings.get().then((settings) => {
      applyVisualPreferences(settings)
      setFavoriteIds(Array.isArray(settings.favoriteTrackIds) ? settings.favoriteTrackIds.filter((id): id is string => typeof id === 'string') : [])
      setRecentTrackIds(Array.isArray(settings.recentTrackIds) ? settings.recentTrackIds.filter((id): id is string => typeof id === 'string') : [])
    })
  }, [setFavoriteIds, setRecentTrackIds])

  useEffect(() => {
    if (!selected) return
    const nextRecent = [selected.id, ...recentTrackIds.filter((id) => id !== selected.id)].slice(0, 20)
    setRecentTrackIds(nextRecent)
    void api.settings.set('recentTrackIds', nextRecent)
  // Read the current list from this effect's closure only when the selected track changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  useEffect(() => api.separation.onProgress(setProgress), [setProgress])

  const showLibrary = (filter: LibraryFilter = 'all') => { setLibraryFilter(filter); setView('library') }
  const showPreferences = () => setView('preferences')

  return <div className="app-shell">
    <AudioPlayback />
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="./logo.svg" alt="Griffin Music" /><div><strong>Griffin</strong><span>Music</span></div></div>
      <ProjectPicker />
      <nav>
        <button className={view === 'library' && libraryFilter === 'all' ? 'active' : ''} onClick={() => showLibrary()}>⌂ <span>Biblioteca</span></button>
        <button className={view === 'library' && libraryFilter === 'favorites' ? 'active' : ''} onClick={() => showLibrary('favorites')}>◈ <span>Favoritos</span></button>
        <button className={view === 'library' && libraryFilter === 'recent' ? 'active' : ''} onClick={() => showLibrary('recent')}>◌ <span>Recentes</span></button>
        <button className={view === 'preferences' ? 'active' : ''} onClick={showPreferences}>⚙ <span>Preferências</span></button>
      </nav>
      <div className="sidebar-footer"><div><span className="offline-dot" />Processamento local</div><div className="version">v0.1.0</div></div>
    </aside>
    <div className="content">
      <header className="app-header">
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
