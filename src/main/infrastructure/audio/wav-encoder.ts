export function encodeStereoWav(left: Float32Array, right: Float32Array, sampleRate: number, bitDepth: 16 | 24 = 16): Uint8Array {
  if (left.length !== right.length) throw new Error('Os canais do WAV precisam ter o mesmo tamanho.')
  const bytesPerSample = bitDepth / 8
  const dataSize = left.length * 2 * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const writeText = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  const clamp = (value: number) => Math.max(-1, Math.min(1, value))
  writeText(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); writeText(8, 'WAVE')
  writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2 * bytesPerSample, true)
  view.setUint16(32, 2 * bytesPerSample, true); view.setUint16(34, bitDepth, true)
  writeText(36, 'data'); view.setUint32(40, dataSize, true)
  for (let index = 0; index < left.length; index += 1) {
    const offset = 44 + index * bytesPerSample * 2
    writePcm(view, offset, clamp(left[index]), bitDepth)
    writePcm(view, offset + bytesPerSample, clamp(right[index]), bitDepth)
  }
  return new Uint8Array(buffer)
}

function writePcm(view: DataView, offset: number, value: number, bitDepth: 16 | 24) {
  const max = 2 ** (bitDepth - 1) - 1
  let sample = Math.round(value * max)
  if (sample < 0) sample += 2 ** bitDepth
  for (let byte = 0; byte < bitDepth / 8; byte += 1) view.setUint8(offset + byte, (sample >> (byte * 8)) & 0xff)
}
