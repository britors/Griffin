import { access, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { ModelDownloader } from '../../application/ports'
import type { ModelDownloadKind, ModelDownloadProgress, ModelDownloadStatus } from '../../../shared/types'
import { extendedModelFiles, standardModelFiles, type ModelFile } from '../separation/model-catalog'

export class ElectronModelDownloader implements ModelDownloader {
  constructor(private readonly modelsDirectory: string) {}

  async status(): Promise<ModelDownloadStatus> {
    const [standardInstalled, extendedInstalled] = await Promise.all([
      allExist(standardModelFiles(this.modelsDirectory)),
      allExist(extendedModelFiles(this.modelsDirectory)),
    ])
    return { standardInstalled, extendedInstalled, downloading: null }
  }

  async download(kind: ModelDownloadKind, report: (progress: ModelDownloadProgress) => void, signal: AbortSignal) {
    const pending = await filterMissing(kind === 'standard' ? standardModelFiles(this.modelsDirectory) : extendedModelFiles(this.modelsDirectory))
    const total = pending.length
    if (total === 0) { report({ kind, progress: 1, stage: 'Modelo já instalado' }); return }
    for (let index = 0; index < total; index += 1) {
      if (signal.aborted) throw new Error('Download cancelado.')
      await downloadFile(pending[index], kind, index, total, report, signal)
    }
    report({ kind, progress: 1, stage: 'Modelo instalado' })
  }
}

async function filterMissing(files: ModelFile[]) {
  const flags = await Promise.all(files.map((file) => fileExists(file.path)))
  return files.filter((_, index) => !flags[index])
}

async function allExist(files: ModelFile[]) {
  const flags = await Promise.all(files.map((file) => fileExists(file.path)))
  return flags.every(Boolean)
}

async function fileExists(path: string) { return access(path).then(() => true).catch(() => false) }

async function downloadFile(file: ModelFile, kind: ModelDownloadKind, index: number, total: number, report: (progress: ModelDownloadProgress) => void, signal: AbortSignal) {
  await mkdir(dirname(file.path), { recursive: true })
  const partPath = `${file.path}.part`
  const stage = (suffix: string) => `Baixando ${basename(file.path)} (${index + 1}/${total})${suffix}`
  report({ kind, progress: index / total, stage: stage('') })
  const response = await fetch(file.url, { signal, redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Falha ao baixar ${basename(file.path)}: HTTP ${response.status}.`)
  const expected = Number(response.headers.get('content-length') ?? 0)
  const handle = await open(partPath, 'w')
  let received = 0
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.byteLength
      await handle.write(chunk)
      const fileFraction = expected > 0 ? Math.min(1, received / expected) : 0
      report({ kind, progress: (index + fileFraction) / total, stage: stage(expected > 0 ? ` · ${Math.round(fileFraction * 100)}%` : '') })
    }
  } finally {
    await handle.close()
  }
  if (expected > 0 && received < expected) throw new Error(`Download incompleto de ${basename(file.path)}.`)
  await rename(partPath, file.path)
  await unlink(partPath).catch(() => {})
}
