import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectRepository } from '../../application/ports'
import type { Project } from '../../../shared/types'

export class JsonProjectRepository implements ProjectRepository {
  private get file() { return join(app.getPath('userData'), 'projects.json') }

  async init() {
    await mkdir(app.getPath('userData'), { recursive: true })
    try { await readFile(this.file, 'utf8') } catch { await writeFile(this.file, '[]') }
  }

  async list(): Promise<Project[]> { return this.read() }
  async findById(id: string): Promise<Project | null> { return (await this.read()).find((project) => project.id === id) ?? null }

  async save(project: Project): Promise<Project> {
    const projects = await this.read()
    const index = projects.findIndex((item) => item.id === project.id)
    if (index >= 0) projects[index] = project
    else projects.push(project)
    await this.write(projects)
    return project
  }

  async remove(id: string): Promise<void> { await this.write((await this.read()).filter((project) => project.id !== id)) }

  private async read(): Promise<Project[]> {
    try { return JSON.parse(await readFile(this.file, 'utf8')) as Project[] } catch { return [] }
  }
  private async write(projects: Project[]): Promise<void> { await mkdir(app.getPath('userData'), { recursive: true }); await writeFile(this.file, JSON.stringify(projects, null, 2)) }
}
