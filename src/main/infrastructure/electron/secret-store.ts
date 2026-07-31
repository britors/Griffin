import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SecretStore } from '../../application/ports'

export class ElectronSecretStore implements SecretStore {
  private readonly file = join(app.getPath('userData'), 'secrets.json')

  isAvailable() { return safeStorage.isEncryptionAvailable() }

  async get(key: string) {
    const stored = (await this.read())[key]
    if (!stored) return null
    if (!this.isAvailable()) return stored
    try { return safeStorage.decryptString(Buffer.from(stored, 'base64')) } catch { return null }
  }

  async set(key: string, value: string) {
    const encoded = this.isAvailable() ? safeStorage.encryptString(value).toString('base64') : value
    const secrets = await this.read()
    secrets[key] = encoded
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.file, JSON.stringify(secrets, null, 2))
  }

  async remove(key: string) {
    const secrets = await this.read()
    delete secrets[key]
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.file, JSON.stringify(secrets, null, 2))
  }

  private async read(): Promise<Record<string, string>> {
    try { return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, string> } catch { return {} }
  }
}
