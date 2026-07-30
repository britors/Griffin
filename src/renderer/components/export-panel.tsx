import { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import { STEM_LABELS, type AudioExportOptions, type StemName } from '../../shared/types'

const stemNames: StemName[] = ['vocals', 'drums', 'bass', 'other']

export function ExportPanel() {
  const { selected, volumes, pans, muted, solo, pitch, tempo, loopEnabled, loopStart, loopEnd } = usePlayer()
  const [stems, setStems] = useState<StemName[]>(stemNames)
  const [useLoop, setUseLoop] = useState(false)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setStems(stemNames.filter((stem) => Boolean(selected?.stems?.[stem])))
    setMessage(null)
    setError(null)
  }, [selected?.id])

  if (!selected?.stems) return null

  const toggleStem = (stem: StemName) => setStems((current) => current.includes(stem) ? current.filter((item) => item !== stem) : [...current, stem])
  const exportAudio = async () => {
    if (stems.length === 0 || working) return
    setWorking(true); setMessage(null); setError(null)
    const options: AudioExportOptions = { stems, volumes, pans, muted, solo, pitch, tempo, format: 'wav', ...(useLoop && loopEnabled ? { loop: { start: loopStart, end: loopEnd } } : {}) }
    try {
      const result = await api.exportAudio(selected.id, options)
      setMessage(`Mix exportada: ${result.path}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível exportar a mix.')
    } finally { setWorking(false) }
  }

  return <section className="panel export-panel"><div className="section-heading"><div><span className="eyebrow">EXPORTAR</span><h2>Crie uma mixagem</h2></div><span className="badge">WAV</span></div><p className="export-help">Escolha um stem ou combine vários. O volume, mute, solo, pitch e tempo atuais serão aplicados.</p><div className="export-stems">{stemNames.filter((stem) => selected.stems?.[stem]).map((stem) => <label className="export-stem" key={stem}><input type="checkbox" checked={stems.includes(stem)} onChange={() => toggleStem(stem)} /><span>{STEM_LABELS[stem]}</span></label>)}</div><label className="export-loop"><input type="checkbox" checked={useLoop} disabled={!loopEnabled} onChange={(event) => setUseLoop(event.target.checked)} /><span>Exportar somente o loop A-B{loopEnabled ? ` (${Math.round(loopStart * 100)}%–${Math.round(loopEnd * 100)}%)` : ' — ative o loop no transporte'}</span></label><button className="primary-button" disabled={working || stems.length === 0} onClick={() => void exportAudio()}>{working ? 'Processando mix…' : 'Exportar WAV'}</button>{message && <small className="export-success">{message}</small>}{error && <small className="export-error">{error}</small>}</section>
}
