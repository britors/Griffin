import { useEffect, useRef, useState } from 'react'
import { usePlayer } from '../store'

export function ProgressivePractice() {
  const { playing, tempo, loopEnabled, loopStart, loopEnd, loopIteration, setTempo } = usePlayer()
  const [enabled, setEnabled] = useState(false)
  const [startPercent, setStartPercent] = useState(70)
  const [endPercent, setEndPercent] = useState(100)
  const [incrementPercent, setIncrementPercent] = useState(5)
  const [repetitions, setRepetitions] = useState(2)
  const [completed, setCompleted] = useState(0)
  const lastLoopIteration = useRef(loopIteration)

  useEffect(() => {
    if (!enabled) return
    setCompleted(0)
    lastLoopIteration.current = loopIteration
    setTempo(startPercent / 100)
  }, [enabled, setTempo, startPercent])

  useEffect(() => {
    if (!enabled || !playing || !loopEnabled) {
      lastLoopIteration.current = loopIteration
      return
    }
    if (loopIteration === lastLoopIteration.current) return
    lastLoopIteration.current = loopIteration
    const nextCompleted = completed + 1
    if (nextCompleted >= repetitions) {
      setCompleted(0)
      setTempo(Math.min(endPercent / 100, tempo + incrementPercent / 100))
    } else setCompleted(nextCompleted)
  }, [loopIteration, enabled, playing, loopEnabled, completed, repetitions, tempo, endPercent, incrementPercent, setTempo])

  const toggle = () => {
    const nextEnabled = !enabled
    setEnabled(nextEnabled)
    if (!nextEnabled) setTempo(1)
  }

  return <div className="progressive-practice"><div className="progressive-heading"><div><strong>Prática progressiva</strong><small>Aumenta o tempo a cada repetição do loop.</small></div><button className={`practice-toggle ${enabled ? 'active' : ''}`} onClick={toggle}>{enabled ? 'Ativa' : 'Ativar'}</button></div><div className="practice-fields"><label>Início<input type="number" min="30" max="100" value={startPercent} disabled={enabled} onChange={(event) => setStartPercent(Number(event.target.value))} />%</label><label>Final<input type="number" min="30" max="150" value={endPercent} disabled={enabled} onChange={(event) => setEndPercent(Number(event.target.value))} />%</label><label>Incremento<input type="number" min="1" max="25" value={incrementPercent} disabled={enabled} onChange={(event) => setIncrementPercent(Number(event.target.value))} />%</label><label>Repetições<input type="number" min="1" max="20" value={repetitions} disabled={enabled} onChange={(event) => setRepetitions(Number(event.target.value))} /></label></div>{enabled && <div className="practice-progress">{!loopEnabled ? 'Ative o loop A-B para iniciar.' : `Tempo ${Math.round(tempo * 100)}% · repetição ${completed + 1}/${repetitions} · limite ${endPercent}%`}{loopEnabled && <span style={{ width: `${Math.min(100, (tempo / (endPercent / 100)) * 100)}%` }} />}</div>}{loopEnabled && enabled && <span className="practice-range">Trecho: {Math.round(loopStart * 100)}% – {Math.round(loopEnd * 100)}%</span>}</div>
}
