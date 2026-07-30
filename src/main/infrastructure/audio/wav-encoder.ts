export function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  if (left.length !== right.length) throw new Error('Os canais do WAV precisam ter o mesmo tamanho.')
  const bytesPerSample = 2
  const dataSize = left.length * 2 * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeText = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  writeText(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeText(8, 'WAVE')
  writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2 * bytesPerSample, true)
  view.setUint16(32, 2 * bytesPerSample, true); view.setUint16(34, 16, true)
  writeText(36, 'data'); view.setUint32(40, dataSize, true)
  for (let index = 0; index < left.length; index += 1) {
    view.setInt16(44 + index * 4, Math.round(clamp(left[index]) * 32767), true)
    view.setInt16(46 + index * 4, Math.round(clamp(right[index]) * 32767), true)
  }
  return new Uint8Array(buffer)
}
