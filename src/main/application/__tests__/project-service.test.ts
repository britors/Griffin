import { describe, expect, it } from 'vitest'
import type { Project } from '../../../shared/types'
import type { ProjectRepository } from '../ports'
import { ProjectApplicationService } from '../project-service'

class InMemoryProjectRepository implements ProjectRepository {
  projects: Project[] = []
  async init() {}
  async list() { return [...this.projects] }
  async findById(id: string) { return this.projects.find((project) => project.id === id) ?? null }
  async save(project: Project) {
    this.projects = [...this.projects.filter((item) => item.id !== project.id), project]
    return project
  }
  async remove(id: string) { this.projects = this.projects.filter((project) => project.id !== id) }
}

describe('ProjectApplicationService', () => {
  it('creates a project and keeps track membership unique', async () => {
    const service = new ProjectApplicationService(new InMemoryProjectRepository())
    const project = await service.create('Ensaios')

    await service.addTrack(project.id, 'track-1')
    await service.addTrack(project.id, 'track-1')

    expect((await service.list())[0].trackIds).toEqual(['track-1'])
  })

  it('renames and removes a project', async () => {
    const service = new ProjectApplicationService(new InMemoryProjectRepository())
    const project = await service.create('Rascunho')
    const renamed = await service.rename(project.id, 'Set ao vivo')

    expect(renamed.name).toBe('Set ao vivo')
    await service.remove(project.id)
    expect(await service.list()).toHaveLength(0)
  })

  it('reorders tracks and persists the setlist order', async () => {
    const service = new ProjectApplicationService(new InMemoryProjectRepository())
    const project = await service.create('Aula')
    await service.addTrack(project.id, 'track-1')
    await service.addTrack(project.id, 'track-2')
    await service.addTrack(project.id, 'track-3')

    const reordered = await service.moveTrack(project.id, 'track-3', 'up')

    expect(reordered.trackIds).toEqual(['track-1', 'track-3', 'track-2'])
  })

  it('creates and restores a named player snapshot without duplicating tracks', async () => {
    const service = new ProjectApplicationService(new InMemoryProjectRepository())
    const project = await service.create('Prática')
    await service.addTrack(project.id, 'track-1')
    const player = { selectedTrackId: 'track-1', position: 0.4, pitch: 2, tempo: 0.8, loopEnabled: true, loopStart: 0.2, loopEnd: 0.5, volumes: { vocals: 1, drums: 0.5, bass: 0.7, other: 0.6 }, pans: { vocals: 0, drums: -0.2, bass: 0.2, other: 0 }, routes: { vocals: 'stereo', drums: 'left', bass: 'stereo', other: 'stereo' }, equalizer: { vocals: Array(12).fill(0), drums: Array(12).fill(0), bass: Array(12).fill(0), other: Array(12).fill(0) }, muted: { vocals: false, drums: true, bass: false, other: false }, solo: null } as const

    const updated = await service.createSnapshot(project.id, 'Refrão lento', player)
    const restored = await service.restoreSnapshot(project.id, updated.snapshots![0].id)

    expect(restored.name).toBe('Refrão lento')
    expect(restored.trackIds).toEqual(['track-1'])
    expect(restored.player.tempo).toBe(0.8)
  })
})
