import { ALL_STEMS, STEM_LABELS, type OutputRoute, type StemName } from '../../shared/types'
import { usePlayer } from '../store'

const icons: Record<StemName, string> = { vocals: '◉', drums: '▦', bass: '◒', other: '✦', guitar: '⌁', piano: '▤' }

export function StemMixer() {
  const { selected, volumes, pans, routes, muted, solo, setVolume, setPan, setRoute, toggleMute, toggleSolo } = usePlayer()
  const stems = ALL_STEMS.filter((stem) => Boolean(selected?.stems?.[stem]))
  return <section className="panel mixer"><div className="section-heading"><div><span className="eyebrow">MIXER</span><h2>Seus stems</h2></div><span className="badge">{stems.length} canais</span></div><p className="mixer-help">Estéreo usa o dispositivo padrão. Canal L/R fixa o stem no canal correspondente e mantém o sincronismo.</p><div className="stem-grid">
    {stems.map((stem) => <div className={`stem ${solo === stem ? 'is-solo' : ''}`} key={stem}>
      <div className="stem-top"><span className={`stem-icon ${stem}`}>{icons[stem]}</span><span>{STEM_LABELS[stem]}</span><button className={`round-button ${muted[stem] ? 'active' : ''}`} onClick={() => toggleMute(stem)}>{muted[stem] ? 'M' : '🔊'}</button></div>
      <input className="volume" type="range" min="0" max="1" step="0.01" value={volumes[stem] ?? 0.82} onChange={(event) => setVolume(stem, Number(event.target.value))} />
      <label className="pan-control"><span>PAN</span><output>{(pans[stem] ?? 0) === 0 ? 'C' : (pans[stem] ?? 0) < 0 ? `L${Math.round(Math.abs(pans[stem] ?? 0) * 100)}` : `R${Math.round((pans[stem] ?? 0) * 100)}`}</output><input type="range" min="-1" max="1" step="0.01" value={pans[stem] ?? 0} aria-label={`Panorama de ${STEM_LABELS[stem]}`} onChange={(event) => setPan(stem, Number(event.target.value))} /></label>
      <label className="route-control"><span>SAÍDA</span><select aria-label={`Saída de ${STEM_LABELS[stem]}`} value={routes[stem] ?? 'stereo'} onChange={(event) => setRoute(stem, event.target.value as OutputRoute)}><option value="stereo">Estéreo</option><option value="left">Canal L</option><option value="right">Canal R</option></select></label>
      <div className="stem-bottom"><span>{Math.round((volumes[stem] ?? 0.82) * 100)}%</span><button className={`solo-button ${solo === stem ? 'active' : ''}`} onClick={() => toggleSolo(stem)}>SOLO</button></div>
    </div>)}
  </div></section>
}
