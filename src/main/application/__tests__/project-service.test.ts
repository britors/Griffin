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
})
