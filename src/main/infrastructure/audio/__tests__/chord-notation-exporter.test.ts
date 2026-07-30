import { describe, expect, it } from 'vitest'
import { ChordNotationExportService } from '../chord-notation-exporter'

const chords = [{ id: '1', name: 'C maior', start: 0, end: 0.5, confidence: 0.9 }, { id: '2', name: 'A menor', start: 0.5, end: 1, confidence: 0.9 }]

describe('ChordNotationExportService', () => {
  const exporter = new ChordNotationExportService()

  it('renders a standard MIDI file with the detected chord events', () => {
    const bytes = exporter.render(chords, 120, 60, 'midi')
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('MThd')
    expect(new TextDecoder().decode(bytes.slice(14, 18))).toBe('MTrk')
  })

  it('renders a readable PDF document', () => {
    const bytes = exporter.render(chords, 120, 60, 'pdf')
    const text = new TextDecoder().decode(bytes)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text).toContain('C maior')
    expect(text).toContain('A menor')
  })
})
