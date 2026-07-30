import { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import { ImportDropzone } from '../components/import-dropzone'
import { formatDuration } from '../../shared/utils'

export function LibraryPage() {
  const { tracks, selected, setTracks, select } = usePlayer()
  const [search, setSearch] = useState('')
  useEffect(() => { void api.library.list().then(setTracks) }, [setTracks])
  const visible = tracks.filter((track) => track.name.toLowerCase().includes(search.toLowerCase()))
  return <main className="library-page"><div className="page-heading"><div><span className="eyebrow">LIBRARY</span><h1>Seu espaço de música</h1><p>Separe, pratique e encontre o som certo.</p></div><button className="primary-button" onClick={() => void api.library.chooseFile().then((track) => { if (track) void api.library.list().then(setTracks) })}>＋ Importar faixa</button></div><div className="library-tools"><div className="search">⌕<input placeholder="Buscar na biblioteca" value={search} onChange={(event) => setSearch(event.target.value)} /></div><span>{tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'}</span></div>{tracks.length === 0 ? <ImportDropzone /> : <div className="track-list">{visible.map((track, index) => <button className={`track-row ${selected?.id === track.id ? 'selected' : ''}`} key={track.id} onClick={() => select(track)}><span className="track-number">{String(index + 1).padStart(2, '0')}</span><span className="track-art">{track.name.slice(0, 1).toUpperCase()}</span><span className="track-name"><strong>{track.name}</strong><small>{track.stems ? 'Stems prontos' : 'Ainda não separado'}</small></span><span className="track-duration">{formatDuration(track.duration)}</span><span className="track-more">•••</span></button>)}</div>}</main>
}
