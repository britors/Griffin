import { create } from 'zustand'
import type { Project, SeparationProgress, StemName, Track } from '../shared/types'

interface PlayerState {
  tracks: Track[]
  projects: Project[]
  activeProjectId: string | null
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
  muted: Record<StemName, boolean>
  solo: StemName | null
  setTracks: (tracks: Track[]) => void
  setProjects: (projects: Project[]) => void
  setActiveProject: (projectId: string | null) => void
  select: (track: Track | null) => void
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
  toggleMute: (stem: StemName) => void
  toggleSolo: (stem: StemName) => void
}

export const usePlayer = create<PlayerState>((set) => ({
  tracks: [], projects: [], activeProjectId: null, selected: null, playing: false, position: 0, seekVersion: 0, pitch: 0, tempo: 1, loopEnabled: false, loopStart: 0, loopEnd: 1, progress: null,
  volumes: { vocals: 0.82, drums: 0.82, bass: 0.82, other: 0.82 },
  muted: { vocals: false, drums: false, bass: false, other: false }, solo: null,
  setTracks: (tracks) => set({ tracks }),
  setProjects: (projects) => set((state) => ({ projects, activeProjectId: projects.some((project) => project.id === state.activeProjectId) ? state.activeProjectId : projects[0]?.id ?? null })),
  setActiveProject: (activeProjectId) => set({ activeProjectId, selected: null, playing: false, position: 0 }),
  select: (selected) => set({ selected, playing: false, position: 0 }),
  setPlaying: (playing) => set({ playing }), setPosition: (position) => set({ position }),
  seekTo: (position) => set((state) => ({ position, seekVersion: state.seekVersion + 1 })),
  setPitch: (pitch) => set({ pitch }), setTempo: (tempo) => set({ tempo }),
  setLoopEnabled: (loopEnabled) => set({ loopEnabled }),
  setLoopStart: (loopStart) => set((state) => ({ loopStart: Math.max(0, Math.min(loopStart, state.loopEnd - 0.01)) })),
  setLoopEnd: (loopEnd) => set((state) => ({ loopEnd: Math.min(1, Math.max(loopEnd, state.loopStart + 0.01)) })),
  clearLoop: () => set({ loopEnabled: false, loopStart: 0, loopEnd: 1 }),
  setProgress: (progress) => set({ progress }),
  setVolume: (stem, volume) => set((state) => ({ volumes: { ...state.volumes, [stem]: volume } })),
  toggleMute: (stem) => set((state) => ({ muted: { ...state.muted, [stem]: !state.muted[stem] } })),
  toggleSolo: (stem) => set((state) => ({ solo: state.solo === stem ? null : stem })),
}))
