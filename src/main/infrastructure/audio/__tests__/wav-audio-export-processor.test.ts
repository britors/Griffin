import { describe, expect, it } from 'vitest'
import type { AudioExportOptions, StemName } from '../../../../shared/types'
import type { AudioDecoder, AudioFileGateway } from '../../../application/ports'
import { WavAudioExportProcessor } from '../wav-audio-export-processor'

class FixedFiles implements AudioFileGateway {
  isSupported() { return true }
  async describe() { return { name: 'stem.wav' } }
  async read() { return new Uint8Array([1]) }
}

class FixedDecoder implements AudioDecoder {
  async decode() {
    const left = new Float32Array(8820)
    const right = new Float32Array(8820)
    for (let index = 0; index < left.length; index += 1) {
      left[index] = Math.sin(index / 15) * 0.2
      right[index] = left[index]
    }
    return { channelData: [left, right], sampleRate: 44100 }
  }
}

const options: AudioExportOptions = {
  stems: ['vocals'],
  volumes: { vocals: 1, drums: 0, bass: 0, other: 0 },
  pans: { vocals: 0, drums: 0, bass: 0, other: 0 },
  routes: { vocals: 'stereo', drums: 'stereo', bass: 'stereo', other: 'stereo' },
  equalizer: { vocals: Array(12).fill(0), drums: Array(12).fill(0), bass: Array(12).fill(0), other: Array(12).fill(0) },
  sampleRate: 44100,
  bitDepth: 16,
  muted: { vocals: false, drums: false, bass: false, other: false },
  solo: null,
  pitch: 0,
  tempo: 1,
  format: 'wav',
}

describe('WavAudioExportProcessor', () => {
  it('renders a stereo WAV with the source duration', async () => {
    const processor = new WavAudioExportProcessor(new FixedFiles(), new FixedDecoder())
    const result = await processor.render({ vocals: '/stems/vocals.wav' } as Record<StemName, string>, options, () => {}, () => false)

    expect(result.bytes.slice(0, 4)).toEqual(new Uint8Array([82, 73, 70, 70]))
    expect(result.duration).toBeCloseTo(0.2, 2)
  })

  it('changes the rendered duration when tempo changes', async () => {
    const processor = new WavAudioExportProcessor(new FixedFiles(), new FixedDecoder())
    const result = await processor.render({ vocals: '/stems/vocals.wav' } as Record<StemName, string>, { ...options, tempo: 0.5 }, () => {}, () => false)

    expect(result.duration).toBeGreaterThan(0.3)
    expect(result.duration).toBeLessThan(0.5)
  })
})
