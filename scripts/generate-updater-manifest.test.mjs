import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateManifest } from './generate-updater-manifest.mjs'

const signature = Buffer.from('valid updater signature '.repeat(8)).toString('base64')
const currentVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function fixture({ emptySignature = false, version = currentVersion } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'griffin-manifest-'))
  mkdirSync(dir, { recursive: true })
  for (const name of [`Griffin Music_${version}_amd64.deb`, `griffin-music-${version}-1.x86_64.rpm`, `Griffin Music_${version}_x64-setup.exe`]) {
    writeFileSync(join(dir, name), 'artifact')
    writeFileSync(`${join(dir, name)}.sig`, emptySignature ? '' : signature)
  }
  return dir
}

test('gera manifesto apenas com artefatos assinados da mesma versão', () => {
  const dir = fixture()
  generateManifest(dir, { ...process.env, GITHUB_REF_NAME: `v${currentVersion}`, GRIFFIN_SIGNATURE_VERIFIER: 'format-only' })
})

test('rejeita assinatura vazia', () => {
  const dir = fixture({ emptySignature: true })
  assert.throws(() => generateManifest(dir, { ...process.env, GITHUB_REF_NAME: `v${currentVersion}`, GRIFFIN_SIGNATURE_VERIFIER: 'format-only' }))
})

test('rejeita tag divergente', () => {
  const dir = fixture()
  assert.throws(() => generateManifest(dir, { ...process.env, GITHUB_REF_NAME: `v${currentVersion}.1` }))
})
