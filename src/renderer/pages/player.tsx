import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import type { SeparationStatus } from '../../shared/types'
import { PlayerTransport } from '../components/player-transport'
import { StemMixer } from '../components/stem-mixer'
import { LyricsPanel } from '../components/lyrics-panel'
import { ExportPanel } from '../components/export-panel'
import { GraphicEqualizer } from '../components/graphic-equalizer'

export function PlayerPage() {
  const { selected, progress, setTracks, select, replaceSelected, setProgress } = usePlayer()
  const [error, setError] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<SeparationStatus | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const analysisRequested = useRef<string | null>(null)
  useEffect(() => { void api.separation.status().then(setModelStatus) }, [])
  useEffect(() => {
    if (!selected || selected.analysis || analysisRequested.current === selected.id) return
    analysisRequested.current = selected.id
    setAnalysisError(null)
    void api.analysis.analyze(selected.id).then((analyzed) => {
      setTracks(usePlayer.getState().tracks.map((track) => track.id === analyzed.id ? analyzed : track))
      replaceSelected(analyzed)
    }).catch((reason) => setAnalysisError(reason instanceof Error ? reason.message : 'Não foi possível analisar a faixa.'))
  }, [selected, replaceSelected, setTracks])
  const separate = async () => {
    if (!selected || !modelStatus?.available || progress) return
    setError(null)
    setCancelling(false)
    setProgress({ trackId: selected.id, progress: 0, stage: 'Iniciando separação' })
    try {
      const separated = await api.separation.start(selected)
      setTracks(await api.library.list())
      select(separated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível separar esta faixa.')
    } finally {
      setCancelling(false)
      setProgress(null)
    }
  }
  const cancel = async () => {
    if (!selected || !progress || cancelling) return
    setCancelling(true)
    setProgress({ ...progress, stage: 'Cancelando separação' })
    await api.separation.cancel(selected.id)
  }
  return <main className="player-page"><div className="page-heading compact"><div><span className="eyebrow">STUDIO</span><h1>Pratique com precisão</h1><p>Ajuste cada detalhe da sua faixa.</p></div>{selected && !selected.stems && (progress ? <div className="separation-action"><span>{progress.stage} · {Math.round(progress.progress * 100)}%</span><button className="secondary-button" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? 'Cancelando…' : 'Cancelar'}</button></div> : <button className="primary-button" disabled={!modelStatus?.available} onClick={() => void separate()}>Separar stems</button>)}</div>{error && <div className="error-banner">{error}</div>}{analysisError && <div className="error-banner">{analysisError}</div>}{selected && !selected.stems && modelStatus && !modelStatus.available && <div className="model-notice"><span className="model-status-dot" />{modelStatus.message}</div>}<PlayerTransport /><LyricsPanel /><StemMixer /><GraphicEqualizer /><ExportPanel /></main>
}
