import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LocalResourcesSummary } from '../../shared/types'

export class LocalResourcesApplicationService {
  constructor(private readonly cachePath: string, private readonly modelPath: string) {}

  async summary(): Promise<LocalResourcesSummary> {
    const [cacheBytes, modelBytes] = await Promise.all([directorySize(this.cachePath), directorySize(this.modelPath)])
    return { cachePath: this.cachePath, cacheBytes, modelPath: this.modelPath, modelBytes }
  }

  async clearCache() {
    await rm(this.cachePath, { recursive: true, force: true })
    await mkdir(this.cachePath, { recursive: true })
    return this.summary()
  }
}

async function directorySize(path: string): Promise<number> {
  let entries
  try { entries = await readdir(path, { withFileTypes: true }) } catch { return 0 }
  const sizes = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) return directorySize(entryPath)
    try { return (await stat(entryPath)).size } catch { return 0 }
  }))
  return sizes.reduce((total, size) => total + size, 0)
}
