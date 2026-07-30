import { useEffect, useRef, useState } from 'react'
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
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [inputLevel, setInputLevel] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const countInTimer = useRef<number | null>(null)

  useEffect(() => {
    const refreshDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const devices = await navigator.mediaDevices.enumerateDevices()
      setInputDevices(devices.filter((device) => device.kind === 'audioinput'))
    }
    void refreshDevices()
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices)
  }, [])

  useEffect(() => {
    if (!recording) { setInputLevel(0); return }
    const timer = window.setInterval(() => setInputLevel(getActiveStemAudioPlayer()?.getMicrophoneLevel() ?? 0), 80)
    return () => window.clearInterval(timer)
  }, [recording])

  if (!selected?.stems) return null

  const start = async () => {
    const player = getActiveStemAudioPlayer()
    if (!player || recording) return
    setError(null); setMessage(null)
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true })
      cleanupMicrophone.current = player.connectMicrophone(microphone)
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const chunks: Blob[] = []
      const nextRecorder = new MediaRecorder(player.recordingStream, mimeType ? { mimeType } : undefined)
      nextRecorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
      nextRecorder.onstop = () => { void saveTake(chunks) }
      recorder.current = nextRecorder
      nextRecorder.start()
      setRecording(true)
      beginPlayback()
    } catch (reason) {
      cleanupMicrophone.current?.(); cleanupMicrophone.current = null
      setError(reason instanceof Error ? reason.message : 'Não foi possível acessar o microfone.')
    }
  }

  const stop = () => {
    if (!recorder.current || !recording) return
    if (countInTimer.current !== null) { window.clearTimeout(countInTimer.current); countInTimer.current = null; usePlayer.getState().setCountingIn(false); usePlayer.getState().setPlaying(false) }
    recorder.current.stop(); recorder.current = null
    cleanupMicrophone.current?.(); cleanupMicrophone.current = null
    setRecording(false)
  }

  const beginPlayback = () => {
    const state = usePlayer.getState()
    if (!state.metronomeEnabled || !state.countInEnabled) { state.setPlaying(true); return }
    state.setCountingIn(true)
    const bpm = selected?.analysis?.bpm ?? 120
    const duration = state.countInBars * 4 * (60_000 / bpm) / state.tempo
    countInTimer.current = window.setTimeout(() => { usePlayer.getState().setCountingIn(false); usePlayer.getState().setPlaying(true); countInTimer.current = null }, duration)
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

  return <section className="panel performance-panel"><div className="section-heading"><div><span className="eyebrow">PERFORMANCE</span><h2>Gravar take</h2></div><span className={`recording-status ${recording ? 'active' : ''}`}>{recording ? 'Gravando' : 'Pronto'}</span></div><p className="performance-help">Captura microfone/interface junto com a saída atual dos stems, sem alterar a faixa original.</p>{takeName && <div className="take-active">Take sincronizado: <strong>{takeName}</strong><button className="secondary-button" onClick={clearTake}>Remover camada</button></div>}<div className="performance-inputs"><label>ENTRADA<select aria-label="Dispositivo de entrada" value={selectedDeviceId} disabled={recording} onChange={(event) => setSelectedDeviceId(event.target.value)}><option value="">Dispositivo padrão</option>{inputDevices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Entrada ${device.deviceId.slice(0, 8)}`}</option>)}</select></label><div className="input-level" aria-label={`Nível de entrada ${Math.round(inputLevel * 100)}%`}><span>NÍVEL</span><div><i style={{ width: `${Math.round(inputLevel * 100)}%` }} /></div><output>{Math.round(inputLevel * 100)}%</output></div></div><div className="performance-actions"><button className={recording ? 'secondary-button recording-button' : 'primary-button'} onClick={() => void (recording ? stop() : start())}>{recording ? 'Parar gravação' : '● Gravar take'}</button>{message && <small className="export-success">{message}</small>}{error && <small className="export-error">{error}</small>}</div></section>
}
