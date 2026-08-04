import { create } from 'zustand'
import { ALL_STEMS, type EqualizerBands, type OutputRoute, type PlaybackChannel, type PlayerSnapshot, type Project, type ProjectFolder, type ProjectSnapshot, type SeparationProgress, type StemName, type Track } from '../shared/types'

export type MetronomeSubdivision = 1 | 2 | 4

export function addRecentTrack(recentTrackIds: string[], trackId: string, limit = 20) {
  return [trackId, ...recentTrackIds.filter((id) => id !== trackId)].slice(0, limit)
}

interface PlayerState {
  tracks: Track[]
  projects: Project[]
  folders: ProjectFolder[]
  activeProjectId: string | null
  favoriteIds: string[]
  recentTrackIds: string[]
  resetPlaybackOnTrackChange: boolean
  metronomeEnabled: boolean
  metronomeSubdivision: MetronomeSubdivision
  metronomeVolume: number
  countInEnabled: boolean
  countInBars: 1 | 2
  countingIn: boolean
  selected: Track | null
  takePath: string | null
  takeName: string | null
  playing: boolean
  position: number
  loopIteration: number
  seekVersion: number
  pitch: number
  tempo: number
  loopEnabled: boolean
  loopStart: number
  loopEnd: number
  progress: SeparationProgress | null
  volumes: Partial<Record<StemName, number>>
  pans: Partial<Record<StemName, number>>
  routes: Partial<Record<StemName, OutputRoute>>
  equalizer: Partial<Record<PlaybackChannel, EqualizerBands>>
  muted: Partial<Record<StemName, boolean>>
  solo: StemName | null
  setTracks: (tracks: Track[]) => void
  setProjects: (projects: Project[]) => void
  setFolders: (folders: ProjectFolder[]) => void
  setActiveProject: (projectId: string | null) => void
  setFavoriteIds: (ids: string[]) => void
  setRecentTrackIds: (ids: string[]) => void
  setResetPlaybackOnTrackChange: (enabled: boolean) => void
  setMetronomeEnabled: (enabled: boolean) => void
  setMetronomeSubdivision: (subdivision: MetronomeSubdivision) => void
  setMetronomeVolume: (volume: number) => void
  setCountInEnabled: (enabled: boolean) => void
  setCountInBars: (bars: 1 | 2) => void
  setCountingIn: (active: boolean) => void
  toggleFavorite: (trackId: string) => void
  select: (track: Track | null) => void
  replaceSelected: (track: Track) => void
  setPlaying: (playing: boolean) => void
  setPosition: (position: number) => void
  notifyLoopIteration: () => void
  seekTo: (position: number) => void
  setPitch: (pitch: number) => void
  setTempo: (tempo: number) => void
  setLoopEnabled: (enabled: boolean) => void
  setLoopStart: (position: number) => void
  setLoopEnd: (position: number) => void
  clearLoop: () => void
  setProgress: (progress: SeparationProgress | null) => void
  setVolume: (stem: StemName, volume: number) => void
  setPan: (stem: StemName, pan: number) => void
  setRoute: (stem: StemName, route: OutputRoute) => void
  setEqualizerBand: (channel: PlaybackChannel, band: number, gain: number) => void
  toggleMute: (stem: StemName) => void
  toggleMuteAll: () => void
  toggleSolo: (stem: StemName) => void
  setTake: (path: string, name: string) => void
  clearTake: () => void
  applyPlayerState: (player: PlayerSnapshot) => void
  applySnapshot: (snapshot: ProjectSnapshot) => void
}

export const usePlayer = create<PlayerState>((set) => ({
  tracks: [], projects: [], folders: [], activeProjectId: null, favoriteIds: [], recentTrackIds: [], resetPlaybackOnTrackChange: true, metronomeEnabled: false, metronomeSubdivision: 1, metronomeVolume: 0.5, countInEnabled: false, countInBars: 1, countingIn: false, selected: null, takePath: null, takeName: null, playing: false, position: 0, loopIteration: 0, seekVersion: 0, pitch: 0, tempo: 1, loopEnabled: false, loopStart: 0, loopEnd: 1, progress: null,
  volumes: Object.fromEntries(ALL_STEMS.map((stem) => [stem, 0.82])),
  pans: Object.fromEntries(ALL_STEMS.map((stem) => [stem, 0])),
  routes: Object.fromEntries(ALL_STEMS.map((stem) => [stem, 'stereo'])),
  equalizer: Object.fromEntries([...ALL_STEMS, 'original'].map((channel) => [channel, Array(12).fill(0)])),
  muted: Object.fromEntries(ALL_STEMS.map((stem) => [stem, false])), solo: null,
  setTracks: (tracks) => set({ tracks }),
  setProjects: (projects) => set((state) => ({ projects, activeProjectId: projects.some((project) => project.id === state.activeProjectId) ? state.activeProjectId : projects[0]?.id ?? null })),
  setFolders: (folders) => set({ folders }),
  setActiveProject: (activeProjectId) => set({ activeProjectId, selected: null, playing: false, position: 0 }),
  setFavoriteIds: (favoriteIds) => set({ favoriteIds }),
  setRecentTrackIds: (recentTrackIds) => set({ recentTrackIds }),
  setResetPlaybackOnTrackChange: (resetPlaybackOnTrackChange) => set({ resetPlaybackOnTrackChange }),
  setMetronomeEnabled: (metronomeEnabled) => set({ metronomeEnabled }),
  setMetronomeSubdivision: (metronomeSubdivision) => set({ metronomeSubdivision }),
  setMetronomeVolume: (metronomeVolume) => set({ metronomeVolume }),
  setCountInEnabled: (countInEnabled) => set({ countInEnabled }),
  setCountInBars: (countInBars) => set({ countInBars }),
  setCountingIn: (countingIn) => set({ countingIn }),
  toggleFavorite: (trackId) => set((state) => ({ favoriteIds: state.favoriteIds.includes(trackId) ? state.favoriteIds.filter((id) => id !== trackId) : [trackId, ...state.favoriteIds] })),
  select: (selected) => set((state) => ({ selected, playing: false, position: selected && !state.resetPlaybackOnTrackChange ? state.position : 0 })),
  replaceSelected: (selected) => set({ selected }),
  setPlaying: (playing) => set({ playing }), setPosition: (position) => set({ position }), notifyLoopIteration: () => set((state) => ({ loopIteration: state.loopIteration + 1 })),
  seekTo: (position) => set((state) => ({ position, seekVersion: state.seekVersion + 1 })),
  setPitch: (pitch) => set({ pitch }), setTempo: (tempo) => set({ tempo }),
  setLoopEnabled: (loopEnabled) => set({ loopEnabled }),
  setLoopStart: (loopStart) => set((state) => ({ loopStart: Math.max(0, Math.min(loopStart, state.loopEnd - 0.01)) })),
  setLoopEnd: (loopEnd) => set((state) => ({ loopEnd: Math.min(1, Math.max(loopEnd, state.loopStart + 0.01)) })),
  clearLoop: () => set({ loopEnabled: false, loopStart: 0, loopEnd: 1 }),
  setProgress: (progress) => set({ progress }),
  setVolume: (stem, volume) => set((state) => ({ volumes: { ...state.volumes, [stem]: volume } })),
  setPan: (stem, pan) => set((state) => ({ pans: { ...state.pans, [stem]: Math.max(-1, Math.min(1, pan)) } })),
  setRoute: (stem, route) => set((state) => ({ routes: { ...state.routes, [stem]: route } })),
  setEqualizerBand: (channel, band, gain) => set((state) => ({ equalizer: { ...state.equalizer, [channel]: (state.equalizer[channel] ?? Array(12).fill(0)).map((value, index) => index === band ? Math.max(-12, Math.min(12, gain)) : value) } })),
  toggleMute: (stem) => set((state) => ({ muted: { ...state.muted, [stem]: !(state.muted[stem] ?? false) } })),
  toggleMuteAll: () => set((state) => {
    const nextMuted = !Object.values(state.muted).every(Boolean)
    return { muted: Object.fromEntries(ALL_STEMS.map((stem) => [stem, nextMuted])) }
  }),
  toggleSolo: (stem) => set((state) => ({ solo: state.solo === stem ? null : stem })),
  setTake: (takePath, takeName) => set({ takePath, takeName }),
  clearTake: () => set({ takePath: null, takeName: null }),
  applyPlayerState: (player) => set((state) => restorePlayerState(state, player)),
  applySnapshot: (snapshot) => set((state) => restorePlayerState(state, snapshot.player)),
}))

function restorePlayerState(state: PlayerState, player: PlayerSnapshot): Partial<PlayerState> {
  return { selected: state.tracks.find((track) => track.id === player.selectedTrackId) ?? null, takePath: player.takePath ?? null, takeName: player.takeName ?? null, position: player.position, pitch: player.pitch, tempo: player.tempo, loopEnabled: player.loopEnabled, loopStart: player.loopStart, loopEnd: player.loopEnd, volumes: player.volumes, pans: player.pans, routes: player.routes ?? state.routes, equalizer: { ...state.equalizer, ...player.equalizer }, muted: player.muted, solo: player.solo }
}

export function playerSnapshot(state: PlayerState): PlayerSnapshot {
  return { selectedTrackId: state.selected?.id ?? null, takePath: state.takePath, takeName: state.takeName, position: state.position, pitch: state.pitch, tempo: state.tempo, loopEnabled: state.loopEnabled, loopStart: state.loopStart, loopEnd: state.loopEnd, volumes: state.volumes, pans: state.pans, routes: state.routes, equalizer: state.equalizer, muted: state.muted, solo: state.solo }
}
