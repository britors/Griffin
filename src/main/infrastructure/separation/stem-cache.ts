import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CORE_STEMS, type StemName } from '../../../shared/types'

export async function hashAudioFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export class FileStemCache {
  constructor(private readonly root: string) {}

  async init() { await mkdir(this.root, { recursive: true }) }
  directory(key: string) { return join(this.root, key) }

  async get(key: string, stemNames: StemName[] = CORE_STEMS): Promise<Partial<Record<StemName, string>> | null> {
    try {
      const names = await readdir(this.directory(key))
      if (!stemNames.every((stem) => names.includes(`${stem}.wav`))) return null
      return Object.fromEntries(stemNames.map((stem) => [stem, join(this.directory(key), `${stem}.wav`)])) as Record<StemName, string>
    } catch { return null }
  }

  async write(key: string, stems: Partial<Record<StemName, Uint8Array>>, stemNames: StemName[] = CORE_STEMS) {
    const folder = this.directory(key)
    await mkdir(folder, { recursive: true })
    for (const stem of stemNames) await writeFile(join(folder, `${stem}.wav`), stems[stem]!)
  }

  paths(key: string, stemNames: StemName[] = CORE_STEMS): Partial<Record<StemName, string>> {
    return Object.fromEntries(stemNames.map((stem) => [stem, join(this.directory(key), `${stem}.wav`)])) as Record<StemName, string>
  }

  async clear(key: string) { await rm(this.directory(key), { recursive: true, force: true }) }
}
