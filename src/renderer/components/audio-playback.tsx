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
    void player.load(selected).catch(() => setPlaying(false))
  }, [selected, setPlaying])

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
  }, [playing, selected, setPlaying, setPosition])

  useEffect(() => {
    const player = engine.current
    if (!player || !player.isLoaded || seekVersion === 0) return
    player.seek(position * player.length, playing, tempo, pitch, () => { setPosition(1); setPlaying(false) })
  }, [seekVersion, playing, setPlaying, setPosition, tempo, pitch])

  useEffect(() => {
    const player = engine.current
    if (!player || !playing) return
    const timer = window.setInterval(() => setPosition(player.currentTime() / player.length), 100)
    return () => window.clearInterval(timer)
  }, [playing, setPosition])

  useEffect(() => { engine.current?.setTempo(tempo) }, [tempo])
  useEffect(() => { engine.current?.setPitch(pitch) }, [pitch])
  return null
}
