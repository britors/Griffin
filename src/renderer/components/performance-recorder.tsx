import { useRef, useState } from 'react'
import { api } from '../api'
import { getActiveStemAudioPlayer } from '../audio-player'
import { usePlayer } from '../store'

export function PerformanceRecorder() {
  const selected = usePlayer((state) => state.selected)
  const takeName = usePlayer((state) => state.takeName)
  const setTracks = usePlayer((state) => state.setTracks)
  const setPlaying = usePlayer((state) => state.setPlaying)
  const setTake = usePlayer((state) => state.setTake)
  const clearTake = usePlayer((state) => state.clearTake)
  const recorder = useRef<MediaRecorder | null>(null)
  const cleanupMicrophone = useRef<(() => void) | null>(null)
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!selected?.stems) return null

  const start = async () => {
    const player = getActiveStemAudioPlayer()
    if (!player || recording) return
    setError(null); setMessage(null)
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
      cleanupMicrophone.current = player.connectMicrophone(microphone)
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const chunks: Blob[] = []
      const nextRecorder = new MediaRecorder(player.recordingStream, mimeType ? { mimeType } : undefined)
      nextRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
      nextRecorder.onstop = () => { void saveTake(chunks) }
      recorder.current = nextRecorder
      nextRecorder.start()
      setRecording(true)
      setPlaying(true)
    } catch (reason) {
      cleanupMicrophone.current?.(); cleanupMicrophone.current = null
      setError(reason instanceof Error ? reason.message : 'Não foi possível acessar o microfone.')
    }
  }

  const stop = () => {
    if (!recorder.current || !recording) return
    recorder.current.stop(); recorder.current = null
    cleanupMicrophone.current?.(); cleanupMicrophone.current = null
    setRecording(false)
  }

  const saveTake = async (chunks: Blob[]) => {
    try {
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const result = await api.performance.save(`${selected.name} - take`, bytes)
      setMessage(`Take salvo em ${result.path}`)
      const take = await api.library.import(result.path)
      setTracks(await api.library.list())
      if (take) setTake(take.path, take.name)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o take.') }
  }

  return <section className="panel performance-panel"><div className="section-heading"><div><span className="eyebrow">PERFORMANCE</span><h2>Gravar take</h2></div><span className={`recording-status ${recording ? 'active' : ''}`}>{recording ? 'Gravando' : 'Pronto'}</span></div><p className="performance-help">Captura microfone/interface junto com a saída atual dos stems, sem alterar a faixa original.</p>{takeName && <div className="take-active">Take sincronizado: <strong>{takeName}</strong><button className="secondary-button" onClick={clearTake}>Remover camada</button></div>}<div className="performance-actions"><button className={recording ? 'secondary-button recording-button' : 'primary-button'} onClick={() => void (recording ? stop() : start())}>{recording ? 'Parar gravação' : '● Gravar take'}</button>{message && <small className="export-success">{message}</small>}{error && <small className="export-error">{error}</small>}</div></section>
}
