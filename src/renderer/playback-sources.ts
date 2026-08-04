import { ALL_STEMS, type StemName, type Track } from '../shared/types'

export type TrackPlaybackSource =
  | { kind: 'original'; path: string }
  | { kind: 'stem'; stem: StemName; path: string }

export function trackPlaybackSources(track: Track): TrackPlaybackSource[] {
  const stemSources = ALL_STEMS.flatMap((stem) => {
    const path = track.stems?.[stem]
    return path ? [{ kind: 'stem' as const, stem, path }] : []
  })

  return stemSources.length > 0 ? stemSources : [{ kind: 'original', path: track.path }]
}

export function playbackTransform(tempo: number, pitch: number) {
  return { tempo, pitch, requiresTimeStretch: tempo !== 1 || pitch !== 0 }
}
