import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalResourcesApplicationService } from '../local-resources-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('LocalResourcesApplicationService', () => {
  it('reports usage and clears only the stem cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'griffin-resources-'))
    temporaryDirectories.push(root)
    const cache = join(root, 'stems')
    const models = join(root, 'models')
    await mkdir(cache, { recursive: true })
    await mkdir(models, { recursive: true })
    await writeFile(join(cache, 'vocals.wav'), new Uint8Array([1, 2, 3]))
    await writeFile(join(models, 'htdemucs.onnx'), new Uint8Array([4, 5]))
    const service = new LocalResourcesApplicationService(cache, models)

    const before = await service.summary()
    expect(before.cacheBytes).toBe(3)
    expect(before.modelBytes).toBe(2)

    await service.clearCache()

    expect((await service.summary()).cacheBytes).toBe(0)
    expect(Array.from(await readFile(join(models, 'htdemucs.onnx')))).toEqual([4, 5])
  })
})
