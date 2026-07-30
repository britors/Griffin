export interface DecodedAudio {
  channelData: Float32Array[]
  sampleRate: number
}

export class AudioFileDecoder {
  async decode(bytes: Uint8Array): Promise<DecodedAudio> {
    const module = await import('audio-decode')
    return module.default(bytes)
  }
}
