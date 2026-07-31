import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import { ImportDropzone } from '../components/import-dropzone'
import { BatchSeparation } from '../components/batch-separation'
import { RemoteImport } from '../components/remote-import'
import { YoutubeImport } from '../components/youtube-import'
import { formatDuration } from '../../shared/utils'
import type { Track } from '../../shared/types'
import { confirmDialog } from '../components/dialog-store'

type LibraryFilter = 'all' | 'favorites' | 'recent'

export function LibraryPage({ filter = 'all' }: { filter?: LibraryFilter }) {
  const { tracks, projects, activeProjectId, favoriteIds, recentTrackIds, selected, setTracks, setProjects, setFavoriteIds, setRecentTrackIds, select, toggleFavorite } = usePlayer()
  const restoredProject = useRef<string | null>(null)
  const [search, setSearch] = useState('')
  useEffect(() => { void api.library.list().then(setTracks) }, [setTracks])
  useEffect(() => {
    if (!activeProjectId || restoredProject.current === activeProjectId || tracks.length === 0) return
    const project = projects.find((item) => item.id === activeProjectId)
    if (!project?.playerState) return
    usePlayer.getState().applyPlayerState(project.playerState)
    restoredProject.current = activeProjectId
  }, [activeProjectId, projects, tracks.length])

  const activeProject = projects.find((project) => project.id === activeProjectId)
  const projectTracks = activeProject ? activeProject.trackIds.map((id) => tracks.find((track) => track.id === id)).filter((track): track is Track => Boolean(track)) : tracks
  const filteredTracks = filter === 'favorites' ? projectTracks.filter((track) => favoriteIds.includes(track.id)) : filter === 'recent' ? projectTracks.filter((track) => recentTrackIds.includes(track.id)).sort((a, b) => recentTrackIds.indexOf(a.id) - recentTrackIds.indexOf(b.id)) : projectTracks
  const visible = filteredTracks.filter((track) => track.name.toLowerCase().includes(search.toLowerCase()))
  const heading = filter === 'favorites' ? 'Faixas favoritas' : filter === 'recent' ? 'Reproduzidas recentemente' : 'Seu espaço de música'

  const refreshLibrary = async (nextTracks?: Track[]) => {
    setTracks(nextTracks ?? await api.library.list())
    setProjects(await api.projects.list())
  }

  const importTrack = async () => {
    const track = await api.library.chooseFile()
    if (!track) return
    if (activeProjectId) await api.projects.addTrack(activeProjectId, track.id)
    await refreshLibrary()
  }

  const removeTrack = async (track: Track) => {
    if (!(await confirmDialog(`Remover “${track.name}” da biblioteca?\n\nA entrada será removida, mas os stems em cache serão preservados neste computador.`, { confirmLabel: 'Remover', tone: 'danger' }))) return
    await api.library.remove(track.id)
    if (selected?.id === track.id) select(null)
    setTracks(await api.library.list())
    setProjects(await api.projects.list())
    const nextFavorites = favoriteIds.filter((id) => id !== track.id)
    const nextRecent = recentTrackIds.filter((id) => id !== track.id)
    setFavoriteIds(nextFavorites)
    setRecentTrackIds(nextRecent)
    await Promise.all([api.settings.set('favoriteTrackIds', nextFavorites), api.settings.set('recentTrackIds', nextRecent)])
  }

  const updateFavorite = (trackId: string) => {
    toggleFavorite(trackId)
    const next = usePlayer.getState().favoriteIds
    void api.settings.set('favoriteTrackIds', next)
  }

  const moveTrack = async (trackId: string, direction: 'up' | 'down') => {
    if (!activeProjectId) return
    const updated = await api.projects.moveTrack(activeProjectId, trackId, direction)
    setProjects(projects.map((project) => project.id === updated.id ? updated : project))
  }

  const onTrackKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, track: Track) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(track) }
  }

  const emptyMessage = filter === 'favorites' ? 'Você ainda não favoritou nenhuma faixa.' : filter === 'recent' ? 'Nenhuma faixa reproduzida recentemente.' : 'Nenhuma faixa encontrada para esta busca.'

  return <main className="library-page">
    <div className="page-heading"><div><span className="eyebrow">LIBRARY</span><h1>{heading}</h1><p>Separe, pratique e encontre o som certo.</p></div><button className="primary-button" onClick={() => void importTrack()}>＋ Importar faixa</button></div>
    <div className="library-tools"><div className="search">⌕<input placeholder="Buscar na biblioteca" value={search} onChange={(event) => setSearch(event.target.value)} /></div><span>{filteredTracks.length} {filteredTracks.length === 1 ? 'faixa' : 'faixas'}</span></div>
    {filter === 'all' && <BatchSeparation tracks={tracks} activeProjectId={activeProjectId} onTracksChanged={refreshLibrary} />}
    {filter === 'all' && <RemoteImport activeProjectId={activeProjectId} onTracksChanged={refreshLibrary} />}
    {filter === 'all' && <YoutubeImport activeProjectId={activeProjectId} onTracksChanged={refreshLibrary} />}
    {projectTracks.length === 0 ? <ImportDropzone /> : visible.length === 0 ? <div className="empty-state">{emptyMessage}</div> : <div className="track-list">{visible.map((track, index) => <div className={`track-row ${selected?.id === track.id ? 'selected' : ''}`} key={track.id} role="button" tabIndex={0} onClick={() => select(track)} onKeyDown={(event) => onTrackKeyDown(event, track)}><span className="track-number">{String(index + 1).padStart(2, '0')}</span><span className="track-art">{track.name.slice(0, 1).toUpperCase()}</span><span className="track-name"><strong>{track.name}</strong><small>{track.stems ? 'Stems prontos' : 'Ainda não separado'}</small></span><span className="track-duration">{formatDuration(track.duration)}</span>{activeProjectId && filter === 'all' && <span className="queue-actions"><button title="Mover para cima" aria-label={`Mover ${track.name} para cima`} disabled={index === 0} onClick={(event) => { event.stopPropagation(); void moveTrack(track.id, 'up') }}>↑</button><button title="Mover para baixo" aria-label={`Mover ${track.name} para baixo`} disabled={index === projectTracks.length - 1} onClick={(event) => { event.stopPropagation(); void moveTrack(track.id, 'down') }}>↓</button></span>}<button className="track-favorite" title={favoriteIds.includes(track.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} aria-label={favoriteIds.includes(track.id) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} aria-pressed={favoriteIds.includes(track.id)} onClick={(event) => { event.stopPropagation(); updateFavorite(track.id) }}>{favoriteIds.includes(track.id) ? '★' : '☆'}</button><button className="track-remove" title={`Remover ${track.name}`} aria-label={`Remover ${track.name}`} onClick={(event) => { event.stopPropagation(); void removeTrack(track) }}>×</button></div>)}</div>}
  </main>
}
