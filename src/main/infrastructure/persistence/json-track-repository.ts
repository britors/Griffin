import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { AudioTrack } from '../../../shared/domain/audio-track'
import type { Track } from '../../../shared/types'
import type { TrackRepository } from '../../application/ports'

export class JsonTrackRepository implements TrackRepository {
  private tracks: AudioTrack[] = []
  private get file() { return join(app.getPath('userData'), 'library.json') }

  async init() {
    await mkdir(app.getPath('userData'), { recursive: true })
    try {
      const snapshots = JSON.parse(await readFile(this.file, 'utf8')) as Track[]
      this.tracks = snapshots.map((snapshot) => AudioTrack.restore(snapshot))
    } catch { this.tracks = [] }
  }

  async list() { return [...this.tracks] }
  async findById(id: string) { return this.tracks.find((track) => track.id === id) ?? null }
  async findByPath(path: string) {
    const candidate = normalize(path)
    return this.tracks.find((track) => normalize(track.path) === candidate) ?? null
  }
  async save(track: AudioTrack) {
    this.tracks = [track, ...this.tracks.filter((item) => item.id !== track.id)]
    await this.persist()
    return track
  }
  async remove(id: string) { this.tracks = this.tracks.filter((track) => track.id !== id); await this.persist() }

  private async persist() { await writeFile(this.file, JSON.stringify(this.tracks.map((track) => track.snapshot()), null, 2)) }
}
