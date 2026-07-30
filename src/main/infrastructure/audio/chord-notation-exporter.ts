import type { ChordEvent, ChordExportFormat } from '../../../shared/types'
import type { ChordNotationExporter } from '../../application/ports'

const notes: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }

export class ChordNotationExportService implements ChordNotationExporter {
  render(chords: ChordEvent[], bpm: number, duration: number, format: ChordExportFormat) {
    return format === 'midi' ? renderMidi(chords, bpm, duration) : renderPdf(chords, duration)
  }
}

function renderMidi(chords: ChordEvent[], bpm: number, duration: number): Uint8Array {
  const ticksPerBeat = 480
  const ticksPerSecond = ticksPerBeat * bpm / 60
  const events: Array<{ tick: number; bytes: number[]; order: number }> = [{ tick: 0, bytes: [0xff, 0x51, 0x03, ...numberBytes(Math.round(60_000_000 / bpm), 3)], order: 0 }]
  for (const chord of chords) {
    const tones = chordTones(chord.name)
    const start = Math.max(0, Math.round(chord.start * duration * ticksPerSecond))
    const end = Math.max(start + 1, Math.round(chord.end * duration * ticksPerSecond))
    tones.forEach((tone) => { events.push({ tick: start, bytes: [0x90, tone, 88], order: 1 }); events.push({ tick: end, bytes: [0x80, tone, 0], order: 0 }) })
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const track: number[] = []
  let previous = 0
  for (const event of events) { track.push(...variableLength(event.tick - previous), ...event.bytes); previous = event.tick }
  track.push(0, 0xff, 0x2f, 0)
  return bytes([...ascii('MThd'), ...numberBytes(6, 4), 0, 0, 0, 1, ...numberBytes(ticksPerBeat, 2), ...ascii('MTrk'), ...numberBytes(track.length, 4), ...track])
}

function renderPdf(chords: ChordEvent[], duration: number): Uint8Array {
  const lines = ['Griffin Music — Acordes', '', `Duração: ${duration.toFixed(1)} s`, '', ...chords.map((chord) => `${formatTime(chord.start * duration)}  ${chord.name}  ${formatTime(chord.end * duration)}`)]
  const content = `BT /F1 14 Tf 50 760 Td (${escapePdf(lines[0])}) Tj /F1 10 Tf 0 -24 Td ${lines.slice(1).map((line) => `(${escapePdf(line)}) Tj 0 -16 Td`).join(' ')} ET`
  const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = pdf.length; pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(pdf)
}

function chordTones(name: string) {
  const match = name.match(/^([A-G](?:#|b)?)(?:\s+(maior|menor))?/i)
  const root = notes[match?.[1] ?? 'C'] ?? 0
  const minor = match?.[2]?.toLowerCase() === 'menor'
  return [root + 48, root + (minor ? 51 : 52), root + 55]
}
function numberBytes(value: number, length: number) { return Array.from({ length }, (_item, index) => (value >> ((length - index - 1) * 8)) & 0xff) }
function variableLength(value: number) { const bytes = [value & 0x7f]; while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80); return bytes }
function ascii(value: string) { return [...value].map((char) => char.charCodeAt(0)) }
function bytes(values: number[]) { return new Uint8Array(values) }
function escapePdf(value: string) { return value.replace(/[\\()]/g, '\\$&') }
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }
