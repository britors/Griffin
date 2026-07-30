import type { ProjectApplicationService } from '../../application/project-service'

export function registerProjectHandlers(service: ProjectApplicationService) {
  return {
    list: () => service.list(),
    create: (_event: unknown, name: string) => service.create(name),
    rename: (_event: unknown, id: string, name: string) => service.rename(id, name),
    remove: (_event: unknown, id: string) => service.remove(id),
    addTrack: (_event: unknown, projectId: string, trackId: string) => service.addTrack(projectId, trackId),
    removeTrack: (_event: unknown, projectId: string, trackId: string) => service.removeTrack(projectId, trackId),
    moveTrack: (_event: unknown, projectId: string, trackId: string, direction: 'up' | 'down') => service.moveTrack(projectId, trackId, direction),
  }
}
