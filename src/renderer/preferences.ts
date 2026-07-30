export type VisualPreferences = Record<string, unknown>

export const ACCENT_PRESETS = [
  { name: 'Dourado', value: '#d4a531', light: '#e8c76b' },
  { name: 'Azul', value: '#4b8dcc', light: '#8bb8e8' },
  { name: 'Violeta', value: '#8b72c9', light: '#b9a7df' },
] as const

export function applyVisualPreferences(settings: VisualPreferences): void {
  const accent = ACCENT_PRESETS.find((preset) => preset.value === settings.accentColor) ?? ACCENT_PRESETS[0]
  document.documentElement.style.setProperty('--gold', accent.value)
  document.documentElement.style.setProperty('--gold-light', accent.light)
  document.body.classList.toggle('large-text', settings.uiScale === 'large')
  document.body.classList.toggle('light-theme', settings.theme === 'light')
  document.body.classList.toggle('high-contrast', settings.theme === 'high-contrast')
}
