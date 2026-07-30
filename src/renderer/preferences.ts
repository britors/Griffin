export type VisualPreferences = Record<string, unknown>

export const ACCENT_PRESETS = [
  { name: 'Dourado', value: '#d4a531', light: '#e8c76b', rgb: '212, 165, 49' },
  { name: 'Azul', value: '#4b8dcc', light: '#8bb8e8', rgb: '75, 141, 204' },
  { name: 'Violeta', value: '#8b72c9', light: '#b9a7df', rgb: '139, 114, 201' },
  { name: 'Coral', value: '#d86a5f', light: '#f0a39b', rgb: '216, 106, 95' },
  { name: 'Menta', value: '#55a878', light: '#9bd2ad', rgb: '85, 168, 120' },
  { name: 'Ciano', value: '#3da8b5', light: '#8ad6dd', rgb: '61, 168, 181' },
  { name: 'Rosa', value: '#c15e9e', light: '#ed9acb', rgb: '193, 94, 158' },
] as const

export function applyVisualPreferences(settings: VisualPreferences): void {
  const accent = ACCENT_PRESETS.find((preset) => preset.value === settings.accentColor) ?? ACCENT_PRESETS[0]
  document.documentElement.style.setProperty('--gold', accent.value)
  document.documentElement.style.setProperty('--gold-light', accent.light)
  document.documentElement.style.setProperty('--accent-rgb', accent.rgb)
  document.body.classList.toggle('large-text', settings.uiScale === 'large')
  document.body.classList.toggle('light-theme', settings.theme === 'light')
  document.body.classList.toggle('high-contrast', settings.theme === 'high-contrast')
}
