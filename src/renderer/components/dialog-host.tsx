import { useEffect, useState } from 'react'
import { useDialogStore } from './dialog-store'

export function DialogHost() {
  const request = useDialogStore((state) => state.request)
  const resolve = useDialogStore((state) => state.resolve)
  const [inputValue, setInputValue] = useState('')
  useEffect(() => { setInputValue(request?.defaultValue ?? '') }, [request])
  if (!request) return null

  const respond = (value: boolean | string | null) => {
    resolve?.(value)
    useDialogStore.setState({ request: null, resolve: null })
  }

  const cancel = () => respond(request.kind === 'prompt' ? null : false)
  const confirm = () => respond(request.kind === 'prompt' ? inputValue : true)

  return <div className="app-dialog-overlay" onClick={cancel}>
    <div className={`app-dialog-card ${request.tone === 'danger' ? 'danger' : ''}`} onClick={(event) => event.stopPropagation()}>
      <p>{request.message}</p>
      {request.kind === 'prompt' && <input autoFocus aria-label={request.inputLabel ?? 'Nome'} placeholder={request.placeholder} value={inputValue} onChange={(event) => setInputValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') confirm(); if (event.key === 'Escape') cancel() }} />}
      <div className="app-dialog-actions">
        {request.kind !== 'alert' && <button className="secondary-button" onClick={cancel}>{request.cancelLabel ?? 'Cancelar'}</button>}
        <button className={request.tone === 'danger' ? 'danger-button' : 'primary-button'} onClick={confirm}>{request.confirmLabel ?? (request.kind === 'prompt' ? 'Confirmar' : 'OK')}</button>
      </div>
    </div>
  </div>
}
