import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { ModelDownloadKind, ModelDownloadProgress, ModelDownloadStatus } from '../../shared/types'

export function useModelDownload() {
  const [status, setStatus] = useState<ModelDownloadStatus | null>(null)
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => { void api.models.status().then(setStatus) }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => api.models.onProgress((next) => {
    setProgress(next)
    if (next.progress >= 1) { setProgress(null); refresh() }
  }), [refresh])

  const download = useCallback(async (kind: ModelDownloadKind) => {
    setError(null)
    try { await api.models.download(kind) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível baixar o modelo.') } finally { setProgress(null); refresh() }
  }, [refresh])

  const cancel = useCallback((kind: ModelDownloadKind) => api.models.cancel(kind), [])

  return { status, progress, error, download, cancel, refresh }
}
