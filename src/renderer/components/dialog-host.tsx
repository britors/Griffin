import { useDialogStore } from './dialog-store'

export function DialogHost() {
  const request = useDialogStore((state) => state.request)
  const resolve = useDialogStore((state) => state.resolve)
  if (!request) return null

  const respond = (value: boolean) => {
    resolve?.(value)
    useDialogStore.setState({ request: null, resolve: null })
  }

  return <div className="app-dialog-overlay" onClick={() => respond(false)}>
    <div className={`app-dialog-card ${request.tone === 'danger' ? 'danger' : ''}`} onClick={(event) => event.stopPropagation()}>
      <p>{request.message}</p>
      <div className="app-dialog-actions">
        {request.kind === 'confirm' && <button className="secondary-button" onClick={() => respond(false)}>{request.cancelLabel ?? 'Cancelar'}</button>}
        <button className={request.tone === 'danger' ? 'danger-button' : 'primary-button'} onClick={() => respond(true)}>{request.confirmLabel ?? 'OK'}</button>
      </div>
    </div>
  </div>
}
