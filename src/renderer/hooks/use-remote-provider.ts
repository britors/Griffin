import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { RemoteSeparationStatus } from '../../shared/types'

export function useRemoteProvider() {
  const [status, setStatus] = useState<RemoteSeparationStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => { void api.remoteProvider.status().then(setStatus) }, [])

  useEffect(() => { refresh() }, [refresh])

  const saveApiKey = useCallback(async (key: string) => {
    setError(null)
    try { setStatus(await api.remoteProvider.saveApiKey(key)) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a chave.') }
  }, [])

  const clearApiKey = useCallback(async () => {
    setError(null)
    try { setStatus(await api.remoteProvider.clearApiKey()) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível remover a chave.') }
  }, [])

  const estimateCost = useCallback((trackId: string) => api.remoteProvider.estimateCost(trackId), [])

  return { status, error, saveApiKey, clearApiKey, estimateCost, refresh }
}
