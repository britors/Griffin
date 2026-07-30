import type { PerformanceApplicationService } from '../../application/performance-service'

export function registerPerformanceHandlers(service: PerformanceApplicationService) {
  return { save: (_event: unknown, name: string, bytes: Uint8Array) => service.save(name, bytes) }
}
