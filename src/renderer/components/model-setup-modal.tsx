import { useState } from 'react'
import { useModelDownload } from '../hooks/use-model-download'

export function ModelSetupModal() {
  const { status, progress, error, download, pause } = useModelDownload()
  const [dismissed, setDismissed] = useState(false)

  if (!status || status.standardInstalled || dismissed) return null
  const downloading = progress?.kind === 'standard'
  const paused = status?.paused === 'standard'

  return <div className="model-setup-overlay">
    <div className="model-setup-card">
      <h2>Baixe o modelo de separação</h2>
      <p>O Griffin Music separa vocal, bateria, baixo e outros instrumentos localmente no seu computador, sem enviar áudio para a nuvem. Para isso, é necessário baixar o modelo uma única vez (~1 GB).</p>
      {downloading
        ? <div className="model-download-progress"><div className="separation-progress-meta" aria-live="polite"><span>{progress!.stage}</span><strong>{Math.round(progress!.progress * 100)}%</strong></div><div className="separation-progress-track" role="progressbar" aria-label="Progresso do download do modelo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress!.progress * 100)}><span style={{ width: `${Math.round(progress!.progress * 100)}%` }} /></div></div>
        : <div className="model-setup-actions">
          <button className="primary-button" onClick={() => void download('standard')}>{paused ? 'Retomar download' : 'Baixar agora'}</button>
          <button className="secondary-button" onClick={() => setDismissed(true)}>Agora não</button>
        </div>}
      {downloading && <div className="model-setup-actions"><button className="secondary-button compact-control" onClick={() => void pause('standard')}>Pausar</button><button className="secondary-button compact-control" onClick={() => setDismissed(true)}>Continuar em segundo plano</button></div>}
      {paused && <span className="model-download-error">Download pausado. O arquivo parcial será retomado.</span>}
      {error && <span className="model-download-error">{error}</span>}
    </div>
  </div>
}
