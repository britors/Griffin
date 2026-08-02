import { describe, expect, it } from 'vitest'
import { LOCAL_PRIVACY_DESCRIPTION, LOCAL_PRIVACY_LABEL, remoteConsentMessage } from './privacy-copy'

describe('privacy copy', () => {
  it('describes local processing as the default without claiming remote processing does not exist', () => {
    expect(LOCAL_PRIVACY_LABEL).toBe('Local por padrão')
    expect(LOCAL_PRIVACY_DESCRIPTION).toContain('separação na nuvem')
    expect(LOCAL_PRIVACY_DESCRIPTION).toContain('confirmar o envio')
    expect(LOCAL_PRIVACY_DESCRIPTION).not.toContain('nenhuma faixa é enviada')
  })

  it('states that consent is required for every remote operation', () => {
    const message = remoteConsentMessage('Estimativa: US$ 0,10')
    expect(message).toContain('áudio deixará este computador')
    expect(message).toContain('Estimativa: US$ 0,10')
    expect(message).toContain('antes de cada operação remota')
    expect(message).not.toContain('primeira separação da sessão')
  })
})
