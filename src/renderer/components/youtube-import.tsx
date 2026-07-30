import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Track, YoutubeAudioPreview, YoutubeImportProgress } from '../../shared/types'

export function YoutubeImport({ activeProjectId, onTracksChanged }: { activeProjectId: string | null; onTracksChanged: (tracks: Track[]) => void }) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<YoutubeAudioPreview | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [progress, setProgress] = useState<YoutubeImportProgress | null>(null)
  useEffect(() => api.library.onYoutubeProgress(setProgress), [])
  useEffect(() => () => { if (preview) void api.library.youtubeCancel(preview.id) }, [preview])
  const inspect = async () => { setWorking(true); setError(null); setSuccess(null); setProgress({ id: '', progress: 0.08, stage: 'downloading', message: 'Consultando vídeo…' }); setPreview(null); setAuthorized(false); try { setPreview(await api.library.youtubePreview(url.trim())) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível consultar o YouTube.') } finally { setWorking(false); setProgress(null) } }
  const importAudio = async () => {
    if (!preview || !authorized) return
    setWorking(true); setError(null); setSuccess(null); setProgress({ id: preview.id, progress: 0.02, stage: 'downloading', message: 'Preparando download…' })
    try { const track = await api.library.youtubeImport(preview.id); if (activeProjectId) await api.projects.addTrack(activeProjectId, track.id); onTracksChanged(await api.library.list()); setPreview(null); setUrl(''); setAuthorized(false); setProgress(null); setSuccess(`“${track.name}” foi importada para a biblioteca.`) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar o vídeo.') } finally { setWorking(false) }
  }
  const cancel = async () => { if (preview) await api.library.youtubeCancel(preview.id); setPreview(null) }
  return <section className="panel remote-import-panel youtube-panel"><div className="section-heading"><div><span className="eyebrow">CONTEÚDO AUTORIZADO</span><h2>Importar do YouTube</h2></div><span className="badge">OPCIONAL</span></div><p className="remote-import-help">Somente vídeos próprios, Creative Commons ou com autorização. O Griffin não contorna DRM, playlists ou restrições técnicas; a função depende do <code>yt-dlp</code> instalado separadamente.</p><div className="remote-import-form"><input aria-label="URL do YouTube" placeholder="https://www.youtube.com/watch?v=..." value={url} onChange={(event) => setUrl(event.target.value)} disabled={working || Boolean(preview)} /><button className="secondary-button" disabled={working || !url.trim() || Boolean(preview)} onClick={() => void inspect()}>{working ? 'Consultando…' : 'Consultar vídeo'}</button></div>{working && progress && <div className="youtube-progress" role="status" aria-live="polite"><div className="youtube-progress-track"><span style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div><div className="youtube-progress-meta"><span>{progress.message}</span><strong>{Math.round(progress.progress * 100)}%</strong></div></div>}{preview && <div className="remote-preview"><strong>{preview.title}</strong><span>Conversão local para WAV{preview.duration ? ` · ${formatDuration(preview.duration)}` : ''}</span><label><input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} /> Confirmo que possuo os direitos ou autorização para baixar este conteúdo.</label><div><button className="primary-button" disabled={working || !authorized} onClick={() => void importAudio()}>{working ? 'Baixando e importando…' : 'Baixar e importar'}</button><button className="text-button" disabled={working} onClick={() => void cancel()}>Cancelar</button></div></div>}{success && <small className="export-success">{success}</small>}{error && <small className="export-error">{error}</small>}</section>
}

function formatDuration(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }
