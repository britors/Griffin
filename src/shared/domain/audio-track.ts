import type { StemName, Track, TrackAnalysis } from '../types'

export interface NewAudioTrack {
  id: string
  name: string
  path: string
  importedAt: string
}

/** Aggregate root for a library track. It owns the invariant that stems belong to the track. */
export class AudioTrack {
  private constructor(private readonly props: Track) {}

  static import(props: NewAudioTrack): AudioTrack {
    return new AudioTrack({ ...props })
  }

  static restore(snapshot: Track): AudioTrack {
    return new AudioTrack({ ...snapshot, stems: snapshot.stems ? { ...snapshot.stems } : undefined })
  }

  get id() { return this.props.id }
  get name() { return this.props.name }
  get path() { return this.props.path }
  get stems() { return this.props.stems }

  attachStems(stems: Record<StemName, string>) {
    this.props.stems = { ...stems }
  }

  attachAnalysis(analysis: TrackAnalysis) {
    this.props.analysis = { ...analysis }
  }

  snapshot(): Track {
    return { ...this.props, stems: this.props.stems ? { ...this.props.stems } : undefined }
  }
}
