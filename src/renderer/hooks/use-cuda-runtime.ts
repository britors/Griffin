import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { CudaRuntimeProgress, CudaRuntimeStatus } from '../../shared/types'

export function useCudaRuntime() {
  const [status, setStatus] = useState<CudaRuntimeStatus | null>(null)
  const [progress, setProgress] = useState<CudaRuntimeProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)

  const refresh = useCallback(() => { void api.cudaRuntime.status().then(setStatus) }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => api.cudaRuntime.onProgress((next) => {
    setProgress(next.progress >= 1 ? null : next)
    if (next.progress >= 1) refresh()
  }), [refresh])

  const install = useCallback(async () => {
    if (installing) return
    setError(null)
    setInstalling(true)
    try { await api.cudaRuntime.install() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível instalar o suporte NVIDIA.') } finally { setInstalling(false); setProgress(null); refresh() }
  }, [installing, refresh])

  const cancel = useCallback(() => api.cudaRuntime.cancel(), [])

  return { status, progress, error, installing, install, cancel, refresh }
}
