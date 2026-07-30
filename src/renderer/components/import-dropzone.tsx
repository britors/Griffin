import { useRef, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'

export function ImportDropzone() {
  const input = useRef<HTMLInputElement>(null)
  const setTracks = usePlayer((state) => state.setTracks)
  const [dragging, setDragging] = useState(false)
  const pathOf = (file?: File) => (file as (File & { path?: string }) | undefined)?.path
  const importFile = async (path?: string) => { const track = await api.library.import(path); if (track) setTracks(await api.library.list()) }
  return <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void importFile(pathOf(event.dataTransfer.files[0])) }} onClick={() => input.current?.click()}>
    <input ref={input} hidden type="file" accept="audio/wav,audio/mpeg,audio/flac" onChange={(event) => void importFile(pathOf(event.target.files?.[0]))} />
    <span className="drop-icon">＋</span><strong>Importar faixa</strong><span>Arraste um WAV, MP3 ou FLAC para começar</span>
  </div>
}
