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

  const runInstallation = useCallback(async (update: boolean) => {
    if (installing) return
    setError(null)
    setInstalling(true)
    try {
      if (update) await api.cudaRuntime.update()
      else await api.cudaRuntime.install()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível instalar o suporte NVIDIA.'
      if (!message.includes('pausado.')) setError(message)
    } finally {
      setInstalling(false)
      setProgress(null)
      refresh()
    }
  }, [installing, refresh])

  const install = useCallback(() => runInstallation(false), [runInstallation])
  const update = useCallback(() => runInstallation(true), [runInstallation])

  const cancel = useCallback(() => api.cudaRuntime.cancel(), [])
  const pause = useCallback(async () => { await api.cudaRuntime.pause(); refresh() }, [refresh])

  return { status, progress, error, installing, install, update, cancel, pause, refresh }
}
