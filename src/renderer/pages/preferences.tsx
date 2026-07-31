import { useEffect, useState } from 'react'
import { api } from '../api'
import { ACCENT_PRESETS, applyVisualPreferences } from '../preferences'
import { usePlayer, type MetronomeSubdivision } from '../store'
import type { ExecutionProviderPreference, LocalResourcesSummary, SeparationProfile, SeparationStatus, SeparationModelProfile } from '../../shared/types'

type Section = 'appearance' | 'playback' | 'processing' | 'about'
type Settings = Record<string, unknown>

const sections: Array<{ id: Section; label: string }> = [
  { id: 'appearance', label: 'Aparência' },
  { id: 'playback', label: 'Reprodução' },
  { id: 'processing', label: 'Processamento' },
  { id: 'about', label: 'Sobre' },
]

export function PreferencesPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [activeSection, setActiveSection] = useState<Section>('appearance')
  const [modelStatus, setModelStatus] = useState<SeparationStatus | null>(null)
  const [resources, setResources] = useState<LocalResourcesSummary | null>(null)
  const { setResetPlaybackOnTrackChange, setMetronomeEnabled, setMetronomeSubdivision, setMetronomeVolume, setCountInEnabled, setCountInBars } = usePlayer()

  useEffect(() => {
    void api.settings.get().then((loaded) => {
      setSettings(loaded)
      applyVisualPreferences(loaded)
      setResetPlaybackOnTrackChange(loaded.resetPlaybackOnTrackChange !== false)
    })
    void api.separation.status().then(setModelStatus)
    void api.resources.summary().then(setResources)
  }, [])

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
        {activeSection === 'processing' && <ProcessingSection settings={settings} status={modelStatus} resources={resources} onChange={updateSetting} onCacheCleared={setResources} />}
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
    <PreferenceRow label="Processamento de áudio" description="Pitch e tempo são aplicados localmente, sem enviar áudio para a nuvem.">
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

function ProcessingSection({ settings, status, resources, onChange, onCacheCleared }: { settings: Settings; status: SeparationStatus | null; resources: LocalResourcesSummary | null; onChange: (key: string, value: unknown) => Promise<void>; onCacheCleared: (summary: LocalResourcesSummary) => void }) {
  const processingThreads = typeof settings.processingThreads === 'number' ? settings.processingThreads : 0
  const profile: SeparationProfile = settings.processingProfile === 'speed' || settings.processingProfile === 'balanced' ? settings.processingProfile : 'quality'
  const provider: ExecutionProviderPreference = settings.executionProvider === 'cpu' || settings.executionProvider === 'cuda' ? settings.executionProvider : 'auto'
  const modelProfile: SeparationModelProfile = settings.modelProfile === 'six-stem' ? 'six-stem' : 'four-stem'
  const clearCache = async () => {
    if (!window.confirm('Limpar o cache de stems?\n\nAs faixas originais, projetos e modelos serão preservados.')) return
    onCacheCleared(await api.resources.clearCache())
  }
  return <PreferenceSection title="Processamento" description="Modelo e armazenamento usados pela separação local.">
    <PreferenceRow label="Modelo" description="Variante de maior qualidade para separar quatro stems."><span className="preference-value">htdemucs_ft</span></PreferenceRow>
    <PreferenceRow label="Perfil de stems" description="O perfil de seis stems adiciona o canal combinado de guitarra / violão e piano quando htdemucs_6s.onnx estiver instalado; quatro stems é o fallback."><select className="preference-control" value={modelProfile} onChange={(event) => void onChange('modelProfile', event.target.value)}><option value="four-stem">4 stems · padrão</option><option value="six-stem" disabled={!status?.sixStemAvailable}>6 stems · guitarra / violão + piano{status?.sixStemAvailable ? '' : ' · não instalado'}</option></select></PreferenceRow>
    <PreferenceRow label="Status do modelo" description="O modelo é carregado pelo processo principal do Electron."><span className={`status-pill ${status?.available ? 'ready' : ''}`}>{status?.available ? 'Disponível' : status?.message ?? 'Verificando…'}</span></PreferenceRow>
    <PreferenceRow label="Provider ONNX" description="GPU é testada automaticamente; se não estiver disponível, o processamento retorna para CPU."><span className="preference-value">{status?.provider === 'cuda' ? 'CUDA / GPU' : 'CPU'}{status?.memoryBytes ? ` · ${formatBytes(status.memoryBytes)}` : ''}{status?.lastDurationMs ? ` · último ${formatDurationMs(status.lastDurationMs)}` : ''}</span></PreferenceRow>
    <PreferenceRow label="Perfil de separação" description="Qualidade usa htdemucs_ft; Rápido prioriza velocidade com o modelo single-file quando disponível."><select className="preference-control" value={profile} onChange={(event) => void onChange('processingProfile', event.target.value)}><option value="quality">Qualidade máxima</option><option value="balanced">Balanceado</option><option value="speed">Velocidade</option></select></PreferenceRow>
    <PreferenceRow label="Aceleração" description="Escolha Automático para detectar CUDA e manter fallback CPU; a mudança vale para a próxima separação."><select className="preference-control" value={provider} onChange={(event) => void onChange('executionProvider', event.target.value)}><option value="auto">Automático</option><option value="cpu">Somente CPU</option><option value="cuda">Preferir GPU</option></select></PreferenceRow>
    <PreferenceRow label="Cache de stems" description={`Evita recalcular uma faixa já processada. ${resources ? `${formatBytes(resources.cacheBytes)} armazenados.` : 'Calculando tamanho…'}`}><div className="preference-inline-controls"><span className="preference-value">Ativo</span><button className="secondary-button compact-control" onClick={() => void clearCache}>Limpar cache</button></div></PreferenceRow>
    <PreferenceRow label="Local do cache" description="Os stems separados ficam neste diretório local."><span className="preference-path">{resources?.cachePath ?? 'Calculando…'}</span></PreferenceRow>
    <PreferenceRow label="Uso do modelo" description="O modelo ONNX também permanece somente neste computador."><span className="preference-value">{resources ? formatBytes(resources.modelBytes) : 'Calculando…'}</span></PreferenceRow>
    <PreferenceRow label="Threads de processamento" description="Limita o paralelismo do ONNX; Automático usa a configuração padrão do runtime."><select className="preference-control" value={processingThreads} onChange={(event) => void onChange('processingThreads', Number(event.target.value))}><option value="0">Automático</option><option value="1">1 thread</option><option value="2">2 threads</option><option value="4">4 threads</option><option value="8">8 threads</option></select></PreferenceRow>
    <PreferenceRow label="Privacidade" description="O áudio, os stems e as métricas ficam locais; nenhuma faixa é enviada para a nuvem."><span className="status-pill ready">Somente local</span></PreferenceRow>
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
    <PreferenceRow label="Versão" description="Versão atual do aplicativo."><span className="preference-value">0.1.0</span></PreferenceRow>
    <PreferenceRow label="Arquitetura" description="Aplicativo desktop com processamento local."><span className="preference-value">Electron + React + TypeScript</span></PreferenceRow>
    <PreferenceRow label="Privacidade" description="O áudio e os stems não são enviados para servidores externos."><span className="status-pill ready">Somente local</span></PreferenceRow>
  </PreferenceSection>
}

function PreferenceSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="preference-section"><div className="preference-section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>{children}</section>
}

function PreferenceRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return <div className="preference-row"><div><strong>{label}</strong><small>{description}</small></div><div className="preference-row-value">{children}</div></div>
}
