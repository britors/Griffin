import { useEffect, useRef } from 'react'
import { usePlayer } from '../store'

export function Metronome() {
  const audioContext = useRef<AudioContext | null>(null)
  const { selected, playing, metronomeEnabled, metronomeSubdivision, metronomeVolume, countingIn, tempo, loopEnabled, loopStart, loopEnd } = usePlayer()
  const duration = selected?.duration ?? 216
  const bpm = selected?.analysis?.bpm ?? 120

  const click = (accent = false) => {
    const context = audioContext.current ?? new AudioContext()
    audioContext.current = context
    if (context.state === 'suspended') void context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = accent ? 1500 : 950
    gain.gain.setValueAtTime(Math.max(0.001, metronomeVolume * (accent ? 1 : 0.72)), context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.055)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.06)
  }

  useEffect(() => {
    if (!countingIn || !metronomeEnabled) return
    const interval = window.setInterval(() => click(), (60_000 / bpm) / tempo)
    click(true)
    return () => window.clearInterval(interval)
  }, [countingIn, metronomeEnabled, bpm, tempo, metronomeVolume])

  useEffect(() => {
    if (!playing || !metronomeEnabled || countingIn || !selected) return
    const beatLength = 60 / bpm
    const step = beatLength / metronomeSubdivision
    let nextMusicTime = Math.ceil((usePlayer.getState().position * duration) / step) * step
    const schedule = () => {
      const state = usePlayer.getState()
      if (!state.playing) return
      const currentMusicTime = state.position * duration
      if (loopEnabled && nextMusicTime >= loopEnd * duration && currentMusicTime >= loopEnd * duration) {
        nextMusicTime = loopStart * duration
        return
      }
      while (nextMusicTime <= currentMusicTime + 0.12) {
        const beatIndex = Math.max(0, Math.round(nextMusicTime / step))
        click(beatIndex % metronomeSubdivision === 0)
        nextMusicTime += step
        if (loopEnabled && nextMusicTime >= loopEnd * duration) {
          nextMusicTime = loopStart * duration
          break
        }
      }
    }
    schedule()
    const interval = window.setInterval(schedule, 30)
    return () => window.clearInterval(interval)
  }, [playing, metronomeEnabled, countingIn, selected?.id, bpm, tempo, metronomeSubdivision, metronomeVolume, duration, loopEnabled, loopStart, loopEnd])

  useEffect(() => () => { void audioContext.current?.close() }, [])
  return null
}
