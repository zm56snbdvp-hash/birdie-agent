[CmdletBinding()]
param(
  [ValidateSet('base')]
  [string]$Model = 'base',
  [switch]$RunVoiceTests
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$voiceSource = Join-Path $repoRoot 'services/voice'
$voiceBuild = Join-Path $repoRoot 'build/voice'
$voiceExe = Join-Path $voiceBuild 'Release/birdie-voice-host.exe'
$whisperSource = Join-Path $repoRoot 'third_party/whisper.cpp'
$whisperModel = Join-Path $repoRoot "models/whisper/ggml-$Model.bin"
$whisperSetup = Join-Path $PSScriptRoot 'setup-birdie-whisper-cpp.ps1'
$runtimeStage = Join-Path $repoRoot 'build/runtime'
$stagedNode = Join-Path $runtimeStage 'node.exe'
$stagedNodeLicense = Join-Path $runtimeStage 'LICENSE.node.txt'
$reviewedWhisperCommit = '978113305b2ead22249b881deafa131dc8884911'
$expectedModelSha1 = '465707469ff3a37a2b9b8d8f89f2f99de7299dac'
$nodeVersion = '22.23.2'
$nodeArchiveName = "node-v$nodeVersion-win-x64.zip"
$nodeArchiveSha256 = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
$nodeExeSha256 = '0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4'
$nodeLicenseSha256 = '8cc9bb466b19fc7e7cc99d03e9df1132021fda8b01eea2624c58bb372dbef576'
$nodeArchiveUri = "https://nodejs.org/dist/v$nodeVersion/$nodeArchiveName"

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "Required command '$Name' was not found in PATH." }
  return $command
}

function Invoke-Checked([string]$FilePath, [string[]]$ArgumentList) {
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
  }
}

function Get-BirdieFileHash(
  [string]$Path,
  [ValidateSet('SHA1', 'SHA256')]
  [string]$Algorithm
) {
  $stream = [IO.File]::OpenRead($Path)
  $hasher = if ($Algorithm -eq 'SHA1') {
    [Security.Cryptography.SHA1]::Create()
  }
  else {
    [Security.Cryptography.SHA256]::Create()
  }
  try {
    return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $hasher.Dispose()
    $stream.Dispose()
  }
}

Require-Command 'git' | Out-Null
Require-Command 'cmake' | Out-Null
if ($RunVoiceTests) { Require-Command 'ctest' | Out-Null }

$assetsReady = (Test-Path -LiteralPath $whisperSource -PathType Container) -and
  (Test-Path -LiteralPath $whisperModel -PathType Leaf)
if ($assetsReady) {
  $actualCommit = (& git -C $whisperSource rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $reviewedWhisperCommit) {
    throw "Unexpected whisper.cpp revision '$actualCommit'; expected '$reviewedWhisperCommit'."
  }
  $dirty = & git -C $whisperSource status --porcelain
  if ($LASTEXITCODE -ne 0 -or $dirty) {
    throw "Whisper source checkout is unreadable or dirty: $whisperSource"
  }
  $modelSha1 = Get-BirdieFileHash $whisperModel 'SHA1'
  if ($modelSha1 -ne $expectedModelSha1) {
    throw "Whisper model hash mismatch. Expected $expectedModelSha1, got $modelSha1."
  }
}
else {
  & $whisperSetup -Model $Model | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Whisper provisioning failed with exit code $LASTEXITCODE." }
}

$configureArguments = @(
  '-S', $voiceSource,
  '-B', $voiceBuild,
  '-DBIRDIE_WITH_WHISPER_CPP=ON',
  "-DBIRDIE_WHISPER_CPP_SOURCE_DIR=$whisperSource",
  '-DGGML_NATIVE=OFF'
)
if (-not (Test-Path -LiteralPath (Join-Path $voiceBuild 'CMakeCache.txt') -PathType Leaf)) {
  $configureArguments += @('-A', 'x64')
}
Invoke-Checked 'cmake' $configureArguments
Invoke-Checked 'cmake' @('--build', $voiceBuild, '--config', 'Release', '--parallel')
if ($RunVoiceTests) {
  Invoke-Checked 'ctest' @('--test-dir', $voiceBuild, '-C', 'Release', '--output-on-failure')
}

if (-not (Test-Path -LiteralPath $voiceExe -PathType Leaf)) {
  throw "Voice bundle executable was not produced: $voiceExe"
}
if (-not (Test-Path -LiteralPath $whisperModel -PathType Leaf)) {
  throw "Whisper bundle model is missing: $whisperModel"
}

New-Item -ItemType Directory -Force -Path $runtimeStage | Out-Null
$stagedNodeReady = (Test-Path -LiteralPath $stagedNode -PathType Leaf) -and
  (Test-Path -LiteralPath $stagedNodeLicense -PathType Leaf) -and
  ((Get-BirdieFileHash $stagedNode 'SHA256') -eq $nodeExeSha256) -and
  ((Get-BirdieFileHash $stagedNodeLicense 'SHA256') -eq $nodeLicenseSha256)
if (-not $stagedNodeReady) {
  $nodeArchive = Join-Path $runtimeStage $nodeArchiveName
  $archiveReady = (Test-Path -LiteralPath $nodeArchive -PathType Leaf) -and
    ((Get-BirdieFileHash $nodeArchive 'SHA256') -eq $nodeArchiveSha256)
  if (-not $archiveReady) {
    $partialArchive = "$nodeArchive.partial"
    Remove-Item -LiteralPath $partialArchive -Force -ErrorAction SilentlyContinue
    Invoke-WebRequest -UseBasicParsing -Uri $nodeArchiveUri -OutFile $partialArchive
    $downloadSha256 = Get-BirdieFileHash $partialArchive 'SHA256'
    if ($downloadSha256 -ne $nodeArchiveSha256) {
      Remove-Item -LiteralPath $partialArchive -Force -ErrorAction SilentlyContinue
      throw "Node.js archive hash mismatch. Expected $nodeArchiveSha256, got $downloadSha256."
    }
    Move-Item -LiteralPath $partialArchive -Destination $nodeArchive -Force
  }

  $extractedRoot = Join-Path $runtimeStage "node-v$nodeVersion-win-x64"
  Remove-Item -LiteralPath $extractedRoot -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -LiteralPath $nodeArchive -DestinationPath $runtimeStage -Force
  $extractedNode = Join-Path $extractedRoot 'node.exe'
  $extractedLicense = Join-Path $extractedRoot 'LICENSE'
  if (-not (Test-Path -LiteralPath $extractedNode -PathType Leaf) -or
      -not (Test-Path -LiteralPath $extractedLicense -PathType Leaf)) {
    throw 'Pinned Node.js archive is missing node.exe or LICENSE.'
  }
  Copy-Item -LiteralPath $extractedNode -Destination $stagedNode -Force
  Copy-Item -LiteralPath $extractedLicense -Destination $stagedNodeLicense -Force
}

$actualNodeSha256 = Get-BirdieFileHash $stagedNode 'SHA256'
if ($actualNodeSha256 -ne $nodeExeSha256) {
  throw "Staged Node.js executable hash mismatch. Expected $nodeExeSha256, got $actualNodeSha256."
}
$actualNodeLicenseSha256 = Get-BirdieFileHash $stagedNodeLicense 'SHA256'
if ($actualNodeLicenseSha256 -ne $nodeLicenseSha256) {
  throw "Staged Node.js license hash mismatch. Expected $nodeLicenseSha256, got $actualNodeLicenseSha256."
}
$actualNodeVersion = (& $stagedNode -p 'process.versions.node').Trim()
$actualNodeArch = (& $stagedNode -p 'process.arch').Trim()
if ($LASTEXITCODE -ne 0 -or $actualNodeVersion -ne $nodeVersion -or $actualNodeArch -ne 'x64') {
  throw "Staged Node.js runtime identity mismatch: version=$actualNodeVersion arch=$actualNodeArch"
}

[pscustomobject]@{
  VoiceExe = 'build/voice/Release/birdie-voice-host.exe'
  VoiceSha256 = Get-BirdieFileHash $voiceExe 'SHA256'
  WhisperModel = "models/whisper/ggml-$Model.bin"
  WhisperModelSha1 = Get-BirdieFileHash $whisperModel 'SHA1'
  NodeRuntime = 'build/runtime/node.exe'
  NodeVersion = $actualNodeVersion
  NodeArchitecture = $actualNodeArch
  NodeSha256 = $actualNodeSha256
  NodeArchiveSha256 = $nodeArchiveSha256
  NodeLicense = 'build/runtime/LICENSE.node.txt'
  NodeLicenseSha256 = $actualNodeLicenseSha256
}
