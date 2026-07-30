import type { DecodedAudio } from './audio-file-decoder'

const targetSampleRate = 44100

export function resampleTo44100(audio: DecodedAudio): DecodedAudio { return resampleTo(audio, targetSampleRate) }

export function resampleTo(audio: DecodedAudio, targetRate: number): DecodedAudio {
  if (audio.sampleRate === targetRate) return audio
  const targetLength = Math.max(1, Math.round(audio.channelData[0].length * targetRate / audio.sampleRate))
  const channelData = audio.channelData.map((channel) => {
    const result = new Float32Array(targetLength)
    const ratio = (channel.length - 1) / Math.max(1, targetLength - 1)
    for (let index = 0; index < targetLength; index += 1) {
      const sourcePosition = index * ratio
      const lower = Math.floor(sourcePosition)
      const upper = Math.min(channel.length - 1, lower + 1)
      const fraction = sourcePosition - lower
      result[index] = channel[lower] * (1 - fraction) + channel[upper] * fraction
    }
    return result
  })
  return { channelData, sampleRate: targetRate }
}

export function toStereo(audio: DecodedAudio): [Float32Array, Float32Array] {
  const first = audio.channelData[0] ?? new Float32Array()
  const second = audio.channelData[1] ?? first
  return [first, second]
}
