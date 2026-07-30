import { useEffect, useState } from 'react'
import { formatDuration } from '../../shared/utils'
import type { TrackAnalysis } from '../../shared/types'
import { api } from '../api'
import { usePlayer } from '../store'
import { Waveform } from './waveform'

export function PlayerTransport() {
  const { selected, playing, position, pitch, tempo, loopEnabled, loopStart, loopEnd, setPlaying, seekTo, setPitch, setTempo, setLoopEnabled, setLoopStart, setLoopEnd, clearLoop } = usePlayer()
  const duration = selected?.duration ?? 216
  return <section className="panel transport"><div className="track-title"><div><span className="eyebrow">NOW PLAYING</span><h2>{selected?.name ?? 'Nenhuma faixa selecionada'}</h2></div><span className="time">{formatDuration(position * duration)} <i>/ {formatDuration(duration)}</i></span></div><TrackAnalysisEditor /><Waveform /><div className="transport-controls"><button className="transport-button" onClick={() => seekTo(Math.max(0, position - 0.05))}>↶</button><button className="play-button" onClick={() => setPlaying(!playing)}>{playing ? 'Ⅱ' : '▶'}</button><button className="transport-button" onClick={() => seekTo(Math.min(1, position + 0.05))}>↷</button><button className={`loop-button ${loopEnabled ? 'active' : ''}`} onClick={() => setLoopEnabled(!loopEnabled)}>↻ <span>Loop</span></button></div><div className="loop-range-controls"><button className="loop-marker" onClick={() => setLoopStart(position)}>A <small>{formatDuration(loopStart * duration)}</small></button><span>até</span><button className="loop-marker" onClick={() => setLoopEnd(position)}>B <small>{formatDuration(loopEnd * duration)}</small></button><button className="loop-clear" onClick={clearLoop}>Limpar</button></div><div className="adjustments"><label>Pitch <output>{pitch > 0 ? '+' : ''}{pitch} st</output><input type="range" min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label><label>Tempo <output>{Math.round(tempo * 100)}%</output><input type="range" min="0.5" max="1.5" step="0.01" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} /></label></div></section>
}

function TrackAnalysisEditor() {
  const { selected, setTracks, replaceSelected } = usePlayer()
  const [draft, setDraft] = useState<TrackAnalysis | null>(null)
  useEffect(() => { setDraft(selected?.analysis ? { ...selected.analysis } : null) }, [selected?.id, selected?.analysis])
  if (!selected) return null
  if (!draft) return <div className="analysis-pending">Analisando BPM, tonalidade e afinação localmente…</div>

  const save = async (changes: Partial<TrackAnalysis>) => {
    const updated = await api.analysis.update(selected.id, changes)
    setTracks(usePlayer.getState().tracks.map((track) => track.id === updated.id ? updated : track))
    replaceSelected(updated)
  }

  return <div className="track-analysis" aria-label="Análise da faixa">
    <label><small>BPM</small><input type="number" min="30" max="300" value={draft.bpm} onChange={(event) => setDraft({ ...draft, bpm: Number(event.target.value) })} onBlur={() => void save({ bpm: draft.bpm })} /></label>
    <label><small>TONALIDADE</small><input value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} onBlur={() => void save({ key: draft.key })} /></label>
    <label><small>AFINAÇÃO</small><input type="number" min="430" max="450" value={draft.tuningHz} onChange={(event) => setDraft({ ...draft, tuningHz: Number(event.target.value) })} onBlur={() => void save({ tuningHz: draft.tuningHz })} /></label>
    <span className="analysis-confidence">{Math.round(draft.confidence * 100)}% confiança</span>
  </div>
}
