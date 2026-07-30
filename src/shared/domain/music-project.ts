import type { Project } from '../types'

export class MusicProject {
  private constructor(private readonly data: Project) {}

  static create(input: { id: string; name: string; createdAt?: string; updatedAt?: string; trackIds?: string[] }): MusicProject {
    const now = new Date().toISOString()
    return new MusicProject({
      id: input.id,
      name: input.name.trim() || 'Novo projeto',
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      trackIds: [...new Set(input.trackIds ?? [])],
    })
  }

  rename(name: string): void {
    const normalized = name.trim()
    if (!normalized) throw new Error('O projeto precisa ter um nome.')
    this.data.name = normalized
    this.touch()
  }

  addTrack(trackId: string): void {
    if (!this.data.trackIds.includes(trackId)) {
      this.data.trackIds.push(trackId)
      this.touch()
    }
  }

  removeTrack(trackId: string): void {
    this.data.trackIds = this.data.trackIds.filter((id) => id !== trackId)
    this.touch()
  }

  snapshot(): Project { return structuredClone(this.data) }
  private touch(): void { this.data.updatedAt = new Date().toISOString() }
}
