import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { getActiveStemAudioPlayer } from '../audio-player'
import { usePlayer } from '../store'
import { ALL_STEMS, CORE_STEMS, STEM_LABELS, type SeparationProvider, type SeparationTarget, type SeparationStatus, type StemName } from '../../shared/types'
import { PlayerTransport } from '../components/player-transport'
import { StemMixer } from '../components/stem-mixer'
import { LyricsPanel } from '../components/lyrics-panel'
import { ExportPanel } from '../components/export-panel'
import { GraphicEqualizer } from '../components/graphic-equalizer'
import { PerformanceRecorder } from '../components/performance-recorder'
import { useRemoteProvider } from '../hooks/use-remote-provider'
import { confirmDialog } from '../components/dialog-store'
import { useModelDownload } from '../hooks/use-model-download'
import { errorMessage } from '../error-message'

// Resets on app restart — a lightweight per-session consent flag, not persisted to disk.
let remoteConsentedThisSession = false

export function PlayerPage() {
  const { selected, progress, setTracks, select, replaceSelected, setProgress, setPlaying } = usePlayer()
  const [error, setError] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<SeparationStatus | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [target, setTarget] = useState<SeparationTarget>('all')
  const [provider, setProvider] = useState<SeparationProvider>('local')
  const [lastRemoteError, setLastRemoteError] = useState(false)
  const analysisRequested = useRef<string | null>(null)
  const remoteProvider = useRemoteProvider()
  const remoteAvailable = remoteProvider.status?.verified === true
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
    }).catch((reason) => setAnalysisError(errorMessage(reason, 'Não foi possível analisar a faixa.')))
  }, [selected, replaceSelected, setTracks])

  const targetStems = modelStatus?.sixStemAvailable ? ALL_STEMS : CORE_STEMS
  const targetLabel = target === 'all' ? 'todos os stems' : STEM_LABELS[target]
  const canSeparate = provider === 'remote' ? remoteAvailable : Boolean(modelStatus?.available)

  const separate = async (useProvider: SeparationProvider = provider) => {
    if (!selected || progress) return
    if (useProvider === 'remote') {
      if (!remoteAvailable) return
      if (!remoteConsentedThisSession) {
        const estimate = await remoteProvider.estimateCost(selected.id).catch(() => null)
        const costLine = estimate ? `Custo estimado: ~$${estimate.estimatedUsd.toFixed(2)} (${Math.round(estimate.durationSeconds)}s de áudio, ~$0,10/min).` : 'Não foi possível estimar o custo agora.'
        const consented = await confirmDialog(`Esta faixa será enviada para o StemSplit.io (nuvem) — o áudio deixa este computador.\n\n${costLine}\n\nO arquivo original é apagado em até 48h; os stems ficam disponíveis por 7-14 dias. Cancelar não garante que a cobrança seja evitada, já que o processamento pode já ter começado no servidor.`, { confirmLabel: 'Enviar para a nuvem' })
        if (!consented) return
        remoteConsentedThisSession = true
      }
    } else if (!modelStatus?.available) return
    setError(null)
    setLastRemoteError(false)
    setCancelling(false)
    setPlaying(false)
    getActiveStemAudioPlayer()?.unload()
    setProgress({ trackId: selected.id, progress: 0, stage: `Preparando ${targetLabel}` })
    try {
      const separated = await api.separation.start(selected, target === 'all' ? undefined : target, useProvider)
      setTracks(await api.library.list())
      select(separated)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível extrair o stem.')
      setLastRemoteError(useProvider === 'remote')
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
        {remoteAvailable && <label>MOTOR<select value={provider} onChange={(event) => setProvider(event.target.value as SeparationProvider)}><option value="local">Local</option><option value="remote">Nuvem (StemSplit)</option></select></label>}
        <label>EXTRAIR<select value={target} disabled={!canSeparate} onChange={(event) => setTarget(event.target.value as SeparationTarget)}><option value="all">Todos os stems</option>{targetStems.map((stem) => <option key={stem} value={stem}>{STEM_LABELS[stem]}{selected.stems?.[stem] ? ' · já extraído' : ''}</option>)}</select></label>
        <button className="primary-button" disabled={!canSeparate} onClick={() => void separate()}>{target === 'all' ? 'Separar stems' : `Extrair ${STEM_LABELS[target]}`}</button>
      </div>)}
    </div>
    {error && <div className="error-banner">{error}{lastRemoteError && <button className="secondary-button compact-control" onClick={() => void separate('local')}>Tentar localmente</button>}</div>}
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
