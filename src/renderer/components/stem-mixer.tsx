import { STEM_LABELS, type StemName } from '../../shared/types'
import { usePlayer } from '../store'

const stems: StemName[] = ['vocals', 'drums', 'bass', 'other']
const icons: Record<StemName, string> = { vocals: '◉', drums: '▦', bass: '◒', other: '✦' }

export function StemMixer() {
  const { volumes, muted, solo, setVolume, toggleMute, toggleSolo } = usePlayer()
  return <section className="panel mixer"><div className="section-heading"><div><span className="eyebrow">MIXER</span><h2>Seus stems</h2></div><span className="badge">4 canais</span></div><div className="stem-grid">
    {stems.map((stem) => <div className={`stem ${solo === stem ? 'is-solo' : ''}`} key={stem}>
      <div className="stem-top"><span className={`stem-icon ${stem}`}>{icons[stem]}</span><span>{STEM_LABELS[stem]}</span><button className={`round-button ${muted[stem] ? 'active' : ''}`} onClick={() => toggleMute(stem)}>{muted[stem] ? 'M' : '🔊'}</button></div>
      <input className="volume" type="range" min="0" max="1" step="0.01" value={volumes[stem]} onChange={(event) => setVolume(stem, Number(event.target.value))} />
      <div className="stem-bottom"><span>{Math.round(volumes[stem] * 100)}%</span><button className={`solo-button ${solo === stem ? 'active' : ''}`} onClick={() => toggleSolo(stem)}>SOLO</button></div>
    </div>)}
  </div></section>
}
