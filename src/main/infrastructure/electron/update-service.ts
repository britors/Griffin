import { app, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '../../../shared/types'

/** Handles in-app updates for the Windows installer published on GitHub. */
export class ElectronUpdateService {
  private readonly supported: boolean
  private current: AppUpdateStatus

  constructor(private readonly getWebContents: () => WebContents | undefined) {
    this.supported = app.isPackaged && process.platform === 'win32'
    this.current = this.supported
      ? { supported: true, stage: 'not-available', message: 'Clique em “Verificar” para procurar atualizações.' }
      : process.platform === 'linux'
        ? { supported: false, stage: 'system', message: 'Atualizações do Linux são gerenciadas pelo OBS ou pelo gerenciador de pacotes.' }
        : { supported: false, stage: 'disabled', message: 'Atualizações automáticas ficam disponíveis na versão instalada do Griffin.' }

    if (!this.supported) return
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('checking-for-update', () => this.setStatus({ stage: 'checking', message: 'Procurando uma nova versão…' }))
    autoUpdater.on('update-available', (info) => this.setStatus({ stage: 'available', version: info.version, message: `A versão ${info.version} está disponível.` }))
    autoUpdater.on('update-not-available', () => this.setStatus({ stage: 'not-available', message: 'Você já está usando a versão mais recente.' }))
    autoUpdater.on('download-progress', (info) => this.setStatus({ stage: 'downloading', progress: info.percent, message: `Baixando atualização… ${Math.round(info.percent)}%` }))
    autoUpdater.on('update-downloaded', (info) => this.setStatus({ stage: 'downloaded', version: info.version, progress: 100, message: `A versão ${info.version} está pronta para instalar.` }))
    autoUpdater.on('error', (error) => this.setStatus({ stage: 'error', message: error.message || 'Não foi possível verificar a atualização.' }))
  }

  status() { return this.current }

  async check() {
    if (!this.supported) return this.current
    this.setStatus({ stage: 'checking', message: 'Procurando uma nova versão…' })
    try { await autoUpdater.checkForUpdates() } catch (error) { this.setStatus({ stage: 'error', message: error instanceof Error ? error.message : 'Não foi possível verificar a atualização.' }) }
    return this.current
  }

  async download() {
    if (!this.supported || this.current.stage !== 'available') return this.current
    this.setStatus({ stage: 'downloading', progress: 0, message: 'Preparando download…' })
    try { await autoUpdater.downloadUpdate() } catch (error) { this.setStatus({ stage: 'error', message: error instanceof Error ? error.message : 'Não foi possível baixar a atualização.' }) }
    return this.current
  }

  install() {
    if (this.supported && this.current.stage === 'downloaded') autoUpdater.quitAndInstall()
  }

  checkInBackground() {
    if (this.supported) setTimeout(() => { void this.check() }, 3000)
  }

  private setStatus(next: Partial<AppUpdateStatus>) {
    this.current = { ...this.current, ...next }
    this.getWebContents()?.send('updates:status', this.current)
  }
}
