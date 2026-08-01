import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getBundleType: vi.fn(),
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage?: (event: unknown) => void
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/api/app', () => ({
  BundleType: { Deb: 'deb', Rpm: 'rpm', Nsis: 'nsis', Msi: 'msi' },
  getBundleType: mocks.getBundleType,
}))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }))

import { api } from './api'

describe('automatic updater API', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.getBundleType.mockReset().mockResolvedValue('deb')
    mocks.relaunch.mockReset().mockResolvedValue(undefined)
  })

  it('selects the installed Linux bundle and reports an available update', async () => {
    mocks.invoke.mockResolvedValue({ version: '0.1.4', body: 'Correções importantes' })

    const status = await api.updates.check(true)

    expect(mocks.invoke).toHaveBeenCalledWith('updater_check', { timeout: 15_000, target: 'linux-deb-x86_64' })
    expect(status).toMatchObject({ stage: 'available', version: '0.1.4', message: 'Correções importantes' })
  })

  it('reports progress, installs, and relaunches after a verified download', async () => {
    mocks.invoke.mockImplementation(async (command: string, args?: { onEvent?: { onmessage?: (event: unknown) => void } }) => {
      if (command === 'updater_check') return { version: '0.1.4', body: '' }
      if (command === 'updater_download') {
        args?.onEvent?.onmessage?.({ event: 'Started', data: { contentLength: 100 } })
        args?.onEvent?.onmessage?.({ event: 'Progress', data: { chunkLength: 100 } })
      }
      return undefined
    })
    await api.updates.check(true)

    const downloaded = await api.updates.download()
    await api.updates.install()

    expect(downloaded).toMatchObject({ stage: 'downloaded', progress: 100, version: '0.1.4' })
    expect(mocks.invoke).toHaveBeenCalledWith('updater_install')
    expect(mocks.relaunch).toHaveBeenCalledOnce()
  })

  it('cancels an active download and prevents late completion from changing the status', async () => {
    let finishDownload!: () => void
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'updater_check') return Promise.resolve({ version: '0.1.4', body: '' })
      if (command === 'updater_download') return new Promise<void>((resolve) => { finishDownload = resolve })
      return Promise.resolve(undefined)
    })
    await api.updates.check(true)

    const download = api.updates.download()
    expect((await api.updates.status()).stage).toBe('downloading')
    const canceled = await api.updates.cancel()
    finishDownload()
    await download

    expect(canceled).toMatchObject({ stage: 'not-available' })
    expect(mocks.invoke).toHaveBeenCalledWith('updater_cancel_download')
    expect((await api.updates.status()).stage).toBe('not-available')
  })

  it('disables updates when the installed bundle cannot be identified', async () => {
    mocks.getBundleType.mockResolvedValue('unknown')

    const status = await api.updates.check(true)

    expect(status).toMatchObject({ supported: false, stage: 'disabled' })
    expect(mocks.invoke).not.toHaveBeenCalledWith('updater_check', expect.anything())
  })

  it('shares one check while another check is in flight', async () => {
    let resolveCheck!: (value: { version: string; body: string }) => void
    mocks.invoke.mockReturnValue(new Promise((resolve) => { resolveCheck = resolve }))

    const first = api.updates.check(true)
    const second = api.updates.check(true)
    resolveCheck({ version: '0.1.4', body: '' })
    await Promise.all([first, second])

    expect(mocks.invoke).toHaveBeenCalledOnce()
  })
})
