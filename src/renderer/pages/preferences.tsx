import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../api'
import { ACCENT_PRESETS, applyVisualPreferences } from '../preferences'
import { usePlayer, type MetronomeSubdivision } from '../store'
import type { AppUpdateStatus, ExecutionProviderPreference, LocalResourcesSummary, SeparationProfile, SeparationStatus, SeparationModelProfile, YtDlpProgress, YtDlpStatus } from '../../shared/types'
import { useRemoteProvider } from '../hooks/use-remote-provider'
import { useModelDownload } from '../hooks/use-model-download'
import { useCudaRuntime } from '../hooks/use-cuda-runtime'
import { confirmDialog } from '../components/dialog-store'
import { LOCAL_PRIVACY_DESCRIPTION, LOCAL_PRIVACY_LABEL } from '../privacy-copy'

type Section = 'appearance' | 'playback' | 'obs' | 'processing' | 'about'
type Settings = Record<string, unknown>

const sections: Array<{ id: Section; label: string }> = [
  { id: 'appearance', label: 'Aparência' },
  { id: 'playback', label: 'Reprodução' },
  { id: 'obs', label: 'OBS / Windows' },
  { id: 'processing', label: 'Processamento' },
  { id: 'about', label: 'Sobre' },
]

export function PreferencesPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [activeSection, setActiveSection] = useState<Section>('appearance')
  const [modelStatus, setModelStatus] = useState<SeparationStatus | null>(null)
  const [resources, setResources] = useState<LocalResourcesSummary | null>(null)
  const { setResetPlaybackOnTrackChange, setMetronomeEnabled, setMetronomeSubdivision, setMetronomeVolume, setCountInEnabled, setCountInBars } = usePlayer()
  const modelDownload = useModelDownload()
  const cudaRuntime = useCudaRuntime()

  useEffect(() => {
    void api.settings.get().then((loaded) => {
      setSettings(loaded)
      applyVisualPreferences(loaded)
      setResetPlaybackOnTrackChange(loaded.resetPlaybackOnTrackChange !== false)
    })
    void api.separation.status().then(setModelStatus)
    void api.resources.summary().then(setResources)
  }, [])
  useEffect(() => { if (modelDownload.status?.extendedInstalled) void api.separation.status().then(setModelStatus) }, [modelDownload.status?.extendedInstalled])

  const updateSetting = async (key: string, value: unknown) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    applyVisualPreferences(next)
    await api.settings.set(key, value)
    if (key === 'resetPlaybackOnTrackChange' && typeof value === 'boolean') setResetPlaybackOnTrackChange(value)
    if (key === 'metronomeEnabled' && typeof value === 'boolean') setMetronomeEnabled(value)
    if (key === 'metronomeSubdivision' && (value === 1 || value === 2 || value === 4)) setMetronomeSubdivision(value as MetronomeSubdivision)
    if (key === 'metronomeVolume' && typeof value === 'number') setMetronomeVolume(value)
    if (key === 'countInEnabled' && typeof value === 'boolean') setCountInEnabled(value)
    if (key === 'countInBars' && (value === 1 || value === 2)) setCountInBars(value)
  }

  return <main className="preferences-page">
    <div className="page-heading compact">
      <div><span className="eyebrow">PREFERÊNCIAS</span><h1>Configure o Griffin Music</h1><p>Preferências salvas localmente neste computador.</p></div>
    </div>
    <div className="preferences-layout">
      <nav className="preferences-nav" aria-label="Seções das preferências">
        {sections.map((section) => <button className={activeSection === section.id ? 'active' : ''} key={section.id} onClick={() => setActiveSection(section.id)}>{section.label}</button>)}
      </nav>
      <div className="preferences-content">
        {activeSection === 'appearance' && <AppearanceSection settings={settings} onChange={updateSetting} />}
        {activeSection === 'playback' && <PlaybackSection settings={settings} onChange={updateSetting} />}
        {activeSection === 'obs' && <ObsSection />}
        {activeSection === 'processing' && <><ProcessingSection settings={settings} status={modelStatus} resources={resources} onChange={updateSetting} onCacheCleared={setResources} modelDownload={modelDownload} cudaRuntime={cudaRuntime} /><YtDlpSection /><RemoteProviderSection /></>}
        {activeSection === 'about' && <AboutSection />}
      </div>
    </div>
  </main>
}

function AppearanceSection({ settings, onChange }: { settings: Settings; onChange: (key: string, value: unknown) => Promise<void> }) {
  const scale = settings.uiScale === 'large' ? 'large' : 'normal'
  const theme = settings.theme === 'light' ? 'light' : 'dark'
  const accent = typeof settings.accentColor === 'string' ? settings.accentColor : ACCENT_PRESETS[0].value
  return <PreferenceSection title="Aparência" description="Ajuste a apresentação do aplicativo.">
    <PreferenceRow label="Tema" description="Escolha entre a interface clara e escura do Griffin Music.">
      <select className="preference-control" value={theme} onChange={(event) => void onChange('theme', event.target.value)}><option value="dark">Escuro</option><option value="light">Claro</option></select>
    </PreferenceRow>
    <PreferenceRow label="Cor de destaque" description="Usada nos botões, controles ativos e indicadores.">
      <div className="accent-options">{ACCENT_PRESETS.map((preset) => <button className={`accent-option ${accent === preset.value ? 'selected' : ''}`} style={{ backgroundColor: preset.value }} title={preset.name} aria-label={preset.name} key={preset.value} onClick={() => void onChange('accentColor', preset.value)} />)}</div>
    </PreferenceRow>
    <PreferenceRow label="Tamanho da interface" description="Aumenta os textos principais para facilitar a leitura.">
      <select className="preference-control" value={scale} onChange={(event) => void onChange('uiScale', event.target.value)}><option value="normal">Normal</option><option value="large">Grande</option></select>
    </PreferenceRow>
  </PreferenceSection>
}

function PlaybackSection({ settings, onChange }: { settings: Settings; onChange: (key: string, value: unknown) => Promise<void> }) {
  const resetOnTrackChange = settings.resetPlaybackOnTrackChange !== false
  const metronomeEnabled = settings.metronomeEnabled === true
  const subdivision = settings.metronomeSubdivision === 2 || settings.metronomeSubdivision === 4 ? settings.metronomeSubdivision : 1
  const countInEnabled = settings.countInEnabled === true
  const countInBars = settings.countInBars === 2 ? 2 : 1
  const metronomeVolume = typeof settings.metronomeVolume === 'number' ? settings.metronomeVolume : 0.5
  return <PreferenceSection title="Reprodução" description="Comportamento padrão do player de stems.">
    <PreferenceRow label="Reiniciar posição ao trocar de faixa" description="Começa a nova faixa do início quando ela é selecionada.">
      <label className="preference-toggle"><input type="checkbox" checked={resetOnTrackChange} onChange={(event) => void onChange('resetPlaybackOnTrackChange', event.target.checked)} /><span /></label>
    </PreferenceRow>
    <PreferenceRow label="Processamento de áudio" description="Pitch e tempo são aplicados localmente; a separação remota é uma opção separada e explícita.">
      <span className="preference-value">100% local</span>
    </PreferenceRow>
    <PreferenceRow label="Metrônomo" description="Acompanha o transporte, o tempo e o loop da faixa.">
      <label className="preference-toggle"><input type="checkbox" checked={metronomeEnabled} onChange={(event) => void onChange('metronomeEnabled', event.target.checked)} /><span /></label>
    </PreferenceRow>
    <PreferenceRow label="Subdivisão" description="Escolha quantos cliques ouvir por batida.">
      <select className="preference-control" value={subdivision} disabled={!metronomeEnabled} onChange={(event) => void onChange('metronomeSubdivision', Number(event.target.value))}><option value="1">1x — semínima</option><option value="2">2x — colcheia</option><option value="4">4x — semicolcheia</option></select>
    </PreferenceRow>
    <PreferenceRow label="Volume do metrônomo" description="Ajuste o volume dos cliques sem alterar os stems.">
      <input className="preference-range" type="range" min="0" max="1" step="0.05" value={metronomeVolume} disabled={!metronomeEnabled} onChange={(event) => void onChange('metronomeVolume', Number(event.target.value))} />
    </PreferenceRow>
    <PreferenceRow label="Contagem antes de tocar" description="Conte uma ou duas barras antes de iniciar os stems.">
      <div className="preference-inline-controls"><label className="preference-toggle"><input type="checkbox" checked={countInEnabled} disabled={!metronomeEnabled} onChange={(event) => void onChange('countInEnabled', event.target.checked)} /><span /></label><select className="preference-control compact-control" value={countInBars} disabled={!metronomeEnabled || !countInEnabled} onChange={(event) => void onChange('countInBars', Number(event.target.value))}><option value="1">1 barra</option><option value="2">2 barras</option></select></div>
    </PreferenceRow>
    <PreferenceRow label="Atalhos do player" description="Use o teclado para controlar a reprodução sem tirar as mãos do instrumento.">
      <div className="shortcut-list" aria-label="Atalhos do player">
        <span><kbd>Space</kbd> Play/Pause</span><span><kbd>←</kbd> <kbd>→</kbd> Navegar</span><span><kbd>Home</kbd> Início</span><span><kbd>L</kbd> Loop</span><span><kbd>A</kbd> / <kbd>B</kbd> Marcar loop</span><span><kbd>M</kbd> Silenciar</span><span><kbd>[</kbd> <kbd>]</kbd> Tempo</span>
      </div>
    </PreferenceRow>
  </PreferenceSection>
}

function ObsSection() {
  return <PreferenceSection title="OBS Studio no Windows" description="Capture o áudio e a janela do Griffin sem instalar cabo virtual no fluxo padrão.">
    <PreferenceRow label="Áudio recomendado" description="No OBS, adicione uma fonte Application Audio Capture (BETA) e selecione a janela do Griffin Music.">
      <span className="preference-value">WASAPI por aplicativo</span>
    </PreferenceRow>
    <PreferenceRow label="Imagem" description="Adicione Window Capture para transmitir a interface do Griffin junto com o áudio.">
      <span className="preference-value">Window Capture</span>
    </PreferenceRow>
    <PreferenceRow label="Evitar eco" description="Quando usar captura por aplicativo, desative o áudio global do desktop em Configurações → Áudio no OBS.">
      <span className="status-pill ready">Recomendado</span>
    </PreferenceRow>
    <PreferenceRow label="Qualidade" description="Mantenha a taxa do Griffin e do OBS iguais; 48 kHz é recomendado para transmissão e gravação.">
      <span className="preference-value">48 kHz</span>
    </PreferenceRow>
    <PreferenceRow label="Compatibilidade" description="Se o OBS não listar o Griffin, use uma saída virtual do Windows como fallback e capture-a como Audio Input Capture.">
      <a className="secondary-button compact-control" href="https://obsproject.com/kb/application-audio-capture-guide" target="_blank" rel="noreferrer">Abrir guia do OBS</a>
    </PreferenceRow>
    <PreferenceRow label="Escopo atual" description="O Griffin não controla cenas, gravação ou transmissão. O OBS apenas captura o áudio já processado pelo player.">
      <span className="preference-value">Captura nativa</span>
    </PreferenceRow>
  </PreferenceSection>
}

function ProcessingSection({ settings, status, resources, onChange, onCacheCleared, modelDownload, cudaRuntime }: { settings: Settings; status: SeparationStatus | null; resources: LocalResourcesSummary | null; onChange: (key: string, value: unknown) => Promise<void>; onCacheCleared: (summary: LocalResourcesSummary) => void; modelDownload: ReturnType<typeof useModelDownload>; cudaRuntime: ReturnType<typeof useCudaRuntime> }) {
  const processingThreads = typeof settings.processingThreads === 'number' ? settings.processingThreads : 0
  const profile: SeparationProfile = settings.processingProfile === 'speed' || settings.processingProfile === 'balanced' ? settings.processingProfile : 'quality'
  const provider: ExecutionProviderPreference = settings.executionProvider === 'cpu' || settings.executionProvider === 'cuda' ? settings.executionProvider : 'auto'
  const modelProfile: SeparationModelProfile = settings.modelProfile === 'six-stem' ? 'six-stem' : 'four-stem'
  const [cacheError, setCacheError] = useState<string | null>(null)
  const clearCache = async () => {
    if (!(await confirmDialog('Limpar o cache de stems?\n\nAs faixas originais, projetos e modelos serão preservados.', { confirmLabel: 'Limpar', tone: 'danger' }))) return
    setCacheError(null)
    try {
      onCacheCleared(await api.resources.clearCache())
    } catch (reason) {
      setCacheError(reason instanceof Error ? reason.message : 'Não foi possível limpar o cache agora. Aguarde a separação terminar.')
    }
  }
  return <PreferenceSection title="Processamento" description="Modelo e armazenamento usados pela separação local.">
    <PreferenceRow label="Modelo" description="Variante de maior qualidade para separar quatro stems."><span className="preference-value">htdemucs_ft</span></PreferenceRow>
    <PreferenceRow label="Perfil de stems" description="O perfil de seis stems adiciona guitarra e piano quando o modelo estendido estiver instalado; quatro stems é o fallback.">
      <div className="preference-inline-controls">
        <select className="preference-control" value={modelProfile} onChange={(event) => void onChange('modelProfile', event.target.value)}><option value="four-stem">4 stems · padrão</option><option value="six-stem" disabled={!status?.sixStemAvailable}>6 stems · guitarra/piano{status?.sixStemAvailable ? '' : ' · não instalado'}</option></select>
        {modelDownload.status && !modelDownload.status.extendedInstalled && (modelDownload.progress?.kind === 'extended'
          ? <span className="preference-value">{modelDownload.progress.stage} · {Math.round(modelDownload.progress.progress * 100)}%</span>
          : <button className="secondary-button compact-control" disabled={modelDownload.status.downloading !== null} onClick={() => void modelDownload.download('extended')}>Ativar guitarra e piano</button>)}
      </div>
    </PreferenceRow>
    <PreferenceRow label="Status do modelo" description="O modelo é carregado por um processo nativo separado para limitar o uso de memória da interface."><span className={`status-pill ${status?.available ? 'ready' : ''}`}>{status?.available ? 'Disponível' : status?.message ?? 'Verificando…'}</span></PreferenceRow>
    <PreferenceRow label="Provider ONNX" description="O worker tenta CUDA quando solicitado e retorna para CPU se o runtime ou driver não estiver disponível."><span className="preference-value">{status?.provider === 'cuda' ? 'CUDA / GPU' : 'CPU'}{status?.memoryBytes ? ` · ${formatBytes(status.memoryBytes)}` : ''}{status?.lastDurationMs ? ` · último ${formatDurationMs(status.lastDurationMs)}` : ''}</span></PreferenceRow>
    <PreferenceRow label="Perfil de separação" description="Qualidade prioriza htdemucs_ft; Balanceado e Rápido priorizam o modelo single-file quando disponível."><select className="preference-control" value={profile} onChange={(event) => void onChange('processingProfile', event.target.value)}><option value="quality">Qualidade máxima</option><option value="balanced">Balanceado</option><option value="speed">Velocidade</option></select></PreferenceRow>
    <PreferenceRow label="Aceleração" description="Automático e Preferir GPU tentam CUDA e usam CPU como fallback; a mudança vale para a próxima separação."><select className="preference-control" value={provider} onChange={(event) => void onChange('executionProvider', event.target.value)}><option value="auto">Automático</option><option value="cpu">Somente CPU</option><option value="cuda">Preferir GPU</option></select></PreferenceRow>
    <PreferenceRow label="Runtime NVIDIA" description={`${cudaRuntime.status?.message ?? 'Verificando suporte NVIDIA…'}${cudaRuntime.status?.downloadBytes ? ` Download aproximado: ${formatBytes(cudaRuntime.status.downloadBytes)}.` : ''}`}>
      <div className="preference-inline-controls">
        {cudaRuntime.status?.installed && !cudaRuntime.progress && <span className="status-pill ready">Instalado{cudaRuntime.status.version ? ` · cuDNN ${cudaRuntime.status.version}` : ''}</span>}
        {cudaRuntime.progress && <span className="preference-value">{cudaRuntime.progress.stage} · {Math.round(cudaRuntime.progress.progress * 100)}%</span>}
        {cudaRuntime.status?.supported && !cudaRuntime.status.installed && !cudaRuntime.progress && <button className="primary-button compact-control" disabled={cudaRuntime.installing || cudaRuntime.status.downloading} onClick={() => void cudaRuntime.install()}>Instalar suporte NVIDIA</button>}
        {cudaRuntime.progress && <button className="text-button" onClick={() => void cudaRuntime.cancel()}>Cancelar</button>}
      </div>
    </PreferenceRow>
    {cudaRuntime.error && <PreferenceRow label="Erro no runtime NVIDIA" description={cudaRuntime.error}><span className="status-pill" /></PreferenceRow>}
    <PreferenceRow label="Cache de stems" description={`Evita recalcular uma faixa já processada. ${resources ? `${formatBytes(resources.cacheBytes)} armazenados.` : 'Calculando tamanho…'}`}><div className="preference-inline-controls"><span className="preference-value">Ativo</span><button className="secondary-button compact-control" onClick={() => void clearCache()}>Limpar cache</button>{cacheError && <span className="model-download-error">{cacheError}</span>}</div></PreferenceRow>
    <PreferenceRow label="Local do cache" description="Os stems separados ficam neste diretório local."><span className="preference-path">{resources?.cachePath ?? 'Calculando…'}</span></PreferenceRow>
    <PreferenceRow label="Uso do modelo" description="O modelo ONNX também permanece somente neste computador."><span className="preference-value">{resources ? formatBytes(resources.modelBytes) : 'Calculando…'}</span></PreferenceRow>
    <PreferenceRow label="Threads de processamento" description="Limita o paralelismo do ONNX; Automático usa um limite conservador para preservar a máquina."><select className="preference-control" value={processingThreads} onChange={(event) => void onChange('processingThreads', Number(event.target.value))}><option value="0">Automático</option><option value="1">1 thread</option><option value="2">2 threads</option><option value="4">4 threads</option><option value="8">8 threads</option></select></PreferenceRow>
    <PreferenceRow label="Privacidade" description={LOCAL_PRIVACY_DESCRIPTION}><span className="status-pill ready">{LOCAL_PRIVACY_LABEL}</span></PreferenceRow>
  </PreferenceSection>
}

function YtDlpSection() {
  const [status, setStatus] = useState<YtDlpStatus | null>(null)
  const [progress, setProgress] = useState<YtDlpProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => { void api.ytDlp.status().then(setStatus) }
  useEffect(() => {
    refresh()
    return api.ytDlp.onProgress((next) => {
      setProgress(next)
      if (next.stage === 'ready') { setProgress(null); refresh() }
    })
  }, [])

  const download = async () => {
    setError(null)
    setProgress({ progress: 0, stage: 'downloading', message: 'Preparando download…' })
    try { await api.ytDlp.download(); refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível baixar o yt-dlp.') } finally { setProgress(null) }
  }
  const busy = Boolean(progress)
  return <PreferenceSection title="Importação do YouTube" description="Baixe e mantenha o yt-dlp dentro da pasta de dados do Griffin. O binário é verificado por SHA-256 antes de ser usado.">
    <PreferenceRow label="yt-dlp" description={status?.message ?? 'Verificando…'}>
      <div className="preference-inline-controls">
        {status?.installed && !busy && <span className="status-pill ready">Instalado{status.version ? ` · ${status.version}` : ''}</span>}
        {busy && <span className="preference-value">{progress ? `${progress.message} · ${Math.round(progress.progress * 100)}%` : 'Baixando…'}</span>}
        {!busy && <button className={status?.installed ? 'secondary-button compact-control' : 'primary-button compact-control'} onClick={() => void download()}>{status?.installed ? 'Atualizar' : 'Baixar yt-dlp'}</button>}
        {busy && <button className="text-button" onClick={() => void api.ytDlp.cancel()}>Cancelar</button>}
      </div>
    </PreferenceRow>
    {error && <PreferenceRow label="Erro" description={error}><span className="status-pill" /></PreferenceRow>}
  </PreferenceSection>
}

function RemoteProviderSection() {
  const { status, error, saveApiKey, clearApiKey } = useRemoteProvider()
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!keyInput.trim()) return
    setBusy(true)
    await saveApiKey(keyInput.trim())
    setKeyInput('')
    setBusy(false)
  }

  const remove = async () => {
    if (!(await confirmDialog('Remover a chave de API do StemSplit deste computador?', { confirmLabel: 'Remover', tone: 'danger' }))) return
    setBusy(true)
    await clearApiKey()
    setBusy(false)
  }

  const statusLabel = status?.verified ? `Conectado${status.balanceFormatted ? ` · saldo ${status.balanceFormatted}` : ''}` : status?.configured ? 'Chave salva, não verificada' : 'Não configurado'

  return <PreferenceSection title="Separação na nuvem (opcional)" description="Envie a faixa para o StemSplit.io quando quiser uma alternativa ao motor local. Totalmente opcional — o Griffin continua funcionando 100% offline sem isso.">
    <ol className="onboarding-steps">
      <li>Crie uma conta grátis em <a href="https://stemsplit.io/free-trial" target="_blank" rel="noreferrer">stemsplit.io</a> — novas contas ganham 5 minutos grátis.</li>
      <li>Gere uma API key em <a href="https://stemsplit.io/app/settings/api" target="_blank" rel="noreferrer">stemsplit.io/app/settings/api</a>.</li>
      <li>Cole a chave abaixo e clique em "Salvar e testar". Sem uma chave configurada, a opção de nuvem simplesmente não aparece no player.</li>
    </ol>
    <PreferenceRow label="Chave de API" description="Fica cifrada neste computador (quando o sistema suporta), nunca é enviada a não ser para o próprio StemSplit.">
      <div className="preference-inline-controls">
        <input type="password" className="preference-control" placeholder="sk_live_..." autoComplete="off" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} />
        <button className="secondary-button compact-control" disabled={busy || !keyInput.trim()} onClick={() => void save()}>Salvar e testar</button>
        {status?.configured && <button className="secondary-button compact-control" disabled={busy} onClick={() => void remove()}>Remover chave</button>}
      </div>
    </PreferenceRow>
    <PreferenceRow label="Status" description={status?.message ?? 'Verificando…'}>
      <span className={`status-pill ${status?.verified ? 'ready' : ''}`}>{statusLabel}</span>
    </PreferenceRow>
    <PreferenceRow label="Preço e retenção" description='Pay-as-you-go, a partir de ~$0,10/minuto de áudio, sem assinatura fixa. O arquivo original é apagado em até 48h; os stems ficam disponíveis para download por até 14 dias. Seu áudio não é usado para treinar modelos.'>
      <a className="secondary-button compact-control" href="https://stemsplit.io/en/legal/privacy-policy" target="_blank" rel="noreferrer">Ver política completa</a>
    </PreferenceRow>
    {error && <PreferenceRow label="Erro" description={error}><span className="status-pill" /></PreferenceRow>}
  </PreferenceSection>
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function formatDurationMs(milliseconds: number) { return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s` }

function AboutSection() {
  return <PreferenceSection title="Sobre" description="Informações desta instalação do Griffin Music.">
    <PreferenceRow label="Versão" description="Versão atual do aplicativo."><span className="preference-value">0.1.3</span></PreferenceRow>
    <PreferenceRow label="Arquitetura" description="Aplicativo desktop com processamento local."><span className="preference-value">Tauri + Rust + React</span></PreferenceRow>
    <PreferenceRow label="Criado por" description="Autor e mantenedor do Griffin Music."><span className="preference-value">Rodrigo Brito</span></PreferenceRow>
    <PreferenceRow label="Contato" description="Dúvidas, sugestões ou problemas."><a className="preference-value" href="mailto:rodrigo@w3ti.com.br">rodrigo@w3ti.com.br</a></PreferenceRow>
    <PreferenceRow label="Licença" description="Código aberto sob os termos da GPLv3."><a className="preference-value" href="https://github.com/britors/Griffin/blob/main/LICENSE" target="_blank" rel="noreferrer">GPLv3</a></PreferenceRow>
    <PreferenceRow label="Privacidade" description={`${LOCAL_PRIVACY_DESCRIPTION} A separação StemSplit envia somente a faixa escolhida.`}><span className="status-pill ready">{LOCAL_PRIVACY_LABEL}</span></PreferenceRow>
    <UpdateRow />
    <PreferenceRow label="Apoie o projeto" description="Contribua com qualquer valor via Pix para ajudar a manter o Griffin Music."><PixDonation /></PreferenceRow>
  </PreferenceSection>
}

function UpdateRow() {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null)

  useEffect(() => {
    let mounted = true
    const unsubscribe = api.updates.onStatus((next) => { if (mounted) setStatus(next) })
    void api.updates.status().then((next) => { if (mounted) setStatus(next) })
    return () => { mounted = false; unsubscribe() }
  }, [])

  const check = async () => setStatus(await api.updates.check())
  const download = async () => setStatus(await api.updates.download())
  const install = async () => { await api.updates.install() }
  const busy = status?.stage === 'checking' || status?.stage === 'downloading'

  return <PreferenceRow label="Atualizações" description={status?.message ?? 'Verificando suporte a atualizações…'}>
    <div className="preference-inline-controls update-controls">
      {status?.stage === 'system' && <span className="preference-value update-system">OBS / zypper</span>}
      {status?.stage === 'disabled' && <span className="preference-value">Versão instalada</span>}
      {status?.stage === 'available' && <button className="secondary-button compact-control" onClick={() => void download()}>Baixar{status.version ? ` v${status.version}` : ''}</button>}
      {status?.stage === 'downloaded' && <button className="primary-button compact-control" onClick={() => void install()}>Reiniciar e atualizar</button>}
      {busy && <span className="preference-value update-progress">{status?.progress ? `${Math.round(status.progress)}%` : 'Aguarde…'}</span>}
      {(status?.stage === 'not-available' || status?.stage === 'error' || !status) && <button className="secondary-button compact-control" disabled={busy} onClick={() => void check()}>Verificar</button>}
    </div>
  </PreferenceRow>
}

const PIX_KEY = 'britors@live.com'

function PixDonation() {
  const [qrCode, setQrCode] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void QRCode.toDataURL(createPixPayload(), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: { dark: '#0b1526', light: '#ffffff' },
    }).then((dataUrl) => {
      if (mounted) setQrCode(dataUrl)
    })
    return () => { mounted = false }
  }, [])

  return <div className="pix-donation">
    {qrCode ? <img className="pix-qrcode" src={qrCode} alt="QR Code para apoiar o Griffin Music via Pix" /> : <span className="pix-qrcode-placeholder">Gerando QR Code…</span>}
    <code className="pix-key">{PIX_KEY}</code>
  </div>
}

function createPixPayload() {
  const merchantAccountInformation = `0014BR.GOV.BCB.PIX01${PIX_KEY.length.toString().padStart(2, '0')}${PIX_KEY}`
  const payload = `00020126${merchantAccountInformation.length.toString().padStart(2, '0')}${merchantAccountInformation}5204000053039865802BR5913GRIFFIN MUSIC6009SAO PAULO6304`
  return `${payload}${calculateCrc16(payload)}`
}

function calculateCrc16(payload: string) {
  let crc = 0xffff
  for (const character of payload) {
    crc ^= character.charCodeAt(0) << 8
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1
    crc &= 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function PreferenceSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="preference-section"><div className="preference-section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>{children}</section>
}

function PreferenceRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return <div className="preference-row"><div><strong>{label}</strong><small>{description}</small></div><div className="preference-row-value">{children}</div></div>
}
