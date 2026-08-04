import { describe, expect, it } from 'vitest'
import type { Track } from '../shared/types'
import { playbackTransform, trackPlaybackSources } from './playback-sources'

const originalTrack: Track = {
  id: 'original',
  name: 'Faixa original',
  path: '/library/original.wav',
  importedAt: '2026-08-04T00:00:00.000Z',
}

describe('fontes de reprodução', () => {
  it('usa um canal original dedicado quando a faixa ainda não possui stems', () => {
    expect(trackPlaybackSources(originalTrack)).toEqual([
      { kind: 'original', path: '/library/original.wav' },
    ])
  })

  it('usa somente os stems disponíveis depois da separação', () => {
    expect(trackPlaybackSources({
      ...originalTrack,
      stems: { vocals: '/stems/vocals.wav', other: '/stems/other.wav' },
    })).toEqual([
      { kind: 'stem', stem: 'vocals', path: '/stems/vocals.wav' },
      { kind: 'stem', stem: 'other', path: '/stems/other.wav' },
    ])
  })

  it('não confunde um mapa de stems vazio com o canal other', () => {
    expect(trackPlaybackSources({ ...originalTrack, stems: {} })).toEqual([
      { kind: 'original', path: '/library/original.wav' },
    ])
  })
})

describe('transformações da faixa original', () => {
  it.each([-12, 0, 12])('preserva o pitch de %i semitons', (pitch) => {
    expect(playbackTransform(1, pitch)).toMatchObject({ pitch, tempo: 1 })
  })

  it.each([0.5, 1, 1.5])('preserva o tempo de %f', (tempo) => {
    expect(playbackTransform(tempo, 0)).toMatchObject({ pitch: 0, tempo })
  })

  it('ativa o processamento ao combinar pitch e tempo', () => {
    expect(playbackTransform(0.8, 3)).toEqual({ pitch: 3, tempo: 0.8, requiresTimeStretch: true })
  })

  it('dispensa o processamento com os controles neutros', () => {
    expect(playbackTransform(1, 0).requiresTimeStretch).toBe(false)
  })
})
