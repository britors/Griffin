import { describe, expect, it } from 'vitest'
import type { AudioRecordingDestination } from '../ports'
import { PerformanceApplicationService } from '../performance-service'

class FixedDestination implements AudioRecordingDestination {
  written: Uint8Array | null = null
  async choose() { return '/takes/song.webm' }
  async write(_path: string, bytes: Uint8Array) { this.written = bytes }
}

describe('PerformanceApplicationService', () => {
  it('saves a non-empty take to a chosen destination', async () => {
    const destination = new FixedDestination()
    const service = new PerformanceApplicationService(destination)
    const result = await service.save('Song: take', new Uint8Array([1, 2, 3]))

    expect(result).toEqual({ path: '/takes/song.webm', name: 'Song- take' })
    expect(destination.written).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('rejects empty recordings', async () => {
    const service = new PerformanceApplicationService(new FixedDestination())
    await expect(service.save('empty', new Uint8Array())).rejects.toThrow('não contém áudio')
  })
})
