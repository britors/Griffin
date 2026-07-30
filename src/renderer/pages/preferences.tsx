import { useEffect, useState } from 'react'
import { api } from '../api'
import { ACCENT_PRESETS, applyVisualPreferences } from '../preferences'
import { usePlayer } from '../store'
import type { SeparationStatus } from '../../shared/types'

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
  const setResetPlaybackOnTrackChange = usePlayer((state) => state.setResetPlaybackOnTrackChange)

  useEffect(() => {
    void api.settings.get().then((loaded) => {
      setSettings(loaded)
      applyVisualPreferences(loaded)
      setResetPlaybackOnTrackChange(loaded.resetPlaybackOnTrackChange !== false)
    })
    void api.separation.status().then(setModelStatus)
  }, [])

  const updateSetting = async (key: string, value: unknown) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    applyVisualPreferences(next)
    await api.settings.set(key, value)
    if (key === 'resetPlaybackOnTrackChange' && typeof value === 'boolean') setResetPlaybackOnTrackChange(value)
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
        {activeSection === 'processing' && <ProcessingSection status={modelStatus} />}
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
  return <PreferenceSection title="Reprodução" description="Comportamento padrão do player de stems.">
    <PreferenceRow label="Reiniciar posição ao trocar de faixa" description="Começa a nova faixa do início quando ela é selecionada.">
      <label className="preference-toggle"><input type="checkbox" checked={resetOnTrackChange} onChange={(event) => void onChange('resetPlaybackOnTrackChange', event.target.checked)} /><span /></label>
    </PreferenceRow>
    <PreferenceRow label="Processamento de áudio" description="Pitch e tempo são aplicados localmente, sem enviar áudio para a nuvem.">
      <span className="preference-value">100% local</span>
    </PreferenceRow>
  </PreferenceSection>
}

function ProcessingSection({ status }: { status: SeparationStatus | null }) {
  return <PreferenceSection title="Processamento" description="Modelo e armazenamento usados pela separação local.">
    <PreferenceRow label="Modelo" description="Variante de maior qualidade para separar quatro stems."><span className="preference-value">htdemucs_ft</span></PreferenceRow>
    <PreferenceRow label="Status do modelo" description="O modelo é carregado pelo processo principal do Electron."><span className={`status-pill ${status?.available ? 'ready' : ''}`}>{status?.available ? 'Disponível' : status?.message ?? 'Verificando…'}</span></PreferenceRow>
    <PreferenceRow label="Cache de stems" description="Evita recalcular uma faixa já processada. Os arquivos permanecem no computador."><span className="preference-value">Ativo</span></PreferenceRow>
  </PreferenceSection>
}

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
