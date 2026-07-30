import { useEffect, useRef, useState } from 'react'
import { formatDuration } from '../../shared/utils'
import type { TrackAnalysis, TrackSection } from '../../shared/types'
import { api } from '../api'
import { usePlayer } from '../store'
import { Waveform } from './waveform'

export function PlayerTransport() {
  const { selected, playing, position, pitch, tempo, loopEnabled, loopStart, loopEnd, metronomeEnabled, countInEnabled, countInBars, countingIn, setPlaying, setCountingIn, seekTo, setPitch, setTempo, setLoopEnabled, setLoopStart, setLoopEnd, clearLoop } = usePlayer()
  const duration = selected?.duration ?? 216
  const countInTimer = useRef<number | null>(null)
  const requestPlay = () => {
    if (countInTimer.current !== null) { window.clearTimeout(countInTimer.current); countInTimer.current = null; setCountingIn(false) }
    if (playing) { setPlaying(false); return }
    if (!metronomeEnabled || !countInEnabled) { setPlaying(true); return }
    setCountingIn(true)
    countInTimer.current = window.setTimeout(() => { setCountingIn(false); setPlaying(true); countInTimer.current = null }, countInBars * 4 * (60_000 / (selected?.analysis?.bpm ?? 120)) / tempo)
  }
  useEffect(() => {
    const onToggle = () => requestPlay()
    window.addEventListener('griffin:toggle-play', onToggle)
    return () => { window.removeEventListener('griffin:toggle-play', onToggle); if (countInTimer.current !== null) window.clearTimeout(countInTimer.current) }
  })
  return <section className="panel transport"><div className="track-title"><div><span className="eyebrow">NOW PLAYING</span><h2>{selected?.name ?? 'Nenhuma faixa selecionada'}</h2></div><span className="time">{formatDuration(position * duration)} <i>/ {formatDuration(duration)}</i></span></div><TrackAnalysisEditor />{countingIn && <div className="count-in-status">Contagem de entrada…</div>}<Waveform /><div className="transport-controls"><button className="transport-button" onClick={() => seekTo(Math.max(0, position - 0.05))}>↶</button><button className="play-button" onClick={requestPlay}>{playing ? 'Ⅱ' : '▶'}</button><button className="transport-button" onClick={() => seekTo(Math.min(1, position + 0.05))}>↷</button><button className={`loop-button ${loopEnabled ? 'active' : ''}`} onClick={() => setLoopEnabled(!loopEnabled)}>↻ <span>Loop</span></button></div><div className="loop-range-controls"><button className="loop-marker" onClick={() => setLoopStart(position)}>A <small>{formatDuration(loopStart * duration)}</small></button><span>até</span><button className="loop-marker" onClick={() => setLoopEnd(position)}>B <small>{formatDuration(loopEnd * duration)}</small></button><button className="loop-clear" onClick={clearLoop}>Limpar</button></div><div className="adjustments"><label>Pitch <output>{pitch > 0 ? '+' : ''}{pitch} st</output><input type="range" min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label><label>Tempo <output>{Math.round(tempo * 100)}%</output><input type="range" min="0.5" max="1.5" step="0.01" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} /></label></div></section>
}

function TrackAnalysisEditor() {
  const { selected, setTracks, replaceSelected } = usePlayer()
  const [draft, setDraft] = useState<TrackAnalysis | null>(null)
  const [sections, setSections] = useState<TrackSection[]>([])
  useEffect(() => { setDraft(selected?.analysis ? { ...selected.analysis } : null); setSections(selected?.analysis?.sections ? selected.analysis.sections.map((section) => ({ ...section })) : []) }, [selected?.id, selected?.analysis])
  if (!selected) return null
  if (!draft) return <div className="analysis-pending">Analisando BPM, tonalidade e afinação localmente…</div>

  const save = async (changes: Partial<TrackAnalysis>) => {
    const updated = await api.analysis.update(selected.id, changes)
    setTracks(usePlayer.getState().tracks.map((track) => track.id === updated.id ? updated : track))
    replaceSelected(updated)
  }

  const saveSections = async (nextSections: TrackSection[]) => {
    setSections(nextSections)
    await save({ sections: nextSections })
  }

  return <div className="track-analysis-wrap"><div className="track-analysis" aria-label="Análise da faixa">
    <label><small>BPM</small><input type="number" min="30" max="300" value={draft.bpm} onChange={(event) => setDraft({ ...draft, bpm: Number(event.target.value) })} onBlur={() => void save({ bpm: draft.bpm })} /></label>
    <label><small>TONALIDADE</small><input value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} onBlur={() => void save({ key: draft.key })} /></label>
    <label><small>AFINAÇÃO</small><input type="number" min="430" max="450" value={draft.tuningHz} onChange={(event) => setDraft({ ...draft, tuningHz: Number(event.target.value) })} onBlur={() => void save({ tuningHz: draft.tuningHz })} /></label>
    <span className="analysis-confidence">{Math.round(draft.confidence * 100)}% confiança</span>
  </div><div className="sections-editor" aria-label="Seções detectadas"><span className="sections-title">SEÇÕES</span>{sections.map((section) => <div className="section-edit-row" key={section.id}><button className="section-jump" title={`Ir para ${section.name}`} onClick={() => usePlayer.getState().seekTo(section.start)}>{section.name}</button><input aria-label={`Nome de ${section.name}`} value={section.name} onChange={(event) => setSections(sections.map((item) => item.id === section.id ? { ...item, name: event.target.value } : item))} onBlur={() => void saveSections(sections)} /><input aria-label={`Início de ${section.name} em porcentagem`} type="number" min="0" max="100" value={Math.round(section.start * 100)} onChange={(event) => setSections(sections.map((item) => item.id === section.id ? { ...item, start: Number(event.target.value) / 100 } : item))} onBlur={() => void saveSections(sections)} /><span>–</span><input aria-label={`Fim de ${section.name} em porcentagem`} type="number" min="0" max="100" value={Math.round(section.end * 100)} onChange={(event) => setSections(sections.map((item) => item.id === section.id ? { ...item, end: Number(event.target.value) / 100 } : item))} onBlur={() => void saveSections(sections)} /></div>)}</div></div>
}
