import { useEffect, useRef } from 'react'
import { StemAudioPlayer } from '../audio-player'
import { usePlayer } from '../store'
import { ALL_STEMS } from '../../shared/types'

function advanceQueue() {
  const state = usePlayer.getState()
  const project = state.projects.find((item) => item.id === state.activeProjectId)
  const queue = project?.trackIds.map((id) => state.tracks.find((track) => track.id === id)).filter((track): track is NonNullable<typeof track> => Boolean(track)) ?? []
  const currentIndex = queue.findIndex((track) => track.id === state.selected?.id)
  const next = currentIndex >= 0 ? queue[currentIndex + 1] : undefined
  if (!next) { state.setPosition(1); state.setPlaying(false); return }
  state.select(next)
  state.setPlaying(true)
}

export function AudioPlayback() {
  const engine = useRef<StemAudioPlayer | null>(null)
  const selected = usePlayer((state) => state.selected)
  const takePath = usePlayer((state) => state.takePath)
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
  const pans = usePlayer((state) => state.pans)
  const routes = usePlayer((state) => state.routes)
  const equalizer = usePlayer((state) => state.equalizer)
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
    void player.load(selected, takePath).then(() => {
      const state = usePlayer.getState()
      for (const stem of ALL_STEMS) {
        if (!state.volumes[stem]) continue
        player.setMix(stem, state.volumes[stem] ?? 0, state.muted[stem] ?? false, state.solo)
        player.setOutputRoute(stem, state.routes[stem] ?? 'stereo', state.pans[stem] ?? 0)
        player.setEqualizer(stem, state.equalizer[stem] ?? [])
      }
      if (!resetPlaybackOnTrackChange && player.length > 0) player.seek(requestedPosition * player.length, false, tempo, pitch)
      if (state.playing && state.selected?.id === selected.id) void player.play(state.position * player.length, state.tempo, state.pitch, advanceQueue)
    }).catch(() => setPlaying(false))
  }, [selected, takePath, resetPlaybackOnTrackChange, setPlaying])

  useEffect(() => {
    const player = engine.current
    if (!player) return
    for (const stem of ALL_STEMS) player.setMix(stem, volumes[stem] ?? 0, muted[stem] ?? false, solo)
    for (const stem of ALL_STEMS) player.setOutputRoute(stem, routes[stem] ?? 'stereo', pans[stem] ?? 0)
    for (const stem of ALL_STEMS) player.setEqualizer(stem, equalizer[stem] ?? [])
  }, [volumes, pans, routes, equalizer, muted, solo])

  useEffect(() => {
    const player = engine.current
    if (!player || !selected?.stems || !player.isLoaded) return
    if (playing) {
      void player.play(position * player.length, tempo, pitch, advanceQueue)
    } else {
      setPosition(player.pause() / player.length)
    }
  }, [playing, setPlaying, setPosition])

  useEffect(() => {
    const player = engine.current
    if (!player || !player.isLoaded || seekVersion === 0) return
    player.seek(position * player.length, playing, tempo, pitch, advanceQueue)
  }, [seekVersion, playing, setPlaying, setPosition, tempo, pitch])

  useEffect(() => {
    const player = engine.current
    if (!player || !playing) return
    const timer = window.setInterval(() => {
      const current = player.currentTime() / player.length
      if (loopEnabled && current >= loopEnd) {
        setPosition(loopStart)
        player.seek(loopStart * player.length, true, tempo, pitch, advanceQueue)
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
