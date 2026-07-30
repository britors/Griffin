import { useEffect, useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../store'
import type { SeparationStatus } from '../../shared/types'
import { PlayerTransport } from '../components/player-transport'
import { StemMixer } from '../components/stem-mixer'

export function PlayerPage() {
  const { selected, progress, setTracks, select, setProgress } = usePlayer()
  const [error, setError] = useState<string | null>(null)
  const [modelStatus, setModelStatus] = useState<SeparationStatus | null>(null)
  useEffect(() => { void api.separation.status().then(setModelStatus) }, [])
  const separate = async () => { if (!selected || !modelStatus?.available) return; setError(null); setProgress({ trackId: selected.id, progress: 0, stage: 'Iniciando separação' }); try { const separated = await api.separation.start(selected); setTracks(await api.library.list()); select(separated) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível separar esta faixa.') } finally { setProgress(null) } }
  return <main className="player-page"><div className="page-heading compact"><div><span className="eyebrow">STUDIO</span><h1>Pratique com precisão</h1><p>Ajuste cada detalhe da sua faixa.</p></div>{selected && !selected.stems && <button className="primary-button" disabled={!modelStatus?.available || Boolean(progress)} onClick={() => void separate()}>{progress ? `Separando ${Math.round(progress.progress * 100)}%` : 'Separar stems'}</button>}</div>{error && <div className="error-banner">{error}</div>}{selected && !selected.stems && modelStatus && !modelStatus.available && <div className="model-notice"><span className="model-status-dot" />{modelStatus.message}</div>}<PlayerTransport /><StemMixer /></main>
}
