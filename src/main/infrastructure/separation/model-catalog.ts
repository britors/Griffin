import { join } from 'node:path'
import { CORE_STEMS, type StemName } from '../../../shared/types'

const baseUrl = 'https://huggingface.co/StemSplitio'

export interface ModelFile { path: string; url: string }

export function specialistPath(modelsDir: string, stem: StemName) { return join(modelsDir, 'htdemucs-ft', `htdemucs_ft_${stem}_fp16weights.onnx`) }
export function singlePath(modelsDir: string) { return join(modelsDir, 'htdemucs.onnx') }
export function sixStemPath(modelsDir: string) { return join(modelsDir, 'htdemucs_6s.onnx') }

export function standardModelFiles(modelsDir: string): ModelFile[] {
  return [
    { path: singlePath(modelsDir), url: `${baseUrl}/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx` },
    ...CORE_STEMS.map((stem) => ({ path: specialistPath(modelsDir, stem), url: `${baseUrl}/htdemucs-ft-${stem}-onnx/resolve/main/htdemucs_ft_${stem}_fp16weights.onnx` })),
  ]
}

export function extendedModelFiles(modelsDir: string): ModelFile[] {
  return [{ path: sixStemPath(modelsDir), url: `${baseUrl}/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx` }]
}
