import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const obsSpec = readFileSync('packaging/griffin.spec', 'utf8').match(/^Version:\s*([^\s]+)/m)?.[1]
const version = process.env.GRIFFIN_VERSION ?? packageJson.version
const values = { 'package.json': packageJson.version, 'src-tauri/tauri.conf.json': tauri.version, 'src-tauri/Cargo.toml': cargo, 'packaging/griffin.spec': obsSpec }
for (const [source, value] of Object.entries(values)) {
  if (value !== version) throw new Error(`${source} usa ${value ?? '<ausente>'}; esperado ${version}`)
}
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`versão inválida: ${version}`)
console.log(`Versão consistente: ${version}`)
