import { create } from 'zustand'
import type { SeparationProgress, StemName, Track } from '../shared/types'

interface PlayerState {
  tracks: Track[]
  selected: Track | null
  playing: boolean
  position: number
  seekVersion: number
  pitch: number
  tempo: number
  progress: SeparationProgress | null
  volumes: Record<StemName, number>
  muted: Record<StemName, boolean>
  solo: StemName | null
  setTracks: (tracks: Track[]) => void
  select: (track: Track | null) => void
  setPlaying: (playing: boolean) => void
  setPosition: (position: number) => void
  seekTo: (position: number) => void
  setPitch: (pitch: number) => void
  setTempo: (tempo: number) => void
  setProgress: (progress: SeparationProgress | null) => void
  setVolume: (stem: StemName, volume: number) => void
  toggleMute: (stem: StemName) => void
  toggleSolo: (stem: StemName) => void
}

export const usePlayer = create<PlayerState>((set) => ({
  tracks: [], selected: null, playing: false, position: 0, seekVersion: 0, pitch: 0, tempo: 1, progress: null,
  volumes: { vocals: 0.82, drums: 0.82, bass: 0.82, other: 0.82 },
  muted: { vocals: false, drums: false, bass: false, other: false }, solo: null,
  setTracks: (tracks) => set({ tracks }), select: (selected) => set({ selected, playing: false, position: 0 }),
  setPlaying: (playing) => set({ playing }), setPosition: (position) => set({ position }),
  seekTo: (position) => set((state) => ({ position, seekVersion: state.seekVersion + 1 })),
  setPitch: (pitch) => set({ pitch }), setTempo: (tempo) => set({ tempo }), setProgress: (progress) => set({ progress }),
  setVolume: (stem, volume) => set((state) => ({ volumes: { ...state.volumes, [stem]: volume } })),
  toggleMute: (stem) => set((state) => ({ muted: { ...state.muted, [stem]: !state.muted[stem] } })),
  toggleSolo: (stem) => set((state) => ({ solo: state.solo === stem ? null : stem })),
}))
