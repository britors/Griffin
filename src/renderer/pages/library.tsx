import { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import { ImportDropzone } from '../components/import-dropzone'
import { formatDuration } from '../../shared/utils'
import type { Track } from '../../shared/types'

export function LibraryPage() {
  const { tracks, projects, activeProjectId, selected, setTracks, setProjects, select } = usePlayer()
  const [search, setSearch] = useState('')
  useEffect(() => { void api.library.list().then(setTracks) }, [setTracks])

  const activeProject = projects.find((project) => project.id === activeProjectId)
  const projectTracks = activeProject ? tracks.filter((track) => activeProject.trackIds.includes(track.id)) : tracks
  const visible = projectTracks.filter((track) => track.name.toLowerCase().includes(search.toLowerCase()))

  const importTrack = async () => {
    const track = await api.library.chooseFile()
    if (!track) return
    if (activeProjectId) await api.projects.addTrack(activeProjectId, track.id)
    setTracks(await api.library.list())
  }

  const removeTrack = async (track: Track) => {
    if (!window.confirm(`Remover “${track.name}” da biblioteca?`)) return
    await api.library.remove(track.id)
    if (selected?.id === track.id) select(null)
    setTracks(await api.library.list())
    setProjects(await api.projects.list())
  }

  const onTrackKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, track: Track) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(track)
    }
  }

  return <main className="library-page">
    <div className="page-heading"><div><span className="eyebrow">LIBRARY</span><h1>Seu espaço de música</h1><p>Separe, pratique e encontre o som certo.</p></div><button className="primary-button" onClick={() => void importTrack()}>＋ Importar faixa</button></div>
    <div className="library-tools"><div className="search">⌕<input placeholder="Buscar na biblioteca" value={search} onChange={(event) => setSearch(event.target.value)} /></div><span>{projectTracks.length} {projectTracks.length === 1 ? 'faixa' : 'faixas'}</span></div>
    {projectTracks.length === 0 ? <ImportDropzone /> : visible.length === 0 ? <div className="empty-state">Nenhuma faixa encontrada para esta busca.</div> : <div className="track-list">{visible.map((track, index) => <div className={`track-row ${selected?.id === track.id ? 'selected' : ''}`} key={track.id} role="button" tabIndex={0} onClick={() => select(track)} onKeyDown={(event) => onTrackKeyDown(event, track)}><span className="track-number">{String(index + 1).padStart(2, '0')}</span><span className="track-art">{track.name.slice(0, 1).toUpperCase()}</span><span className="track-name"><strong>{track.name}</strong><small>{track.stems ? 'Stems prontos' : 'Ainda não separado'}</small></span><span className="track-duration">{formatDuration(track.duration)}</span><button className="track-remove" title={`Remover ${track.name}`} aria-label={`Remover ${track.name}`} onClick={(event) => { event.stopPropagation(); void removeTrack(track) }}>×</button></div>)}</div>}
  </main>
}
