param(
  [string]$ReleaseDir = "release",
  [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  throw "Falha: $Message"
}

function RequireFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Fail "arquivo ausente: $Path"
  }
  if ((Get-Item -LiteralPath $Path).Length -le 0) {
    Fail "arquivo vazio: $Path"
  }
}

function AssertPeX64([string]$Path) {
  RequireFile $Path
  $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
  $bytes = [System.IO.File]::ReadAllBytes($resolvedPath)
  if ($bytes.Length -lt 64 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
    Fail "não é um executável PE: $Path"
  }
  $peOffset = [System.BitConverter]::ToInt32($bytes, 0x3c)
  if ($peOffset -lt 0 -or $peOffset + 6 -gt $bytes.Length) {
    Fail "cabeçalho PE inválido: $Path"
  }
  $machine = [System.BitConverter]::ToUInt16($bytes, $peOffset + 4)
  $signatureValid = $bytes[$peOffset] -eq 0x50 -and
    $bytes[$peOffset + 1] -eq 0x45 -and
    $bytes[$peOffset + 2] -eq 0 -and
    $bytes[$peOffset + 3] -eq 0
  if (-not $signatureValid -or $machine -ne 0x8664) {
    Fail "binário não é PE x64: $Path"
  }
}

function AssertInstallerContains([string]$InstallerPath, [string]$Pattern) {
  $archiveCommand = @("7z", "7zz", "7za") |
    ForEach-Object { Get-Command $_ -ErrorAction SilentlyContinue } |
    Select-Object -First 1
  if ($null -eq $archiveCommand) {
    Fail "7-Zip (7z, 7zz ou 7za) é obrigatório para validar o conteúdo do instalador"
  }
  $listing = & $archiveCommand.Source l -slt $InstallerPath 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    Fail "não foi possível listar o conteúdo do instalador: $InstallerPath"
  }
  $entry = $listing -split "`r?`n" |
    Where-Object { $_ -like "Path = *" } |
    ForEach-Object { $_.Substring(7) } |
    Where-Object { $_ -match $Pattern } |
    Select-Object -First 1
  if ($null -eq $entry) {
    Fail "conteúdo obrigatório não encontrado no instalador: $Pattern"
  }
}

$binaryDir = Join-Path $PSScriptRoot "..\src-tauri\binaries"
$worker = Get-ChildItem -LiteralPath $binaryDir -Filter "griffin-onnx-worker-x86_64-pc-windows-msvc.exe" -File | Select-Object -First 1
if ($null -eq $worker) {
  Fail "worker ONNX Windows x64 não encontrado em $binaryDir"
}
AssertPeX64 $worker.FullName

foreach ($provider in @("onnxruntime_providers_cuda.dll", "onnxruntime_providers_shared.dll")) {
  $providerPath = Join-Path $binaryDir $provider
  AssertPeX64 $providerPath
}

# Smoke test the worker protocol without requiring a CUDA driver or model files.
$smoke = '{"type":"unknown"}' | & $worker.FullName 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $smoke -notmatch "tipo de operação desconhecido") {
  Fail "worker Windows não respondeu ao protocolo de fallback/erro esperado"
}

if (-not $SkipInstaller) {
  if (-not (Test-Path -LiteralPath $ReleaseDir -PathType Container)) {
    Fail "diretório de release ausente: $ReleaseDir"
  }
  $installer = Get-ChildItem -LiteralPath $ReleaseDir -Filter "*.exe" -File | Select-Object -First 1
  if ($null -eq $installer) {
    Fail "instalador NSIS não encontrado em $ReleaseDir"
  }
  if ($installer.Length -lt 100KB) {
    Fail "instalador NSIS suspeito: arquivo muito pequeno"
  }
  AssertPeX64 $installer.FullName
  AssertInstallerContains $installer.FullName "griffin-onnx-worker.*\.exe$"
  AssertInstallerContains $installer.FullName "onnxruntime_providers_cuda\.dll$"
  AssertInstallerContains $installer.FullName "onnxruntime_providers_shared\.dll$"
}

Write-Host "Windows x64 validado: worker, providers CUDA/shared e $(if ($SkipInstaller) { 'binários nativos' } else { 'instalador NSIS' })."
