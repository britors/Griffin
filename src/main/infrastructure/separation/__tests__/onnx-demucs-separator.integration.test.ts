import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AudioTrack } from '../../../../shared/domain/audio-track'
import { encodeStereoWav } from '../../audio/wav-encoder'
import { OnnxDemucsSeparator } from '../onnx-demucs-separator'

const modelsDirectory = join(process.cwd(), 'src/main/models')
const specialists = ['drums', 'bass', 'other', 'vocals'].map((stem) => join(modelsDirectory, 'htdemucs-ft', `htdemucs_ft_${stem}_fp16weights.onnx`))
const modelsAvailable = specialists.every((path) => existsSync(path))

describe.skipIf(!modelsAvailable)('OnnxDemucsSeparator integration', () => {
  it('separates a local WAV into four cached stems', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'griffin-onnx-'))
    try {
      const samples = 44100 / 2
      const left = new Float32Array(samples)
      const right = new Float32Array(samples)
      for (let index = 0; index < samples; index += 1) {
        left[index] = Math.sin(2 * Math.PI * 220 * index / 44100) * 0.1
        right[index] = left[index]
      }
      const inputPath = join(folder, 'test.wav')
      await writeFile(inputPath, encodeStereoWav(left, right, 44100))
      const separator = new OnnxDemucsSeparator(join(folder, 'cache'), modelsDirectory)
      await separator.init()
      const track = AudioTrack.import({ id: 'integration-track', name: 'test.wav', path: inputPath, importedAt: new Date().toISOString() })
      const result = await separator.separate(track, () => undefined)

      expect(Object.keys(result).sort()).toEqual(['bass', 'drums', 'other', 'vocals'])
      for (const path of Object.values(result)) expect((await readFile(path)).length).toBeGreaterThan(44)

      const cached = await separator.separate(track, () => undefined)
      expect(cached).toEqual(result)
      for (const path of Object.values(cached)) expect((await readFile(path)).length).toBeGreaterThan(44)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }, 180_000)
})
