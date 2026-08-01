import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tauriConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))

function validateSignature(file, signaturePath, publicKey, environment) {
  if (!statSync(signaturePath).isFile()) throw new Error(`assinatura inválida para ${file}`)
  const signature = readFileSync(signaturePath, 'utf8').trim()
  if (!signature || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error(`assinatura inválida para ${file}`)
  if (Buffer.from(signature, 'base64').length < 64) throw new Error(`assinatura curta ou inválida para ${file}`)
  if (environment.GRIFFIN_SIGNATURE_VERIFIER !== 'format-only') {
    const signatureDirectory = mkdtempSync(join(tmpdir(), 'griffin-minisign-'))
    const decodedSignaturePath = join(signatureDirectory, 'signature.minisig')
    try {
      writeFileSync(decodedSignaturePath, Buffer.from(signature, 'base64'))
      execFileSync('minisign', ['-Vm', file, '-x', decodedSignaturePath, '-P', publicKey], { stdio: 'ignore' })
    } catch (error) {
      throw new Error(`assinatura criptográfica inválida ou minisign ausente para ${file}: ${error.message}`)
    } finally {
      rmSync(signatureDirectory, { recursive: true, force: true })
    }
  }
  return signature
}

export function generateManifest(releaseDirectory = 'release', environment = process.env) {
  const releaseDir = resolve(releaseDirectory)
  const version = environment.GRIFFIN_VERSION ?? packageJson.version
  const tag = environment.GITHUB_REF_NAME ?? `v${version}`
  const repository = environment.GITHUB_REPOSITORY ?? 'britors/Griffin'
  const baseUrl = `https://github.com/${repository}/releases/download/${tag}`
  const publicKey = tauriConfig.plugins?.updater?.pubkey
  if (!publicKey) throw new Error('chave pública do updater ausente na configuração Tauri')
  if (tag !== `v${version}`) throw new Error(`tag ${tag} não corresponde à versão ${version} (esperado v${version})`)
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`versão inválida: ${version}`)

  function asset(extension, label) {
    const files = readdirSync(releaseDir).filter((name) => name.toLowerCase().endsWith(extension) && !name.endsWith('.sig'))
    if (files.length !== 1) throw new Error(`${label}: esperado exatamente um artefato ${extension}, encontrados ${files.length}`)
    const file = files[0]
    if (!file.includes(version)) throw new Error(`${label}: versão ${version} ausente no nome de ${file}`)
    const filePath = join(releaseDir, file)
    const signaturePath = join(releaseDir, `${file}.sig`)
    if (!existsSync(signaturePath)) throw new Error(`assinatura ausente para ${file}`)
    return {
      url: `${baseUrl}/${encodeURIComponent(file)}`,
      signature: validateSignature(filePath, signaturePath, publicKey, environment),
    }
  }

  const deb = asset('.deb', 'Linux DEB')
  const rpm = asset('.rpm', 'Linux RPM')
  const nsis = asset('.exe', 'Windows NSIS')

  const platforms = {
    'linux-x86_64': deb,
    'linux-deb-x86_64': deb,
    'linux-rpm-x86_64': rpm,
    'windows-x86_64': nsis,
    'windows-nsis-x86_64': nsis,
  }

  const manifest = {
    version,
    notes: `Atualização do Griffin Music para ${version}.`,
    pub_date: new Date().toISOString(),
    platforms,
  }

  const output = join(releaseDir, 'latest.json')
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
  return { output, version, platforms }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = generateManifest(process.argv[2] ?? 'release')
  console.log(`Manifesto do updater gerado: ${result.output}`)
  console.log(`  versão: ${result.version}`)
  console.log(`  plataformas: ${Object.keys(result.platforms).join(', ')}`)
}
