import type { LibraryApplicationService } from '../../application/library-service'

export function registerLibraryHandlers(service: LibraryApplicationService) {
  return {
    list: () => service.list(),
    import: (path?: string) => service.import(path),
    read: (path: string) => service.read(path),
    remove: (id: string) => service.remove(id),
    chooseFile: () => service.import(),
  }
}
