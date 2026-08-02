import { useEffect, useState } from 'react'
import { api } from '../api'
import type { RemoteAudioPreview, Track } from '../../shared/types'
import { alertDialog, confirmDialog } from './dialog-store'

export function RemoteImport({ activeProjectId, onTracksChanged }: { activeProjectId: string | null; onTracksChanged: (tracks: Track[]) => void }) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<RemoteAudioPreview | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => { if (preview) void api.library.cancelRemoteImport(preview.id) }, [preview])

  const requestPreview = async () => {
    setWorking(true); setError(null); setPreview(null); setAuthorized(false)
    try { setPreview(await api.library.previewUrl(url.trim())) } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível baixar a faixa.'
      setError(message)
      if (await confirmDialog(`${message}\n\nDeseja tentar baixar a faixa novamente?`, { confirmLabel: 'Tentar novamente' })) await requestPreview()
    } finally { setWorking(false) }
  }

  const importAudio = async (candidate = preview) => {
    if (!candidate || !authorized) return
    setWorking(true); setError(null)
    try {
      const track = await api.library.importUrl(candidate.id)
      if (activeProjectId) await api.projects.addTrack(activeProjectId, track.id)
      onTracksChanged(await api.library.list())
      setPreview(null); setUrl(''); setAuthorized(false)
      await alertDialog(`A faixa “${track.name}” foi baixada e adicionada à biblioteca.`)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível baixar a faixa.'
      setError(message)
      if (await confirmDialog(`${message}\n\nDeseja tentar baixar a faixa novamente?`, { confirmLabel: 'Tentar novamente' })) {
        try {
          const refreshed = await api.library.previewUrl(candidate.url)
          setPreview(refreshed)
          await importAudio(refreshed)
        } catch (retryReason) {
          setError(retryReason instanceof Error ? retryReason.message : 'Não foi possível baixar a faixa.')
        }
      }
    } finally { setWorking(false) }
  }

  const cancel = async () => { if (preview) await api.library.cancelRemoteImport(preview.id); setPreview(null) }

  return <section className="panel remote-import-panel"><div className="section-heading"><div><span className="eyebrow">FONTE AUTORIZADA</span><h2>Importar por URL</h2></div><span className="badge">LOCAL</span></div><p className="remote-import-help">Baixe somente áudio que você possui ou tem autorização para usar. O arquivo será convertido pelo pipeline local do Griffin.</p><div className="remote-import-form"><input aria-label="URL de áudio" placeholder="https://exemplo.com/faixa.wav" value={url} onChange={(event) => setUrl(event.target.value)} disabled={working || Boolean(preview)} /><button className="secondary-button" disabled={working || !url.trim() || Boolean(preview)} onClick={() => void requestPreview()}>{working ? 'Consultando…' : 'Pré-visualizar'}</button></div>{preview && <div className="remote-preview"><strong>{preview.fileName}</strong><span>{preview.format.toUpperCase()} · {formatBytes(preview.sizeBytes)}{preview.duration ? ` · ${formatDuration(preview.duration)}` : ''}</span><label><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /> Confirmo que tenho os direitos ou autorização para importar este áudio.</label><div><button className="primary-button" disabled={working || !authorized} onClick={() => void importAudio()}>Importar para a biblioteca</button><button className="text-button" disabled={working} onClick={() => void cancel()}>Cancelar</button></div></div>}{error && <small className="export-error">{error}</small>}</section>
}

function formatBytes(bytes: number) { return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB` }
function formatDuration(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }
