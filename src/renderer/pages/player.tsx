import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import { ALL_STEMS, CORE_STEMS, STEM_LABELS, type SeparationTarget, type SeparationStatus, type StemName } from '../../shared/types'
import { PlayerTransport } from '../components/player-transport'
import { StemMixer } from '../components/stem-mixer'
import { LyricsPanel } from '../components/lyrics-panel'
import { ExportPanel } from '../components/export-panel'
import { GraphicEqualizer } from '../components/graphic-equalizer'
import { PerformanceRecorder } from '../components/performance-recorder'
import { useModelDownload } from '../hooks/use-model-download'

export function PlayerPage() {
  const { selected, progress, setTracks, select, replaceSelected, setProgress } = usePlayer()
  const [error, setError] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<SeparationStatus | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [target, setTarget] = useState<SeparationTarget>('all')
  const analysisRequested = useRef<string | null>(null)
  const modelDownload = useModelDownload()

  useEffect(() => { void api.separation.status().then(setModelStatus) }, [])
  useEffect(() => { if (modelDownload.status?.standardInstalled) void api.separation.status().then(setModelStatus) }, [modelDownload.status?.standardInstalled])
  useEffect(() => {
    if (!selected || selected.analysis || analysisRequested.current === selected.id) return
    analysisRequested.current = selected.id
    setAnalysisError(null)
    void api.analysis.analyze(selected.id).then((analyzed) => {
      setTracks(usePlayer.getState().tracks.map((track) => track.id === analyzed.id ? analyzed : track))
      replaceSelected(analyzed)
    }).catch((reason) => setAnalysisError(reason instanceof Error ? reason.message : 'Não foi possível analisar a faixa.'))
  }, [selected, replaceSelected, setTracks])

  const targetStems = modelStatus?.sixStemAvailable ? ALL_STEMS : CORE_STEMS
  const targetLabel = target === 'all' ? 'todos os stems' : STEM_LABELS[target]

  const separate = async () => {
    if (!selected || !modelStatus?.available || progress) return
    setError(null)
    setCancelling(false)
    setProgress({ trackId: selected.id, progress: 0, stage: `Preparando ${targetLabel}` })
    try {
      const separated = await api.separation.start(selected, target === 'all' ? undefined : target)
      setTracks(await api.library.list())
      select(separated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível extrair o stem.')
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

  return <main className="player-page">
    <div className="page-heading compact">
      <div><span className="eyebrow">STUDIO</span><h1>Pratique com precisão</h1><p>Ajuste cada detalhe da sua faixa.</p></div>
      {selected && (progress ? <div className="separation-action">
        <div className="separation-progress"><div className="separation-progress-meta" aria-live="polite"><span>{progress.stage}</span><strong>{Math.round(progress.progress * 100)}%</strong></div><div className="separation-progress-track" role="progressbar" aria-label="Progresso da separação" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.progress * 100)}><span style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div></div>
        <button className="secondary-button" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? 'Cancelando…' : 'Cancelar'}</button>
      </div> : <div className="separation-controls">
        <label>EXTRAIR<select value={target} disabled={!modelStatus?.available} onChange={(event) => setTarget(event.target.value as SeparationTarget)}><option value="all">Todos os stems</option>{targetStems.map((stem) => <option key={stem} value={stem}>{STEM_LABELS[stem]}{selected.stems?.[stem] ? ' · já extraído' : ''}</option>)}</select></label>
        <button className="primary-button" disabled={!modelStatus?.available} onClick={() => void separate()}>{target === 'all' ? 'Separar stems' : `Extrair ${STEM_LABELS[target]}`}</button>
      </div>)}
    </div>
    {error && <div className="error-banner">{error}</div>}
    {analysisError && <div className="error-banner">{analysisError}</div>}
    {selected && modelStatus && !modelStatus.available && <div className="model-notice">
      <span className="model-status-dot" /><span>{modelStatus.message}</span>
      {modelDownload.status && !modelDownload.status.standardInstalled && (modelDownload.progress?.kind === 'standard'
        ? <div className="model-download-progress"><div className="separation-progress-meta" aria-live="polite"><span>{modelDownload.progress.stage}</span><strong>{Math.round(modelDownload.progress.progress * 100)}%</strong></div><div className="separation-progress-track" role="progressbar" aria-label="Progresso do download do modelo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(modelDownload.progress.progress * 100)}><span style={{ width: `${Math.round(modelDownload.progress.progress * 100)}%` }} /></div></div>
        : <button className="secondary-button compact-control" disabled={modelDownload.status.downloading !== null} onClick={() => void modelDownload.download('standard')}>Baixar modelo (~1 GB)</button>)}
      {modelDownload.error && <span className="model-download-error">{modelDownload.error}</span>}
    </div>}
    <PlayerTransport />
    <LyricsPanel />
    <StemMixer />
    <GraphicEqualizer />
    <PerformanceRecorder />
    <ExportPanel />
  </main>
}
