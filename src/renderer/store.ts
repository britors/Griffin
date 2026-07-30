import { create } from 'zustand'
import type { EqualizerBands, PlayerSnapshot, Project, ProjectSnapshot, SeparationProgress, StemName, Track } from '../shared/types'

export type MetronomeSubdivision = 1 | 2 | 4

interface PlayerState {
  tracks: Track[]
  projects: Project[]
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
  playing: boolean
  position: number
  seekVersion: number
  pitch: number
  tempo: number
  loopEnabled: boolean
  loopStart: number
  loopEnd: number
  progress: SeparationProgress | null
  volumes: Record<StemName, number>
  pans: Record<StemName, number>
  equalizer: Record<StemName, EqualizerBands>
  muted: Record<StemName, boolean>
  solo: StemName | null
  setTracks: (tracks: Track[]) => void
  setProjects: (projects: Project[]) => void
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
  setEqualizerBand: (stem: StemName, band: number, gain: number) => void
  toggleMute: (stem: StemName) => void
  toggleMuteAll: () => void
  toggleSolo: (stem: StemName) => void
  applyPlayerState: (player: PlayerSnapshot) => void
  applySnapshot: (snapshot: ProjectSnapshot) => void
}

export const usePlayer = create<PlayerState>((set) => ({
  tracks: [], projects: [], activeProjectId: null, favoriteIds: [], recentTrackIds: [], resetPlaybackOnTrackChange: true, metronomeEnabled: false, metronomeSubdivision: 1, metronomeVolume: 0.5, countInEnabled: false, countInBars: 1, countingIn: false, selected: null, playing: false, position: 0, seekVersion: 0, pitch: 0, tempo: 1, loopEnabled: false, loopStart: 0, loopEnd: 1, progress: null,
  volumes: { vocals: 0.82, drums: 0.82, bass: 0.82, other: 0.82 },
  pans: { vocals: 0, drums: 0, bass: 0, other: 0 },
  equalizer: { vocals: Array(12).fill(0), drums: Array(12).fill(0), bass: Array(12).fill(0), other: Array(12).fill(0) },
  muted: { vocals: false, drums: false, bass: false, other: false }, solo: null,
  setTracks: (tracks) => set({ tracks }),
  setProjects: (projects) => set((state) => ({ projects, activeProjectId: projects.some((project) => project.id === state.activeProjectId) ? state.activeProjectId : projects[0]?.id ?? null })),
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
  setPlaying: (playing) => set({ playing }), setPosition: (position) => set({ position }),
  seekTo: (position) => set((state) => ({ position, seekVersion: state.seekVersion + 1 })),
  setPitch: (pitch) => set({ pitch }), setTempo: (tempo) => set({ tempo }),
  setLoopEnabled: (loopEnabled) => set({ loopEnabled }),
  setLoopStart: (loopStart) => set((state) => ({ loopStart: Math.max(0, Math.min(loopStart, state.loopEnd - 0.01)) })),
  setLoopEnd: (loopEnd) => set((state) => ({ loopEnd: Math.min(1, Math.max(loopEnd, state.loopStart + 0.01)) })),
  clearLoop: () => set({ loopEnabled: false, loopStart: 0, loopEnd: 1 }),
  setProgress: (progress) => set({ progress }),
  setVolume: (stem, volume) => set((state) => ({ volumes: { ...state.volumes, [stem]: volume } })),
  setPan: (stem, pan) => set((state) => ({ pans: { ...state.pans, [stem]: Math.max(-1, Math.min(1, pan)) } })),
  setEqualizerBand: (stem, band, gain) => set((state) => ({ equalizer: { ...state.equalizer, [stem]: state.equalizer[stem].map((value, index) => index === band ? Math.max(-12, Math.min(12, gain)) : value) } })),
  toggleMute: (stem) => set((state) => ({ muted: { ...state.muted, [stem]: !state.muted[stem] } })),
  toggleMuteAll: () => set((state) => {
    const nextMuted = !Object.values(state.muted).every(Boolean)
    return { muted: { vocals: nextMuted, drums: nextMuted, bass: nextMuted, other: nextMuted } }
  }),
  toggleSolo: (stem) => set((state) => ({ solo: state.solo === stem ? null : stem })),
  applyPlayerState: (player) => set((state) => restorePlayerState(state, player)),
  applySnapshot: (snapshot) => set((state) => restorePlayerState(state, snapshot.player)),
}))

function restorePlayerState(state: PlayerState, player: PlayerSnapshot): Partial<PlayerState> {
  return { selected: state.tracks.find((track) => track.id === player.selectedTrackId) ?? null, position: player.position, pitch: player.pitch, tempo: player.tempo, loopEnabled: player.loopEnabled, loopStart: player.loopStart, loopEnd: player.loopEnd, volumes: player.volumes, pans: player.pans, equalizer: player.equalizer ?? state.equalizer, muted: player.muted, solo: player.solo }
}

export function playerSnapshot(state: PlayerState): PlayerSnapshot {
  return { selectedTrackId: state.selected?.id ?? null, position: state.position, pitch: state.pitch, tempo: state.tempo, loopEnabled: state.loopEnabled, loopStart: state.loopStart, loopEnd: state.loopEnd, volumes: state.volumes, pans: state.pans, equalizer: state.equalizer, muted: state.muted, solo: state.solo }
}
