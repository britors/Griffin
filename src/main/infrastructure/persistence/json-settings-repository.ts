import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingsRepository } from '../../application/ports'

export class JsonSettingsRepository implements SettingsRepository {
  private get file() { return join(app.getPath('userData'), 'settings.json') }

  async get() {
    try { return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, unknown> } catch { return {} }
  }

  async set(key: string, value: unknown) {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.file, JSON.stringify({ ...(await this.get()), [key]: value }, null, 2))
  }
}
