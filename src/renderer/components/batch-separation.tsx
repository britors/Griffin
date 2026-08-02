import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { getActiveStemAudioPlayer } from '../audio-player'
import { usePlayer } from '../store'
import type { SeparationProgress, Track } from '../../shared/types'
import { errorMessage } from '../error-message'
import { alertDialog } from './dialog-store'

type BatchStatus = 'queued' | 'processing' | 'done' | 'error' | 'cancelled'
type BatchItem = { id: string; name: string; status: BatchStatus; progress: number; error?: string }

const STORAGE_KEY = 'griffin.batch.queue.v1'

function loadQueue(): BatchItem[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as BatchItem[]
    return saved.map((item) => item.status === 'processing' ? { ...item, status: 'queued' } : item)
  } catch { return [] }
}

export function BatchSeparation({ tracks, activeProjectId, onTracksChanged }: { tracks: Track[]; activeProjectId: string | null; onTracksChanged: (tracks: Track[]) => void }) {
  const [queue, setQueue] = useState<BatchItem[]>(loadQueue)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(true)
  const queueRef = useRef(queue)
  const tracksRef = useRef(tracks)
  const runningRef = useRef(false)
  const pausedRef = useRef(true)
  const activeIdRef = useRef<string | null>(null)
  const cancelledRef = useRef(new Set<string>())

  useEffect(() => { tracksRef.current = tracks }, [tracks])
  useEffect(() => { queueRef.current = queue; localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)) }, [queue])
  useEffect(() => api.separation.onProgress((progress) => {
    if (progress.trackId !== activeIdRef.current) return
    updateItem(progress.trackId, (item) => ({ ...item, progress: progress.progress }))
  }), [])

  const updateItem = (id: string, change: (item: BatchItem) => BatchItem) => {
    const next = queueRef.current.map((item) => item.id === id ? change(item) : item)
    queueRef.current = next
    setQueue(next)
  }

  const importBatch = async () => {
    const imported = await api.library.chooseFiles()
    if (imported.length === 0) return
    if (activeProjectId) await Promise.all(imported.map((track) => api.projects.addTrack(activeProjectId, track.id)))
    onTracksChanged(await api.library.list())
    const next = [...queueRef.current, ...imported.filter((track) => !queueRef.current.some((item) => item.id === track.id)).map((track) => ({ id: track.id, name: track.name, status: 'queued' as const, progress: 0 }))]
    queueRef.current = next
    setQueue(next)
  }

  const run = async () => {
    if (runningRef.current) return
    runningRef.current = true; pausedRef.current = false; setRunning(true); setPaused(false)
    while (!pausedRef.current) {
      const item = queueRef.current.find((candidate) => candidate.status === 'queued')
      if (!item) break
      const track = tracksRef.current.find((candidate) => candidate.id === item.id)
      if (!track) { updateItem(item.id, (current) => ({ ...current, status: 'error', error: 'Faixa não encontrada na biblioteca.' })); continue }
      activeIdRef.current = item.id
      updateItem(item.id, (current) => ({ ...current, status: 'processing', progress: 0, error: undefined }))
      const selectedBeforeSeparation = usePlayer.getState().selected
      try {
        usePlayer.getState().setPlaying(false)
        getActiveStemAudioPlayer()?.unload()
        const separated = await api.separation.start(track)
        onTracksChanged(await api.library.list())
        const selectedAfterSeparation = selectedBeforeSeparation?.id === track.id ? separated : selectedBeforeSeparation
        if (selectedAfterSeparation) usePlayer.getState().replaceSelected({ ...selectedAfterSeparation })
        updateItem(item.id, (current) => ({ ...current, status: 'done', progress: 1 }))
        await alertDialog(`A separação de “${track.name}” foi concluída.`)
      } catch (reason) {
        const cancelled = cancelledRef.current.delete(item.id)
        updateItem(item.id, (current) => ({ ...current, status: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : errorMessage(reason, 'Falha na separação.') }))
      } finally { activeIdRef.current = null }
    }
    runningRef.current = false; setRunning(false); setPaused(true)
  }

  const pause = () => { pausedRef.current = true; setPaused(true) }
  const cancel = async (item: BatchItem) => {
    if (item.status === 'processing') { cancelledRef.current.add(item.id); await api.separation.cancel(item.id); return }
    if (item.status === 'queued') updateItem(item.id, (current) => ({ ...current, status: 'cancelled' }))
  }
  const clearFinished = () => { const next = queueRef.current.filter((item) => item.status === 'queued' || item.status === 'processing'); queueRef.current = next; setQueue(next) }
  const completed = queue.filter((item) => item.status === 'done').length
  const progress = queue.length === 0 ? 0 : queue.reduce((total, item) => total + item.progress, 0) / queue.length

  return <section className="panel batch-panel"><div className="section-heading"><div><span className="eyebrow">PROCESSAMENTO EM LOTE</span><h2>Separe várias faixas</h2></div><span className="badge">{completed}/{queue.length || 0}</span></div><p className="batch-help">Adicione várias músicas, acompanhe cada item e retome a fila depois de reiniciar o app.</p><div className="batch-actions"><button className="secondary-button" onClick={() => void importBatch()}>＋ Adicionar arquivos</button><button className="primary-button" disabled={running || !queue.some((item) => item.status === 'queued')} onClick={() => void run()}>▶ Iniciar fila</button>{running && <button className="secondary-button" onClick={pause}>Pausar após a faixa atual</button>}{!running && queue.some((item) => item.status === 'queued') && !paused && <button className="secondary-button" onClick={() => void run()}>Retomar</button>}{queue.some((item) => item.status === 'done' || item.status === 'error' || item.status === 'cancelled') && <button className="text-button" onClick={clearFinished}>Limpar concluídas</button>}</div>{queue.length > 0 && <><div className="batch-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /><output>{Math.round(progress * 100)}% global</output></div><div className="batch-list">{queue.map((item) => <div className={`batch-row ${item.status}`} key={item.id}><span className="batch-status">{item.status === 'done' ? '✓' : item.status === 'processing' ? '…' : item.status === 'error' ? '!' : item.status === 'cancelled' ? '×' : '○'}</span><span className="batch-name"><strong>{item.name}</strong><small>{item.error ?? (item.status === 'processing' ? `${Math.round(item.progress * 100)}%` : item.status === 'queued' ? 'Na fila' : item.status === 'cancelled' ? 'Cancelada' : 'Concluída')}</small></span>{(item.status === 'queued' || item.status === 'processing') && <button className="text-button" onClick={() => void cancel(item)}>{item.status === 'processing' ? 'Cancelar' : 'Remover'}</button>}</div>)}</div></>}</section>
}
