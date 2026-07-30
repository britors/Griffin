import type { PlayerSnapshot, Project, ProjectSnapshot } from '../types'

export class MusicProject {
  private constructor(private readonly data: Project) {}

  static create(input: { id: string; name: string; createdAt?: string; updatedAt?: string; trackIds?: string[]; snapshots?: ProjectSnapshot[]; playerState?: PlayerSnapshot }): MusicProject {
    const now = new Date().toISOString()
    return new MusicProject({
      id: input.id,
      name: input.name.trim() || 'Novo projeto',
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      trackIds: [...new Set(input.trackIds ?? [])],
      snapshots: input.snapshots?.map((snapshot) => structuredClone(snapshot)) ?? [],
      playerState: input.playerState ? structuredClone(input.playerState) : undefined,
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

  addSnapshot(snapshot: ProjectSnapshot): void {
    this.data.snapshots = [snapshot, ...(this.data.snapshots ?? []).filter((item) => item.id !== snapshot.id)]
    this.touch()
  }

  removeSnapshot(snapshotId: string): void {
    this.data.snapshots = (this.data.snapshots ?? []).filter((snapshot) => snapshot.id !== snapshotId)
    this.touch()
  }

  updatePlayerState(player: PlayerSnapshot): void {
    this.data.playerState = structuredClone(player)
    this.touch()
  }

  createSnapshot(input: { id: string; name: string; player: PlayerSnapshot }): ProjectSnapshot {
    const name = input.name.trim()
    if (!name) throw new Error('O snapshot precisa ter um nome.')
    return { id: input.id, name, createdAt: new Date().toISOString(), trackIds: [...this.data.trackIds], player: structuredClone(input.player) }
  }

  snapshot(): Project { return structuredClone(this.data) }
  private touch(): void { this.data.updatedAt = new Date().toISOString() }
}
