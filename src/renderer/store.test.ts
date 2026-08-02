import { beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '../shared/types'
import { addRecentTrack, usePlayer } from './store'

const tracks: Track[] = [
  { id: 'first', name: 'Primeira', path: '/audio/first.wav', importedAt: '2026-07-30T00:00:00.000Z' },
  { id: 'second', name: 'Segunda', path: '/audio/second.wav', importedAt: '2026-07-30T00:00:00.000Z' },
]

describe('preferência de reprodução ao trocar de faixa', () => {
  beforeEach(() => {
    usePlayer.setState({ tracks, selected: tracks[0], playing: false, position: 0, resetPlaybackOnTrackChange: true })
  })

  it('reinicia a posição quando a preferência está ativa', () => {
    usePlayer.getState().setPosition(0.42)
    usePlayer.getState().select(tracks[1])

    expect(usePlayer.getState().position).toBe(0)
    expect(usePlayer.getState().playing).toBe(false)
  })

  it('preserva a posição quando a preferência está desativada', () => {
    usePlayer.getState().setResetPlaybackOnTrackChange(false)
    usePlayer.getState().setPosition(0.42)
    usePlayer.getState().select(tracks[1])

    expect(usePlayer.getState().position).toBe(0.42)
    expect(usePlayer.getState().playing).toBe(false)
  })
})

describe('organização da biblioteca', () => {
  it('alterna uma faixa favorita sem duplicar entradas', () => {
    usePlayer.setState({ favoriteIds: [] })
    usePlayer.getState().toggleFavorite('first')
    expect(usePlayer.getState().favoriteIds).toEqual(['first'])

    usePlayer.getState().toggleFavorite('first')
    expect(usePlayer.getState().favoriteIds).toEqual([])
  })

  it('move a faixa acessada para o início e limita o histórico', () => {
    const history = addRecentTrack(['second', 'third', 'first'], 'first', 3)

    expect(history).toEqual(['first', 'second', 'third'])
  })
})

describe('repetição do loop', () => {
  it('registra cada volta para os modos de prática', () => {
    usePlayer.setState({ loopIteration: 0 })

    usePlayer.getState().notifyLoopIteration()
    usePlayer.getState().notifyLoopIteration()

    expect(usePlayer.getState().loopIteration).toBe(2)
  })
})
