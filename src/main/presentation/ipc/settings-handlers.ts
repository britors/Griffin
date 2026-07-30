import type { SettingsRepository } from '../../application/ports'

export function registerSettingsHandlers(repository: SettingsRepository) {
  return {
    get: () => repository.get(),
    set: (key: string, value: unknown) => repository.set(key, value),
  }
}
