import type { SettingsRepository } from '../../application/ports'

export function registerSettingsHandlers(repository: SettingsRepository, onChange?: (key: string, value: unknown) => void) {
  return {
    get: () => repository.get(),
    set: async (key: string, value: unknown) => { await repository.set(key, value); onChange?.(key, value) },
  }
}
