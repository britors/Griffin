import { useEffect, useRef } from 'react'
import { StemAudioPlayer } from '../audio-player'
import { usePlayer } from '../store'

export function AudioPlayback() {
  const engine = useRef<StemAudioPlayer | null>(null)
  const selected = usePlayer((state) => state.selected)
  const playing = usePlayer((state) => state.playing)
  const position = usePlayer((state) => state.position)
  const seekVersion = usePlayer((state) => state.seekVersion)
  const tempo = usePlayer((state) => state.tempo)
  const pitch = usePlayer((state) => state.pitch)
  const resetPlaybackOnTrackChange = usePlayer((state) => state.resetPlaybackOnTrackChange)
  const loopEnabled = usePlayer((state) => state.loopEnabled)
  const loopStart = usePlayer((state) => state.loopStart)
  const loopEnd = usePlayer((state) => state.loopEnd)
  const volumes = usePlayer((state) => state.volumes)
  const muted = usePlayer((state) => state.muted)
  const solo = usePlayer((state) => state.solo)
  const setPlaying = usePlayer((state) => state.setPlaying)
  const setPosition = usePlayer((state) => state.setPosition)

  useEffect(() => {
    engine.current = new StemAudioPlayer()
    return () => { engine.current?.dispose(); engine.current = null }
  }, [])

  useEffect(() => {
    const player = engine.current
    if (!player || !selected) return
    const requestedPosition = position
    void player.load(selected).then(() => {
      if (!resetPlaybackOnTrackChange && player.length > 0) player.seek(requestedPosition * player.length, false, tempo, pitch)
    }).catch(() => setPlaying(false))
  }, [selected, resetPlaybackOnTrackChange, setPlaying])

  useEffect(() => {
    const player = engine.current
    if (!player) return
    for (const stem of ['vocals', 'drums', 'bass', 'other'] as const) player.setMix(stem, volumes[stem], muted[stem], solo)
  }, [volumes, muted, solo])

  useEffect(() => {
    const player = engine.current
    if (!player || !selected?.stems || !player.isLoaded) return
    if (playing) {
      void player.play(position * player.length, tempo, pitch, () => { setPosition(1); setPlaying(false) })
    } else {
      setPosition(player.pause() / player.length)
    }
  }, [playing, setPlaying, setPosition])

  useEffect(() => {
    const player = engine.current
    if (!player || !player.isLoaded || seekVersion === 0) return
    player.seek(position * player.length, playing, tempo, pitch, () => { setPosition(1); setPlaying(false) })
  }, [seekVersion, playing, setPlaying, setPosition, tempo, pitch])

  useEffect(() => {
    const player = engine.current
    if (!player || !playing) return
    const timer = window.setInterval(() => {
      const current = player.currentTime() / player.length
      if (loopEnabled && current >= loopEnd) {
        setPosition(loopStart)
        player.seek(loopStart * player.length, true, tempo, pitch, () => { setPosition(1); setPlaying(false) })
      } else {
        setPosition(current)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [playing, loopEnabled, loopStart, loopEnd, tempo, pitch, setPlaying, setPosition])

  useEffect(() => { engine.current?.setTempo(tempo) }, [tempo])
  useEffect(() => { engine.current?.setPitch(pitch) }, [pitch])
  return null
}
