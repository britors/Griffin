import { randomUUID } from 'node:crypto'
import { MusicProject } from '../../shared/domain/music-project'
import type { ProjectRepository } from './ports'

export class ProjectApplicationService {
  constructor(private readonly repository: ProjectRepository) {}

  list() { return this.repository.list() }

  async create(name: string) {
    const project = MusicProject.create({ id: randomUUID(), name })
    return this.repository.save(project.snapshot())
  }

  async rename(id: string, name: string) { return this.mutate(id, (project) => project.rename(name)) }
  async addTrack(id: string, trackId: string) { return this.mutate(id, (project) => project.addTrack(trackId)) }
  async removeTrack(id: string, trackId: string) { return this.mutate(id, (project) => project.removeTrack(trackId)) }

  async remove(id: string) {
    const project = await this.repository.findById(id)
    if (!project) throw new Error('Projeto não encontrado.')
    await this.repository.remove(id)
  }

  private async mutate(id: string, change: (project: MusicProject) => void) {
    const current = await this.repository.findById(id)
    if (!current) throw new Error('Projeto não encontrado.')
    const project = MusicProject.create(current)
    change(project)
    return this.repository.save(project.snapshot())
  }
}
