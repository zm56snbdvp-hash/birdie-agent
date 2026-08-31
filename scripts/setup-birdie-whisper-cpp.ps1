[CmdletBinding()]
param(
  [ValidateSet(
    'tiny', 'tiny.en',
    'base', 'base.en',
    'small', 'small.en',
    'medium', 'medium.en',
    'large-v1',
    'large-v2', 'large-v2-q5_0',
    'large-v3', 'large-v3-q5_0',
    'large-v3-turbo', 'large-v3-turbo-q5_0'
  )]
  [string]$Model = 'base',
  [string]$SourceDirectory,
  [string]$ModelDirectory,
  [switch]$SourceOnly,
  [switch]$ForceModelDownload
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$reviewedCommit = '978113305b2ead22249b881deafa131dc8884911'
$officialOrigin = 'https://github.com/ggml-org/whisper.cpp.git'
$repoRoot = Split-Path -Parent $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($SourceDirectory)) {
  $SourceDirectory = Join-Path $repoRoot 'third_party/whisper.cpp'
}
if ([string]::IsNullOrWhiteSpace($ModelDirectory)) {
  $ModelDirectory = Join-Path $repoRoot 'models/whisper'
}

$SourceDirectory = [IO.Path]::GetFullPath($SourceDirectory)
$ModelDirectory = [IO.Path]::GetFullPath($ModelDirectory)

$modelCatalog = @{
  'tiny'                    = @{ Sha1 = 'bd577a113a864445d4c299885e0cb97d4ba92b5f'; Size = '75 MiB' }
  'tiny.en'                 = @{ Sha1 = 'c78c86eb1a8faa21b369bcd33207cc90d64ae9df'; Size = '75 MiB' }
  'base'                    = @{ Sha1 = '465707469ff3a37a2b9b8d8f89f2f99de7299dac'; Size = '142 MiB' }
  'base.en'                 = @{ Sha1 = '137c40403d78fd54d454da0f9bd998f78703390c'; Size = '142 MiB' }
  'small'                   = @{ Sha1 = '55356645c2b361a969dfd0ef2c5a50d530afd8d5'; Size = '466 MiB' }
  'small.en'                = @{ Sha1 = 'db8a495a91d927739e50b3fc1cc4c6b8f6c2d022'; Size = '466 MiB' }
  'medium'                  = @{ Sha1 = 'fd9727b6e1217c2f614f9b698455c4ffd82463b4'; Size = '1.5 GiB' }
  'medium.en'               = @{ Sha1 = '8c30f0e44ce9560643ebd10bbe50cd20eafd3723'; Size = '1.5 GiB' }
  'large-v1'                = @{ Sha1 = 'b1caaf735c4cc1429223d5a74f0f4d0b9b59a299'; Size = '2.9 GiB' }
  'large-v2'                = @{ Sha1 = '0f4c8e34f21cf1a914c59d8b3ce882345ad349d6'; Size = '2.9 GiB' }
  'large-v2-q5_0'           = @{ Sha1 = '00e39f2196344e901b3a2bd5814807a769bd1630'; Size = '1.1 GiB' }
  'large-v3'                = @{ Sha1 = 'ad82bf6a9043ceed055076d0fd39f5f186ff8062'; Size = '2.9 GiB' }
  'large-v3-q5_0'           = @{ Sha1 = 'e6e2ed78495d403bef4b7cff42ef4aaadcfea8de'; Size = '1.1 GiB' }
  'large-v3-turbo'          = @{ Sha1 = '4af2b29d7ec73d781377bfd1758ca957a807e941'; Size = '1.5 GiB' }
  'large-v3-turbo-q5_0'     = @{ Sha1 = 'e050f7970618a659205450ad97eb95a18d69c9ee'; Size = '547 MiB' }
}

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Invoke-Git([string[]]$Arguments) {
  & git -C $SourceDirectory @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git -C '$SourceDirectory' $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Get-Sha1([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA1).Hash.ToLowerInvariant()
}

function Download-File([string]$Uri, [string]$Destination) {
  $partial = "$Destination.partial"
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue

  try {
    $bits = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue
    if ($bits) {
      Start-BitsTransfer -Source $Uri -Destination $partial -Description 'Birdie local Gate-STT model'
    }
    else {
      Invoke-WebRequest -Uri $Uri -OutFile $partial -UseBasicParsing
    }
  }
  catch {
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
    throw
  }

  return $partial
}

Require-Command 'git'

$sourceParent = Split-Path -Parent $SourceDirectory
New-Item -ItemType Directory -Path $sourceParent -Force | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $SourceDirectory '.git') -PathType Container)) {
  if (Test-Path -LiteralPath $SourceDirectory) {
    $existing = Get-ChildItem -LiteralPath $SourceDirectory -Force -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) {
      throw "Whisper source directory exists but is not an empty Git checkout: $SourceDirectory"
    }
  }
  else {
    New-Item -ItemType Directory -Path $SourceDirectory -Force | Out-Null
  }

  Invoke-Git @('init')
  Invoke-Git @('remote', 'add', 'origin', $officialOrigin)
}

$origin = (& git -C $SourceDirectory remote get-url origin 2>$null).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Could not read whisper.cpp origin from: $SourceDirectory"
}

$allowedOrigins = @(
  'https://github.com/ggml-org/whisper.cpp.git',
  'https://github.com/ggml-org/whisper.cpp',
  'git@github.com:ggml-org/whisper.cpp.git'
)
if ($allowedOrigins -notcontains $origin) {
  throw "Refusing non-official whisper.cpp origin '$origin'. Expected $officialOrigin"
}

$dirty = (& git -C $SourceDirectory status --porcelain)
if ($LASTEXITCODE -ne 0) {
  throw "Could not inspect whisper.cpp worktree: $SourceDirectory"
}
if ($dirty) {
  throw "Whisper source checkout contains local changes. Birdie will not overwrite them: $SourceDirectory"
}

Invoke-Git @('fetch', '--depth', '1', 'origin', $reviewedCommit)
Invoke-Git @('checkout', '--detach', $reviewedCommit)

$actualCommit = (& git -C $SourceDirectory rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $reviewedCommit) {
  throw "Unexpected whisper.cpp revision '$actualCommit'; expected '$reviewedCommit'."
}

foreach ($required in @('CMakeLists.txt', 'include/whisper.h')) {
  if (-not (Test-Path -LiteralPath (Join-Path $SourceDirectory $required) -PathType Leaf)) {
    throw "Reviewed whisper.cpp checkout is missing required file: $required"
  }
}

Write-Host "whisper.cpp ready: $actualCommit" -ForegroundColor Green
Write-Host "Source: $SourceDirectory" -ForegroundColor DarkGray

$modelPath = $null
$modelSha1 = $null
$modelDownloaded = $false

if (-not $SourceOnly) {
  $metadata = $modelCatalog[$Model]
  $expectedSha1 = [string]$metadata.Sha1
  $modelPath = Join-Path $ModelDirectory "ggml-$Model.bin"
  $modelUri = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$Model.bin"

  New-Item -ItemType Directory -Path $ModelDirectory -Force | Out-Null

  if (Test-Path -LiteralPath $modelPath -PathType Leaf) {
    $modelSha1 = Get-Sha1 $modelPath
    if ($modelSha1 -eq $expectedSha1) {
      Write-Host "Model already verified: $Model ($($metadata.Size))" -ForegroundColor Green
    }
    elseif (-not $ForceModelDownload) {
      throw "Existing model hash mismatch at '$modelPath'. Expected $expectedSha1, got $modelSha1. Use -ForceModelDownload only to replace this file."
    }
    else {
      Remove-Item -LiteralPath $modelPath -Force
      $modelSha1 = $null
    }
  }

  if (-not (Test-Path -LiteralPath $modelPath -PathType Leaf)) {
    Write-Host "Downloading multilingual Gate-STT model '$Model' ($($metadata.Size))..." -ForegroundColor Green
    $partial = Download-File -Uri $modelUri -Destination $modelPath
    $downloadSha1 = Get-Sha1 $partial
    if ($downloadSha1 -ne $expectedSha1) {
      Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
      throw "Downloaded model hash mismatch. Expected $expectedSha1, got $downloadSha1."
    }
    Move-Item -LiteralPath $partial -Destination $modelPath -Force
    $modelSha1 = $downloadSha1
    $modelDownloaded = $true
  }

  if (-not $modelSha1) {
    $modelSha1 = Get-Sha1 $modelPath
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    sourceRepository = $officialOrigin
    sourceCommit = $actualCommit
    model = $Model
    modelPath = $modelPath
    modelSha1 = $modelSha1
    modelSize = [string]$metadata.Size
    verifiedAtUtc = [DateTime]::UtcNow.ToString('o')
  }
  $manifestPath = Join-Path $ModelDirectory 'birdie-gate-stt-manifest.json'
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding UTF8

  Write-Host "Model ready: $modelPath" -ForegroundColor Green
  Write-Host "SHA-1: $modelSha1" -ForegroundColor DarkGray
}

[pscustomobject]@{
  SourceDirectory = $SourceDirectory
  SourceCommit = $actualCommit
  Model = if ($SourceOnly) { $null } else { $Model }
  ModelPath = $modelPath
  ModelSha1 = $modelSha1
  ModelDownloaded = $modelDownloaded
}
