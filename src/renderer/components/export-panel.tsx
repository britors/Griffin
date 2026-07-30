import { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import { STEM_LABELS, type AudioExportMode, type AudioExportOptions, type StemName } from '../../shared/types'

const stemNames: StemName[] = ['vocals', 'drums', 'bass', 'other']

export function ExportPanel() {
  const { selected, volumes, pans, routes, equalizer, muted, solo, pitch, tempo, loopEnabled, loopStart, loopEnd } = usePlayer()
  const [stems, setStems] = useState<StemName[]>(stemNames)
  const [useLoop, setUseLoop] = useState(false)
  const [working, setWorking] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100)
  const [bitDepth, setBitDepth] = useState<16 | 24>(16)
  const [mode, setMode] = useState<AudioExportMode>('mix')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStems(stemNames.filter((stem) => Boolean(selected?.stems?.[stem])))
    setMessage(null)
    setError(null)
  }, [selected?.id])
  useEffect(() => api.onExportProgress((event) => { if (event.requestId === requestId) { setProgress(event.progress); setStage(event.stage) } }), [requestId])

  if (!selected?.stems) return null

  const toggleStem = (stem: StemName) => setStems((current) => current.includes(stem) ? current.filter((item) => item !== stem) : [...current, stem])
  const exportAudio = async () => {
    if (stems.length === 0 || working) return
    const nextRequestId = crypto.randomUUID()
    setWorking(true); setRequestId(nextRequestId); setProgress(0); setStage('Iniciando'); setMessage(null); setError(null)
    const options: AudioExportOptions = { stems, volumes, pans, routes, equalizer, muted, solo, mode, pitch, tempo, format: 'wav', sampleRate, bitDepth, requestId: nextRequestId, ...(useLoop && loopEnabled ? { loop: { start: loopStart, end: loopEnd } } : {}) }
    try {
      const result = await api.exportAudio(selected.id, options)
      setMessage(mode === 'individual' ? `${result.paths.length} stems exportados em: ${result.paths[0]}` : `Mix exportada: ${result.path}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível exportar a mix.')
    } finally { setWorking(false); setRequestId(null) }
  }

  const cancelExport = () => { if (requestId) { void api.cancelExport(requestId); setMessage('Cancelando exportação…') } }

  return <section className="panel export-panel"><div className="section-heading"><div><span className="eyebrow">EXPORTAR</span><h2>Crie uma mixagem</h2></div><span className="badge">WAV PCM</span></div><p className="export-help">Escolha um stem ou combine vários. Volume, mute, solo, pan, EQ, pitch, tempo e loop serão aplicados.</p><div className="export-stems">{stemNames.filter((stem) => selected.stems?.[stem]).map((stem) => <label className="export-stem" key={stem}><input type="checkbox" checked={stems.includes(stem)} onChange={() => toggleStem(stem)} /><span>{STEM_LABELS[stem]}</span></label>)}</div><div className="export-mode"><label>TIPO DE SAÍDA<select value={mode} onChange={(event) => setMode(event.target.value as AudioExportMode)}><option value="mix">Mixagem combinada</option><option value="individual">Arquivos individuais</option></select></label><small>{mode === 'individual' ? 'Cada stem selecionado será salvo separadamente na pasta escolhida.' : 'Todos os stems selecionados serão combinados em um único arquivo.'}</small></div><div className="export-quality"><label>Sample rate<select value={sampleRate} onChange={(event) => setSampleRate(Number(event.target.value) as 44100 | 48000)}><option value="44100">44,1 kHz</option><option value="48000">48 kHz</option></select></label><label>Bit depth<select value={bitDepth} onChange={(event) => setBitDepth(Number(event.target.value) as 16 | 24)}><option value="16">16-bit</option><option value="24">24-bit</option></select></label></div><label className="export-loop"><input type="checkbox" checked={useLoop} disabled={!loopEnabled} onChange={(event) => setUseLoop(event.target.checked)} /><span>Exportar somente o loop A-B{loopEnabled ? ` (${Math.round(loopStart * 100)}%–${Math.round(loopEnd * 100)}%)` : ' — ative o loop no transporte'}</span></label><div className="export-actions"><button className="primary-button" disabled={working || stems.length === 0} onClick={() => void exportAudio()}>{working ? `Processando ${Math.round(progress * 100)}%` : mode === 'individual' ? 'Exportar stems' : 'Exportar WAV'}</button>{working && <button className="secondary-button" onClick={cancelExport}>Cancelar</button>}</div>{working && <small className="export-progress-stage">{stage}</small>}{message && <small className="export-success">{message}</small>}{error && <small className="export-error">{error}</small>}</section>
}
