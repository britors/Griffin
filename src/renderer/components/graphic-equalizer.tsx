import { useState } from 'react'
import { ALL_STEMS, EQUALIZER_FREQUENCIES, STEM_LABELS, type PlaybackChannel } from '../../shared/types'
import { usePlayer } from '../store'

function formatFrequency(frequency: number) { return frequency >= 1000 ? `${frequency / 1000}k` : String(frequency) }

export function GraphicEqualizer() {
  const [channel, setChannel] = useState<PlaybackChannel>('original')
  const { selected, equalizer, setEqualizerBand } = usePlayer()
  const stems = ALL_STEMS.filter((item) => Boolean(selected?.stems?.[item]))
  const channels: PlaybackChannel[] = stems.length > 0 ? stems : ['original']
  const activeChannel = channels.includes(channel) ? channel : channels[0]
  const label = activeChannel === 'original' ? 'Original' : STEM_LABELS[activeChannel]
  const gains = equalizer[activeChannel] ?? Array(12).fill(0)
  const points = gains.map((gain, index) => `${(index / (gains.length - 1)) * 100},${50 - gain * 3}`).join(' ')
  const applyPreset = (preset: 'flat' | 'vocal' | 'bass-cut' | 'bright') => {
    const values = { flat: Array(12).fill(0), vocal: [-3, -2, -1, 1, 3, 4, 3, 2, 1, 0, -1, -2], 'bass-cut': [-12, -9, -6, -3, 0, 0, 0, 0, 0, 0, 0, 0], bright: [0, 0, 0, 1, 1, 2, 3, 3, 4, 4, 3, 2] }[preset]
    values.forEach((gain, index) => setEqualizerBand(activeChannel, index, gain))
  }

  return <section className="panel equalizer-panel"><div className="section-heading"><div><span className="eyebrow">EQUALIZADOR</span><h2>12 bandas gráficas</h2></div><span className="badge">{label}</span></div><div className="eq-stem-tabs">{channels.map((item) => <button className={activeChannel === item ? 'active' : ''} key={item} onClick={() => setChannel(item)}>{item === 'original' ? 'Original' : STEM_LABELS[item]}</button>)}</div><div className="eq-graph" aria-label={`Curva de equalização de ${label}`}><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"><line x1="0" y1="50" x2="100" y2="50" /><polyline points={points} /></svg><span className="eq-plus">+12 dB</span><span className="eq-zero">0</span><span className="eq-minus">−12 dB</span></div><div className="eq-band-grid">{EQUALIZER_FREQUENCIES.map((frequency, index) => <div className="eq-band" key={frequency}><output>{gains[index] > 0 ? '+' : ''}{Math.round(gains[index])}</output><div className="eq-slider-wrap"><input aria-label={`${formatFrequency(frequency)} Hz`} type="range" min="-12" max="12" step="1" value={gains[index]} onChange={(event) => setEqualizerBand(activeChannel, index, Number(event.target.value))} /></div><span>{formatFrequency(frequency)}</span></div>)}</div><div className="eq-presets"><button className="secondary-button" onClick={() => applyPreset('flat')}>Flat</button><button className="secondary-button" onClick={() => applyPreset('vocal')}>Vocal</button><button className="secondary-button" onClick={() => applyPreset('bass-cut')}>Bass cut</button><button className="secondary-button" onClick={() => applyPreset('bright')}>Bright</button></div></section>
}
