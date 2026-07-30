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

  moveTrack(trackId: string, direction: 'up' | 'down'): void {
    const index = this.data.trackIds.indexOf(trackId)
    if (index < 0) throw new Error('A faixa não pertence a este projeto.')
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= this.data.trackIds.length) return
    const [item] = this.data.trackIds.splice(index, 1)
    this.data.trackIds.splice(target, 0, item)
    this.touch()
  }

  snapshot(): Project { return structuredClone(this.data) }
  private touch(): void { this.data.updatedAt = new Date().toISOString() }
}
