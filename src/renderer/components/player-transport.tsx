import { formatDuration } from '../../shared/utils'
import { usePlayer } from '../store'
import { Waveform } from './waveform'

export function PlayerTransport() {
  const { selected, playing, position, pitch, tempo, setPlaying, seekTo, setPitch, setTempo } = usePlayer()
  return <section className="panel transport"><div className="track-title"><div><span className="eyebrow">NOW PLAYING</span><h2>{selected?.name ?? 'Nenhuma faixa selecionada'}</h2></div><span className="time">{formatDuration(position * (selected?.duration ?? 216))} <i>/ 3:36</i></span></div><Waveform /><div className="transport-controls"><button className="transport-button" onClick={() => seekTo(Math.max(0, position - 0.05))}>↶</button><button className="play-button" onClick={() => setPlaying(!playing)}>{playing ? 'Ⅱ' : '▶'}</button><button className="transport-button" onClick={() => seekTo(Math.min(1, position + 0.05))}>↷</button><button className="loop-button">↻ <span>Loop</span></button></div><div className="adjustments"><label>Pitch <output>{pitch > 0 ? '+' : ''}{pitch} st</output><input type="range" min="-12" max="12" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label><label>Tempo <output>{Math.round(tempo * 100)}%</output><input type="range" min="0.5" max="1.5" step="0.01" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} /></label></div></section>
}
