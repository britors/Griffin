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
import './styles.css'

type View = 'library' | 'preferences'

function App() {
  if (new URLSearchParams(window.location.search).has('splash')) return <Splash />

  const [view, setView] = useState<View>('library')
  const { selected, setProgress } = usePlayer()

  useEffect(() => {
    void api.settings.get().then(applyVisualPreferences)
  }, [])

  useEffect(() => api.separation.onProgress(setProgress), [setProgress])

  const showLibrary = () => setView('library')
  const showPreferences = () => setView('preferences')

  return <div className="app-shell">
    <AudioPlayback />
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="./logo.svg" alt="Griffin Music" /><div><strong>Griffin</strong><span>Music</span></div></div>
      <nav>
        <button className={view === 'library' ? 'active' : ''} onClick={showLibrary}>⌂ <span>Biblioteca</span></button>
        <button>◈ <span>Favoritos</span></button>
        <button>◌ <span>Recentes</span></button>
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
        {view === 'preferences' ? <PreferencesPage /> : <><LibraryPage />{selected && <PlayerPage />}</>}
      </div>
    </div>
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
