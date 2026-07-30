import type { GriffinAPI } from '../shared/types'

declare global { interface Window { griffin: GriffinAPI } }
export const api = window.griffin
